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
    /**
     * Stable provider-side namespace, e.g. `https://accounts.google.com`.
     *
     * The column has been `NOT NULL` since `0000_real_spitfire`. Better Auth 1.7.17
     * no longer writes it; SQLite cannot drop `NOT NULL` without rebuilding the
     * table, and D1 ignores `PRAGMA foreign_keys=OFF`, so the live constraint
     * stays. The application default fills inserts the adapter omits.
     */
    issuer: text('issuer')
      .notNull()
      .$defaultFn(() => ''),
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

/**
 * JWT signing keys for the `jwt()` plugin. Required by `@better-auth/mcp` so MCP
 * access tokens can be verified against this Worker’s JWKS.
 */
export const jwks = sqliteTable(
  'jwks',
  {
    id: id(),
    publicKey: text('public_key').notNull(),
    privateKey: text('private_key').notNull(),
    createdAt: createdAt(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    alg: text('alg'),
    crv: text('crv'),
  },
  (table) => [index('jwks_expires_at_idx').on(table.expiresAt)],
)

/**
 * OAuth 2.1 tables owned by `@better-auth/mcp` / `@better-auth/oauth-provider`.
 * Auth tables, not product tables: they stay behind ADR 0011’s boundary.
 */
export const oauthClient = sqliteTable(
  'oauth_client',
  {
    id: id(),
    clientId: text('client_id').notNull(),
    clientSecret: text('client_secret'),
    clientDiscoveryId: text('client_discovery_id'),
    disabled: integer('disabled', { mode: 'boolean' }).default(false),
    skipConsent: integer('skip_consent', { mode: 'boolean' }),
    enableEndSession: integer('enable_end_session', { mode: 'boolean' }),
    subjectType: text('subject_type'),
    scopes: text('scopes'),
    clientCredentialsScopes: text('client_credentials_scopes'),
    userId: text('user_id').references(() => user.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: text('contacts'),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: text('redirect_uris').notNull(),
    postLogoutRedirectUris: text('post_logout_redirect_uris'),
    backchannelLogoutUri: text('backchannel_logout_uri'),
    backchannelLogoutSessionRequired: integer(
      'backchannel_logout_session_required',
      { mode: 'boolean' },
    ),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    applicationType: text('application_type'),
    jwks: text('jwks'),
    jwksUri: text('jwks_uri'),
    grantTypes: text('grant_types'),
    responseTypes: text('response_types'),
    requirePKCE: integer('require_pkce', { mode: 'boolean' }),
    dpopBoundAccessTokens: integer('dpop_bound_access_tokens', {
      mode: 'boolean',
    }).default(false),
    referenceId: text('reference_id'),
    metadata: text('metadata'),
  },
  (table) => [
    uniqueIndex('oauth_client_client_id_unique').on(table.clientId),
    index('oauth_client_user_id_idx').on(table.userId),
  ],
)

export const oauthResource = sqliteTable(
  'oauth_resource',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    name: text('name').notNull(),
    accessTokenTtl: integer('access_token_ttl'),
    refreshTokenTtl: integer('refresh_token_ttl'),
    signingAlgorithm: text('signing_algorithm'),
    signingKeyId: text('signing_key_id'),
    allowedScopes: text('allowed_scopes'),
    customClaims: text('custom_claims'),
    dpopBoundAccessTokensRequired: integer(
      'dpop_bound_access_tokens_required',
      { mode: 'boolean' },
    ).default(false),
    disabled: integer('disabled', { mode: 'boolean' }).default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
    policyVersion: integer('policy_version').default(1),
    metadata: text('metadata'),
  },
  (table) => [
    uniqueIndex('oauth_resource_identifier_unique').on(table.identifier),
  ],
)

export const oauthClientResource = sqliteTable(
  'oauth_client_resource',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    resourceId: text('resource_id')
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: 'cascade' }),
    metadata: text('metadata'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('oauth_client_resource_client_id_resource_id_unique').on(
      table.clientId,
      table.resourceId,
    ),
    index('oauth_client_resource_client_id_idx').on(table.clientId),
    index('oauth_client_resource_resource_id_idx').on(table.resourceId),
  ],
)

export const oauthRefreshToken = sqliteTable(
  'oauth_refresh_token',
  {
    id: id(),
    token: text('token').notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text('session_id').references(() => session.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources'),
    requestedUserInfoClaims: text('requested_user_info_claims'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    revoked: integer('revoked', { mode: 'timestamp_ms' }),
    rotatedAt: integer('rotated_at', { mode: 'timestamp_ms' }),
    rotationReplayResponse: text('rotation_replay_response'),
    rotationReplayExpiresAt: integer('rotation_replay_expires_at', {
      mode: 'timestamp_ms',
    }),
    authTime: integer('auth_time', { mode: 'timestamp_ms' }),
    confirmation: text('confirmation'),
    scopes: text('scopes').notNull(),
  },
  (table) => [
    uniqueIndex('oauth_refresh_token_token_unique').on(table.token),
    index('oauth_refresh_token_client_id_idx').on(table.clientId),
    index('oauth_refresh_token_session_id_idx').on(table.sessionId),
    index('oauth_refresh_token_user_id_idx').on(table.userId),
    index('oauth_refresh_token_authorization_code_id_idx').on(
      table.authorizationCodeId,
    ),
  ],
)

export const oauthAccessToken = sqliteTable(
  'oauth_access_token',
  {
    id: id(),
    token: text('token'),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text('session_id').references(() => session.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id').references(() => user.id),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources'),
    requestedUserInfoClaims: text('requested_user_info_claims'),
    refreshId: text('refresh_id').references(() => oauthRefreshToken.id),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    revoked: integer('revoked', { mode: 'timestamp_ms' }),
    confirmation: text('confirmation'),
    scopes: text('scopes').notNull(),
  },
  (table) => [
    uniqueIndex('oauth_access_token_token_unique').on(table.token),
    index('oauth_access_token_client_id_idx').on(table.clientId),
    index('oauth_access_token_session_id_idx').on(table.sessionId),
    index('oauth_access_token_user_id_idx').on(table.userId),
    index('oauth_access_token_authorization_code_id_idx').on(
      table.authorizationCodeId,
    ),
    index('oauth_access_token_refresh_id_idx').on(table.refreshId),
  ],
)

export const oauthConsent = sqliteTable(
  'oauth_consent',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId),
    userId: text('user_id').references(() => user.id),
    referenceId: text('reference_id'),
    resources: text('resources'),
    requestedUserInfoClaims: text('requested_user_info_claims'),
    scopes: text('scopes').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('oauth_consent_client_id_idx').on(table.clientId),
    index('oauth_consent_user_id_idx').on(table.userId),
  ],
)

export const oauthClientAssertion = sqliteTable('oauth_client_assertion', {
  id: id(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
})

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
  jwks,
  oauthClient,
  oauthResource,
  oauthClientResource,
  oauthRefreshToken,
  oauthAccessToken,
  oauthConsent,
  oauthClientAssertion,
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
