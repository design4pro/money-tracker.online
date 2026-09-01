# 0011. Better Auth with a KV session store and no cookie session cache

Status: accepted
Date: 2026-09-01

## Context

The product needs email-and-password sign-in, social sign-in (Google, Apple), TOTP two-factor,
passkeys, an organization model with roles, invitations, an admin plugin with impersonation and
banning, email verification and password reset — running on Cloudflare Workers, storing state in D1
and KV.

The realistic options were a hosted identity provider (Clerk, WorkOS, Auth0), rolling our own, or a
self-hosted library. A hosted provider puts the account record — and the organization model our
entire tenancy hangs off — in someone else's database, priced per monthly active user, with the
workspace model constrained by their opinion of what an organization is. Rolling our own is weeks of
work in the one area where a subtle bug is a breach.

Better Auth runs in the Worker, stores its tables in our D1 beside the domain tables, and models
organizations, members and invitations natively — which matters because `organization` **is** our
tenant, not a decoration on top of one.

The second decision is where sessions live. Reading a session from D1 on every request puts a
database round trip in front of every page. Better Auth offers two mitigations: a `secondaryStorage`
adapter (KV) and a `cookieCache` that puts a signed session snapshot in the cookie itself.

## Decision

**Better Auth**, with `secondaryStorage` backed by the `SESSIONS` KV namespace — separate from the
general `KV` namespace, so a cache purge can never sign everyone out.

**No `cookieCache`.** A signed session snapshot in a cookie is a window — typically five minutes —
during which a banned account, or one whose workspace role was just reduced, keeps its old
authority. For a product where a role change can mean access to a household's entire financial
history, that window is not acceptable, and the KV read per request is what it costs to not have it.

Supporting decisions, each of which has bitten someone:

- **`verification.storeInDatabase: true`.** Verification records are durable, not cookie-borne.
- **`disabledPaths` at the top level**, not inside the `admin({})` plugin — a path disabled inside a
  plugin is only disabled for that plugin's routes.
- **Plugin order matters**: `admin()` first.
- **Per-path rate limits** rather than a global one: `/sign-in/email` 10/60s, `/sign-up/email`
  5/300s, `/request-password-reset` 5/300s, `/two-factor/verify-totp` 10/60s.
- **`requireOrg()` re-reads the workspace role from the `member` row** on every request. The session
  is identity; it is not authority.
- **Our own WebAuthn/passkey plugin**, so passkeys are first-class rather than an add-on — which is
  also what makes the 3.3.9 Accessible Authentication (Enhanced) claim possible.
- **A full document load after sign-in** (`window.location.assign`), not a client navigation, so the
  shell loader sees the session cookie on its first run.
- `advanced.cookiePrefix: 'mtr'`, `generateId: () => nanoid(24)`.
- A personal organization is auto-provisioned in `user.create.after` and `session.create.before`,
  inserting the organization and the membership in one `db.batch` with a slug retry ladder.

## Consequences

Every authenticated request pays a KV read. KV reads are fast and cheap, but they are not free and
they are eventually consistent — a session written in one region can take a moment to be readable in
another, which we accept because a just-signed-in user's first request follows the write closely
enough in practice and a miss falls through to D1.

Better Auth's column naming is a live constraint: its `admin` plugin addresses columns **by property
key**, so the auth schema keeps camelCase keys (`banReason`, not `ban_reason`) while every domain
table uses snake_case. Two conventions in one schema module looks like an inconsistency and is not;
it is documented at the top of the schema file so nobody "fixes" it.

We own upgrades. A breaking change in Better Auth is our migration to perform, and the plugin-order
and `disabledPaths` subtleties above are exactly the sort of thing a minor release can move.

In exchange, the account record and the organization model live in our own database, tenancy and
identity share one source of truth, there is no per-MAU bill, and there is no five-minute window in
which a revoked role still works.
