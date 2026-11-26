import { betterAuth } from "better-auth"
import type { Env } from "./env"

interface AuthEmail {
  to: string
  subject: string
  text: string
}

// Only tests supply a transport. The Worker always uses EMAIL.
export function createAuth(
  env: Env,
  send: (email: AuthEmail) => Promise<unknown> = (email) =>
    env.EMAIL.send({ from: env.EMAIL_FROM, ...email })
) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters")
  }
  const origin = new URL(env.APP_ORIGIN)
  const secure = origin.protocol === "https:"
  if (!secure && origin.origin !== "http://localhost:3000") {
    throw new Error("APP_ORIGIN must use HTTPS")
  }

  return betterAuth({
    database: env.DB,
    baseURL: origin.origin,
    secret: env.BETTER_AUTH_SECRET,
    logger: {
      level: "error",
      log: () => console.error("Better Auth reported an error"),
    },
    advanced: {
      useSecureCookies: secure,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    rateLimit: { enabled: true, storage: "database" },
    session: { cookieCache: { enabled: false } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await send({
          to: user.email,
          subject: "Reset your Money Tracker password",
          text: `Reset your password: ${url}`,
        })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await send({
          to: user.email,
          subject: "Verify your Money Tracker email",
          text: `Verify your email: ${url}`,
        })
      },
    },
  })
}

export async function verifiedUser(
  auth: ReturnType<typeof createAuth>,
  headers: Headers
) {
  const session = await auth.api.getSession({ headers })
  return session?.user.emailVerified ? session.user : null
}
