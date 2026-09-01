/**
 * Drizzle table definitions required by Better Auth.
 *
 * Column names are snake_case in SQLite; the TypeScript property names stay camelCase because
 * the Better Auth Drizzle adapter addresses columns by the schema's property key (its internal
 * `fieldName`), never by the SQL name. `initGetFieldName()` returns a declared field name
 * unchanged and the adapter then reads `schemaModel[fieldName]`, so a snake_case property key
 * typechecks cleanly and throws `BetterAuthError` on the first ban.
 *
 * Conventions (blueprint §3.1, and the docblock at the top of `./schema.ts`):
 * - text primary keys generated in the application layer
 * - every timestamp is a millisecond epoch integer
 * - every foreign key and every lookup column is indexed
 *
 * `organization` **is the workspace/household**: a personal organization is auto-provisioned on
 * first sign-in, and every tenant table in `./schema.ts` carries its id.
 */
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

const id = () => text('id').primaryKey()
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' }).notNull()
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' }).notNull()

/** Roles recognised by the organization plugin, most privileged first. */
export const ORGANIZATION_ROLES = ['owner', 'admin', 'member'] as const

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number]

/** Invitation lifecycle states used by the organization plugin. */
export const INVITATION_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'canceled',
] as const

export type InvitationStatus = (typeof INVITATION_STATUSES)[number]

/**
 * `user` carries four columns owned by Better Auth's `admin` plugin: `role`, `banned`,
 * `banReason` and `banExpires`.
 *
 * `role` carries no `CHECK` and no default on purpose. Platform roles are resolved in the
 * permission guard, where `NULL` and an unrecognised value both resolve to `user`; a database
 * constraint would additionally make the plugin's own comma-joined multi-role form unstorable.
 */
export const user = sqliteTable(
  'user',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' })
      .notNull()
      .default(false),
    image: text('image'),
    twoFactorEnabled: integer('two_factor_enabled', { mode: 'boolean' })
      .notNull()
      .default(false),
    role: text('role'),
    banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: integer('ban_expires', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('user_email_unique').on(table.email),
    index('user_role_idx').on(table.role),
  ],
)

export const session = sqliteTable(
  'session',
  {
    id: id(),
    token: text('token').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Workspace the session is currently acting inside. */
    activeOrganizationId: text('active_organization_id').references(
      () => organization.id,
      { onDelete: 'set null' },
    ),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /**
     * The `admin` plugin's impersonation marker: the id of the operator acting as this session's
     * user. Set only on a session minted by `impersonateUser`, and the signal the shell's warning
     * bar renders on.
     */
    impersonatedBy: text('impersonated_by'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('session_token_unique').on(table.token),
    index('session_user_id_idx').on(table.userId),
    index('session_expires_at_idx').on(table.expiresAt),
  ],
)

/**
 * A credential or a linked social identity. Named `account` because Better Auth names it that;
 * the product's *financial* accounts are `accounts` in `./schema.ts` and are a different thing
 * entirely.
 */
export const account = sqliteTable(
  'account',
  {
    id: id(),
    /** Stable provider-side namespace, e.g. `https://accounts.google.com`. */
    issuer: text('issuer').notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    scope: text('scope'),
    /** Scrypt hash for the credential provider; never returned to a client. */
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('account_issuer_account_id_unique').on(
      table.issuer,
      table.accountId,
    ),
    index('account_user_id_idx').on(table.userId),
  ],
)

export const verification = sqliteTable(
  'verification',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('verification_identifier_idx').on(table.identifier),
    index('verification_expires_at_idx').on(table.expiresAt),
  ],
)

export const twoFactor = sqliteTable(
  'two_factor',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Base32 TOTP secret; never returned to a client. */
    secret: text('secret').notNull(),
    /** Encrypted, newline-joined single-use recovery codes. */
    backupCodes: text('backup_codes').notNull(),
    verified: integer('verified', { mode: 'boolean' }).notNull().default(true),
    failedVerificationCount: integer('failed_verification_count')
      .notNull()
      .default(0),
    lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('two_factor_user_id_idx').on(table.userId),
    index('two_factor_secret_idx').on(table.secret),
  ],
)

export const passkey = sqliteTable(
  'passkey',
  {
    id: id(),
    /** Human label shown in the credential list, e.g. "MacBook Pro". */
    name: text('name'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** base64url WebAuthn credential id. */
    credentialId: text('credential_id').notNull(),
    /** base64url COSE_Key of the credential's public key. */
    publicKey: text('public_key').notNull(),
    /** COSE algorithm identifier, e.g. -7 for ES256. */
    algorithm: integer('algorithm').notNull(),
    /** Authenticator signature counter, for clone detection. */
    counter: integer('counter').notNull().default(0),
    /** `singleDevice` or `multiDevice`, derived from the backup-eligible flag. */
    deviceType: text('device_type').notNull(),
    backedUp: integer('backed_up', { mode: 'boolean' })
      .notNull()
      .default(false),
    /** Comma-joined authenticator transports reported at registration. */
    transports: text('transports'),
    aaguid: text('aaguid'),
    createdAt: createdAt(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('passkey_credential_id_unique').on(table.credentialId),
    index('passkey_user_id_idx').on(table.userId),
  ],
)

export const organization = sqliteTable(
  'organization',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logo: text('logo'),
    /** JSON blob owned by the organization plugin. */
    metadata: text('metadata'),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (table) => [uniqueIndex('organization_slug_unique').on(table.slug)],
)

export const member = sqliteTable(
  'member',
  {
    id: id(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('member_organization_id_user_id_unique').on(
      table.organizationId,
      table.userId,
    ),
    index('member_organization_id_idx').on(table.organizationId),
    index('member_user_id_idx').on(table.userId),
  ],
)

export const invitation = sqliteTable(
  'invitation',
  {
    id: id(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('invitation_organization_id_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email),
    index('invitation_status_idx').on(table.status),
  ],
)

/** Every Better Auth table, in the shape the Drizzle adapter expects. */
export const authSchema = {
  user,
  session,
  account,
  verification,
  twoFactor,
  passkey,
  organization,
  member,
  invitation,
}

export type UserRow = typeof user.$inferSelect
export type SessionRow = typeof session.$inferSelect
export type AccountRow = typeof account.$inferSelect
export type VerificationRow = typeof verification.$inferSelect
export type TwoFactorRow = typeof twoFactor.$inferSelect
export type PasskeyRow = typeof passkey.$inferSelect
export type OrganizationRow = typeof organization.$inferSelect
export type MemberRow = typeof member.$inferSelect
export type InvitationRow = typeof invitation.$inferSelect
