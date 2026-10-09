/**
 * The Better Auth configuration — every option this product sets, and why.
 *
 * Kept apart from `./index` so the options are a value that can be read, diffed and asserted on,
 * rather than something buried inside a constructor call. `./index` turns it into the instance.
 *
 * The shape is dictated by the runtime as much as by the product. A Worker has no memory between
 * requests and no interactive transaction, and D1 is a network hop away; the decisions that follow
 * from that are marked where they are made.
 */

import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, organization, twoFactor } from 'better-auth/plugins'
import { nanoid } from 'nanoid'

import { authSchema } from '#/server/db/auth-schema'
import { negotiateEmailLocale } from '#/server/fns/locale'
import { loggerFromEnv } from '#/server/observability/logger'
import { getDb } from './db'
import { createAuthEmailer } from './email'
import {
  APP_NAME,
  appUrl,
  appleBundleIdentifier,
  appleCredentials,
  authSecret,
  emailDelivery,
  googleCredentials,
  loggerEnv,
  sessionStore,
  trustedOrigins,
} from './env'
import { resolveOrProvisionOrganization } from './organization'
import {
  DISABLED_ADMIN_PATHS,
  DISABLED_ORGANIZATION_PATHS,
  adminOptions,
} from './permissions'
import { createKvSecondaryStorage } from './secondary-storage'

import type { Locale } from '#/lib/i18n'
import type { BetterAuthOptions, betterAuth } from 'better-auth'

/** Where the auth routes are mounted. The browser client in `src/lib/auth-client.ts` matches it. */
export const AUTH_BASE_PATH = '/api/auth'

/**
 * Which language to write an auth email in.
 *
 * Better Auth hands each email hook the `Request` that triggered it, and that request carries both
 * signals the product has: the language picker's cookie and `Accept-Language`, weighed in that
 * order by {@link negotiateEmailLocale}. A hook invoked without a request (Better Auth marks it
 * optional) falls through to `en`, exactly as a request carrying neither does.
 */
function recipientLocale(request: Request | undefined): Locale {
  return negotiateEmailLocale({
    cookieHeader: request?.headers.get('cookie') ?? null,
    acceptLanguage: request?.headers.get('accept-language') ?? null,
  })
}

const DAY_SECONDS = 60 * 60 * 24
const MINUTE_SECONDS = 60

/**
 * A session lasts a month and is refreshed a day at a time.
 *
 * This is a household finance app that people open a few times a week; a short session would sign
 * somebody out between paydays. `updateAge` is what stops every request from writing to D1 — the
 * expiry only moves once a day.
 */
const SESSION_EXPIRES_IN = 30 * DAY_SECONDS
const SESSION_UPDATE_AGE = DAY_SECONDS

/** Reset and verification links. Long enough to survive a slow mail server, short enough to matter. */
const VERIFICATION_EXPIRES_IN = 60 * MINUTE_SECONDS

/**
 * Twelve characters, and no composition rules.
 *
 * Length is the only requirement that measurably resists offline guessing; "one uppercase, one
 * digit, one symbol" mostly produces `Password1!`. NIST SP 800-63B says the same thing.
 */
const MIN_PASSWORD_LENGTH = 12

/**
 * Rate limits, per path, in requests per window.
 *
 * The credential paths are the ones worth slowing down: sign-in is where a password list is tried,
 * and reset and verification are where somebody else's inbox is used as a weapon. The counters live
 * in the `SESSIONS` KV namespace (`storage: 'secondary-storage'`) because a Worker isolate's memory
 * is not shared between colos, so an in-memory limiter would count each edge location separately.
 * Read `./secondary-storage` for why that counter is approximate, and why approximate is enough
 * here.
 */
const RATE_LIMIT_RULES = {
  '/sign-in/email': { window: 60, max: 10 },
  '/sign-up/email': { window: 300, max: 5 },
  '/request-password-reset': { window: 300, max: 5 },
  '/reset-password': { window: 300, max: 10 },
  '/send-verification-email': { window: 300, max: 5 },
  '/two-factor/verify-totp': { window: 60, max: 10 },
  '/two-factor/verify-backup-code': { window: 300, max: 5 },
} as const satisfies NonNullable<
  NonNullable<BetterAuthOptions['rateLimit']>['customRules']
>

function socialProviders(): NonNullable<BetterAuthOptions['socialProviders']> {
  const providers: NonNullable<BetterAuthOptions['socialProviders']> = {}
  const google = googleCredentials()
  if (google) providers.google = { ...google, prompt: 'select_account' }
  const apple = appleCredentials()
  if (apple) {
    providers.apple = {
      ...apple,
      appBundleIdentifier: appleBundleIdentifier(),
    }
  }
  return providers
}

/**
 * Builds the options for this isolate.
 *
 * A function rather than a constant because every input is a Worker binding, and a binding read at
 * module scope is read at build time, where it is `undefined`.
 */
export function authOptions(): BetterAuthOptions {
  const db = getDb()
  const logger = loggerFromEnv(loggerEnv(), { context: { component: 'auth' } })
  const emailer = createAuthEmailer({ delivery: emailDelivery(), logger })

  return {
    appName: APP_NAME,
    baseURL: appUrl(),
    basePath: AUTH_BASE_PATH,
    secret: authSecret(),
    trustedOrigins: trustedOrigins(),

    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: authSchema,
      usePlural: false,
    }),

    /**
     * Sessions, OAuth state and rate-limit counters read from KV at the edge instead of from D1
     * on the other side of the network (ADR 0011). D1 stays the durable record.
     */
    secondaryStorage: createKvSecondaryStorage(sessionStore()),

    session: {
      expiresIn: SESSION_EXPIRES_IN,
      updateAge: SESSION_UPDATE_AGE,
      /**
       * **No `cookieCache`.** It puts a signed copy of the session in the cookie and serves reads
       * from it for its lifetime, which means a ban, a sign-out-everywhere or a role change is not
       * visible until it expires. `requireOrg` re-reads the membership on every call precisely so
       * that revocation is immediate; caching the session in the cookie would undo that for the
       * user record while leaving the membership fresh, which is the worst of both.
       */
    },

    verification: {
      /**
       * Verification rows are written to D1 as well as KV. A password-reset token that exists only
       * in an eventually-consistent edge store can be missing for the request that redeems it, and
       * the user sees "invalid or expired link" for a link they opened seconds ago.
       */
      storeInDatabase: true,
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      /**
       * Sign-up signs you in. Verification is requested, not required: locking a new household out
       * of the product until an email arrives is how a first session ends before it starts, and
       * nothing in the app is destructive enough to justify it. `user.emailVerified` is the fact
       * any later feature that does need it can gate on.
       */
      autoSignIn: true,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: VERIFICATION_EXPIRES_IN,
      sendResetPassword: async ({ user, url }, request) => {
        await emailer.send({
          kind: 'reset-password',
          to: user.email,
          recipientName: user.name,
          url,
          locale: recipientLocale(request),
        })
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: VERIFICATION_EXPIRES_IN,
      sendVerificationEmail: async ({ user, url }, request) => {
        await emailer.send({
          kind: 'verify-email',
          to: user.email,
          recipientName: user.name,
          url,
          locale: recipientLocale(request),
        })
      },
    },

    socialProviders: socialProviders(),

    /**
     * Order matters: `admin` adds the `role`/`banned` columns the other two read, and
     * `organization` adds the `activeOrganizationId` the session hook below writes.
     */
    plugins: [
      admin(adminOptions),
      twoFactor({ issuer: APP_NAME }),
      organization({
        // Stays on although `/organization/create` is closed below: plan stage 26-S1 creates
        // workspaces in-process through `auth.api.createOrganization`, and with this off that call
        // is refused for a session-carrying user too.
        allowUserToCreateOrganization: true,
        creatorRole: 'owner',
        sendInvitationEmail: async (data, request) => {
          await emailer.send({
            kind: 'organization-invitation',
            to: data.email,
            url: `${appUrl()}/invite/${data.id}`,
            organizationName: data.organization.name,
            // The inviter's language, not the invitee's — nothing is known about somebody who has
            // no account yet, and the household that invited them is the better guess.
            locale: recipientLocale(request),
          })
        },
      }),
    ],

    /**
     * The console's HTTP surface and the unused create-organization route, closed. See
     * `./permissions` for why this and not a hook.
     */
    disabledPaths: [...DISABLED_ADMIN_PATHS, ...DISABLED_ORGANIZATION_PATHS],

    rateLimit: {
      enabled: true,
      storage: 'secondary-storage',
      window: 60,
      max: 100,
      customRules: RATE_LIMIT_RULES,
    },

    databaseHooks: {
      user: {
        create: {
          after: async (created) => {
            await resolveOrProvisionOrganization(db, created.id)
          },
        },
      },
      session: {
        /**
         * Pins the session to a workspace as it is created — including the very first one, where
         * the `user.create.after` hook above may not have finished. `./organization` explains why
         * both hooks exist and why running provisioning twice is safe.
         */
        create: {
          before: async (created) => {
            const organizationId = await resolveOrProvisionOrganization(
              db,
              created.userId,
            )
            if (!organizationId) return
            return {
              data: { ...created, activeOrganizationId: organizationId },
            }
          },
        },
      },
    },

    advanced: {
      cookiePrefix: 'mtr',
      database: {
        /**
         * The same id shape as the rest of the schema: 24 URL-safe characters, generated in the
         * application so an insert never has to read back what the database chose.
         */
        generateId: () => nanoid(24),
      },
    },

    /** Better Auth's own diagnostics, routed into the structured log rather than to `console`. */
    logger: {
      disabled: false,
      level: 'warn',
      log: (level, message, ...args) => {
        const fields = args.length > 0 ? { detail: String(args[0]) } : undefined
        if (level === 'error') logger.error(message, undefined, fields)
        else if (level === 'warn') logger.warn(message, fields)
        else if (level === 'info') logger.info(message, fields)
        else logger.debug(message, fields)
      },
    },
  }
}

/** The concrete instance type, so `./index` and the client both name the same thing. */
export type Auth = ReturnType<typeof betterAuth>
