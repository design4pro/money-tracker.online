# 04 — Authentication and tenancy

## Area brief

Better Auth on Cloudflare with sessions in KV, the workspace (organization) model that is the unit of
isolation and billing, the **tenant-scoped repository base** that makes forgetting a tenant filter
inexpressible, and the auth screens.

This plan carries the single most load-bearing piece of code in the repository: `src/server/repos/
base.ts`. `docs/adr/0002-tenant-scoped-repository-boundary.md` is the decision; this plan is the
implementation and the test suite that keeps it honest.

Two dictionaries that are never mixed (`docs/SPEC.md` §5.3): **platform roles** (`admin | curator |
user`, from `user.role`) and **workspace roles** (`owner | admin | member`, from `member.role`). A
helper that takes "a role" without saying which is a defect.

What this plan does not own: the settings surfaces for security, members and sessions (plan `23`),
the platform console (plan `24`), and billing entitlements (plan `22`).

---

## Stage 04-S1 — Better Auth, KV sessions, and workspace provisioning

Delivered: 2026-10-09 - the auth code under `src/server/auth/` (`config.ts`, `index.ts`, `organization.ts`, `guards.ts`, `permissions.ts`, `db.ts`, `email.ts`, `env.ts`, `secondary-storage.ts`, `tenant.ts`) and the route `src/routes/api/auth/$.ts`, with the tests `config.test.ts`, `guards.test.ts`, `organization.test.ts`, `permissions.test.ts`, `secondary-storage.test.ts`, `email.test.ts`, `organization-route.test.ts` and `auth.workerd.test.ts` (#620 the deterministic personal-workspace id and the retry, #621 the configuration, hooks and KV adapter pinned, #623 a real email sign-up driven through Better Auth in workerd, #624 the create-organization route closed, #625 further pins); `pnpm vitest run src/server/auth --project=server` passes 116 tests in 7 files and `pnpm test:workerd` passes 14 tests in 4 files, `auth.workerd.test.ts` among them, so an end-to-end sign-up was driven; ADR 0011 carries the matching `## Amendment`.

### Stage id

`04-S1` · Wave 1 · effort **XL**.

### Reference rows

`AUTH-01 missing → done` — the Better Auth configuration with KV secondary storage.
`AUTH-02 missing → done` — automatic personal-workspace provisioning.
`AUTH-03 missing → done` — `requireUser` / `requireOrg` and the two role dictionaries.

### Owned paths

- `src/server/auth/config.ts` — new
- `src/server/auth/index.ts` — new
- `src/server/auth/organization.ts` — new
- `src/server/auth/guards.ts` — new
- `src/server/auth/permissions.ts` — new
- `src/server/auth/db.ts`, `email.ts`, `env.ts`, `secondary-storage.ts`, `tenant.ts` — new
- `src/routes/api/auth/$.ts` — new
- `src/server/auth/__tests__/guards.test.ts` — new
- `src/server/auth/__tests__/organization.test.ts` — new
- `src/server/auth/__tests__/permissions.test.ts` — new
- `src/server/auth/__tests__/config.test.ts`, `secondary-storage.test.ts` — new
- `src/server/auth/__tests__/auth.workerd.test.ts` — new, with the fake auth bindings in the workerd
  project's `miniflare.bindings` in `vitest.config.ts`
- `src/server/auth/__tests__/harness.ts` — new, shared by the tests above

`organization.ts` writes `organization_currencies` outside `src/server/repos` by design: the
workspace it would need a `TenantScope` for is created by the same batch (see the docblock of
`organization.ts`). This is a third departure from the two exceptions `docs/SPEC.md` §5.2 documents,
and §5.2 does not record it yet.

### Data and migration

Every table exists from `00-S1`. No schema change and no migration.

Column keys stay **camelCase in TS** across the Better Auth tables, because the `admin` plugin
addresses columns by property key. This is restated here rather than assumed, because it is the kind
of thing a well-meaning refactor "fixes".

### Server (repo, server function, Zod)

- **Configuration**, and each of these is load-bearing rather than stylistic:
  - `secondaryStorage` is the `SESSIONS` KV binding. Sessions, OAuth state and rate-limit counters
    live there, with a 60 s TTL floor (the KV minimum) on every write that carries a TTL.
  - **No `cookieCache`.** A signed session snapshot is a window — five minutes by default — in which
    a banned or removed account keeps authority. The cost is a KV read per request; the alternative
    is an authorisation decision made from stale data.
  - `verification.storeInDatabase: true`.
  - `disabledPaths` at **top level**, not inside `admin({})` — inside, it is silently ignored. It
    closes the fifteen `admin` paths and `/organization/create` on the HTTP surface.
  - Plugins, in order: `admin()` **first**, then `twoFactor` and `organization`. The passkey plugin
    is not installed yet (`04-S4`).
  - `rateLimit` with per-path custom rules, seven in all — the four of ADR 0011 first:
    `/sign-in/email` 10/60 s, `/sign-up/email` 5/300 s, `/request-password-reset` 5/300 s,
    `/two-factor/verify-totp` 10/60 s; then `/reset-password` 10/300 s, `/send-verification-email`
    5/300 s and `/two-factor/verify-backup-code` 5/300 s.
  - `advanced.cookiePrefix: 'mtr'`, `advanced.database.generateId: () => nanoid(24)`.
- **`resolveOrProvisionOrganization`** runs in `user.create.after` **and** `session.create.before`.
  It inserts the organization, its owner `member` row and the workspace's `organization_currencies`
  rows in **one `db.batch`**. A failed batch is retried, at most four attempts, and the cause is read
  from database state, never from the error: the other call won, the id is held, or the slug is held.
  Both hooks, because a user created before this shipped would otherwise have no workspace and every
  guard would fail for them. **One auto-provisioned personal workspace per user is held by the
  deterministic personal-workspace id** (a primary key derived from the user id), **not by the slug
  index**: two concurrent calls insert the same key and exactly one batch wins.
- **`requireOrg()` re-reads the role from `member`**, never from a session claim. A claim is a
  snapshot; a membership is a fact, and a member demoted a minute ago must not still be an admin.
- `permissions.ts` exports `permits(actor, request)` as a **pure predicate**; `actor` carries `role`,
  `banned` and `impersonatedBy`, and `request` is a platform permission statement. The console's render
  flags derive from the same helper as its guards, so a button cannot appear for an action the guard
  will refuse.
- **Ledger batching.** Not applicable: no balance changes.

### UI (route, components)

- **Route.** `src/routes/api/auth/$.ts` mounts Better Auth. It is a server-only handler; the auth
  **screens** are `04-S4`.
- **Components.** None.
- **States.** Not applicable.
- **Tokens.** None.
- **Accessibility.** None specific at this layer; `04-S4` carries the screens' obligations, including
  the 3.3.9 accessible-authentication claim of `docs/ACCESSIBILITY.md` §3.

### Quota

`seats` is metered against `member` rows. The `assertWithinLimit(scope, 'seats', current + 1)` call
site is in the invitation-acceptance path, which is `23-S4`; the **provisioning** path here creates
the owner's own seat and is exempt by definition — a workspace with zero seats is not a state.

### Tenant isolation test

This stage does not add a tenant repository, so it adds no case to
`tenant-isolation.test.ts`. What it adds instead, in `guards.test.ts`, is the precondition every case
there depends on: `requireOrg` returns a scope whose `organizationId` is the **membership's**, and a
forged `organizationId` in the request payload is ignored rather than honoured. A guard that trusts a
client-supplied tenant id makes every downstream isolation test meaningless.

### Money invariant

This stage writes no amount. It does write the workspace's `organization_currencies` rows at
provisioning time, with `is_base` set on a fixed `PLN` beside `EUR`, `USD` and `GBP`, and **that
base is the anchor for every `ref_amount` the workspace will ever store**. Deriving the base from the
locale was considered and deferred; a personal workspace's base is chosen only through the `26-S*`
onboarding for workspaces it creates. The case `organization.test.ts` → _a provisioned workspace
always has exactly one base currency_ asserts the one `is_base` row, that it is a code present in the
catalogue and that the four codes are the ones written — a workspace with no base currency cannot
compute a single report.

### Verification

- Command gate.
- `guards.test.ts`: `requireUser` rejects an absent session; `requireOrg` re-reads the role; a forged
  `organizationId` is ignored.
- `permissions.test.ts`: the two role dictionaries are separate types and mixing them is a type
  error, asserted with `expectTypeOf` and checked by `pnpm typecheck`.
- `config.test.ts`: both hooks provision, and running both leaves one workspace.
- `organization.test.ts`: provisioning is one batch; a collision retries; one
  personal workspace per user under a race; exactly one base currency is always set.
- `auth.workerd.test.ts`: a real email sign-up through `betterAuth(authOptions())` in workerd,
  showing the session key in `SESSIONS` and the workspace row in `DB`. It replaces the manual
  `wrangler dev` sign-up.
- No browser evidence and no axe run: the screens are `04-S4`.

### Definition of done

§7 items 1–3 and 5–7. Item 4 does not apply (no surface).

### Blockers

None.

Owed elsewhere and not fixed here: `FND-02` in `00-foundations.md` and the Data section of
`02-i18n.md` name `04-S1` as the owner of `organization_settings.locale` and
`user_preferences.locale`, and `04-S1` creates neither (`23-S2` and `00-S14` requisition them); and
the money-invariant text of `04-S3` reads `settings.base_currency_code`, which does not exist.

---

## Stage 04-S2 — The tenant-scoped repository base

### Stage id

`04-S2` · Wave 1 · effort **L**. The deep module of this codebase.

### Reference rows

`AUTH-04 missing → done` — `TenantScope`, `createScope`, `tenantFilter`, `createTenantRepository`.
`AUTH-05 missing → done` — `assertScopedWrite` and the empty-predicate refusal.
`AUTH-06 missing → done` — the isolation suite's harness.

### Owned paths

- `src/server/repos/base.ts` — new
- `src/server/repos/scope.ts` — new
- `src/server/repos/errors.ts` — new
- `src/server/repos/pagination.ts` — new
- `src/server/repos/__tests__/tenant-isolation.test.ts` — new
- `src/server/repos/__tests__/base.test.ts` — new
- `src/server/repos/__tests__/helpers.ts` — new

### Data and migration

None. This stage adds no table; it adds the only sanctioned way to reach one.

### Server (repo, server function, Zod)

- `createScope(db, context)` is the **only** constructor of a `TenantScope`. There is no other way to
  make one, and `TenantScope`'s fields are `readonly`, so a caller cannot rewrite the tenant after
  the fact.
- `tenantFilter(scope, table, ...extra)` returns a `SQL` that **always** includes
  `eq(table.organizationId, scope.ctx.organizationId)`. Callers append predicates; they cannot remove
  that one. Forgetting the tenant filter is not expressible.
- `createTenantRepository(table, entityName)` gives `get`, `list`, `page`, `insert`, `insertMany`,
  `update`, `remove`. `insertMany` **stamps** `organizationId` from the scope, so a payload cannot
  override it. `TenantPatch<T>` is `Partial<Omit<T['$inferInsert'], 'organizationId' | 'id' |
'createdAt'>>` — the three fields a patch may never carry are removed by the type, not by a runtime
  check that someone can forget.
- `page()` is **keyset on `desc(table.id)`** — ids are creation-sortable, so the primary key is the
  cursor and no `OFFSET` scan exists in the product. `DEFAULT_PAGE_SIZE = 25`, `MAX_PAGE_SIZE = 100`.
- `assertScopedWrite(predicates)` throws when a write composes to an empty predicate list, with the
  message _"refusing to write to every row of `<table>`"_. This is the backstop for the case the type
  system cannot see: a dynamically built `and(...)` that collapses to nothing.
- `errors.ts` exports `NotFoundError`, `ForbiddenError`, `ConflictError`, `QuotaExceededError`,
  `FeatureLockedError`, `RateUnavailableError`. **A cross-tenant read is a `NotFoundError`, never a
  `ForbiddenError`** — "not seeing is indistinguishable from not existing", and a 403 confirms the
  row exists.
- **Ledger batching.** `base.ts` exposes the hook `runWithLedgerBatch` binds to; the implementation is
  `09-S2`. The seam exists here so no repository has to be edited later to gain it.

### UI (route, components)

None.

### Quota

`assertWithinLimit` is called **inside the repository, before the write** — this stage defines the
signature and the call convention; `22-S1` provides the resolver. Defining the seam now is what makes
every later stage's quota heading answerable with a call site instead of a promise.

### Tenant isolation test

**This stage creates the suite.** `helpers.ts` builds two workspaces, A and B, each with a member,
and exposes `expectIsolated(repo, fixtures)` — the harness every later stage adds one line to.
`tenant-isolation.test.ts` starts with the base repository itself: A, in A's scope, tries to `get`,
`list`, `page`, `update` and `remove` B's rows by id; every one is a `NotFoundError`, and B's rows are
byte-identical afterwards.

The suite also asserts the **shape** of a violation: a repository function reachable without a
`TenantScope` is a type error, held by a `@ts-expect-error` fixture, so the property is checked at
compile time and not only at runtime.

### Money invariant

This stage moves no amount, and it is the reason every later amount is safe: an amount read under the
wrong scope is worse than a wrong amount, because it is somebody else's. Stated rather than skipped.
The one money-shaped guarantee it does make is that `page()`'s keyset cursor is the **id**, never a
sum or a running balance — a cursor derived from an amount changes meaning when the amount is edited,
which produces a page that silently skips rows.

### Verification

- Command gate.
- `base.test.ts`: the filter is always present; `insertMany` stamps and cannot be overridden; a
  `TenantPatch` carrying `organizationId` is a type error; `assertScopedWrite` throws on an empty
  predicate list; keyset paging returns each row exactly once across pages with concurrent inserts.
- `tenant-isolation.test.ts` as above.
- No browser evidence and no axe run: no surface.

### Definition of done

§7 items 1–3 and 5–7. Item 4 does not apply (no surface).

### Blockers

None.

---

## Stage 04-S3 — The app shell, the guard and the session context

### Stage id

`04-S3` · Wave 1 · effort **M**.

### Reference rows

`AUTH-07 missing → done` — `_app/route.tsx` with `loadShell()` and the redirect.
`AUTH-08 missing → done` — `safeRedirect()`.

### Owned paths

- `src/routes/_app/route.tsx` — new
- `src/routes/_app/-server/shell.ts` — new
- `src/routes/_app/-ui/app-shell.tsx` — new
- `src/routes/_app/-ui/workspace-switcher.tsx` — new
- `src/lib/safe-redirect.ts` — new
- `src/lib/__tests__/safe-redirect.test.ts` — new
- `e2e/shell.visual.spec.ts` — new

### Data and migration

None. `loadShell()` reads the session, the membership, the workspace settings and the user
preferences in **one batched query**, because every guarded route needs all four and a shell that
costs four round trips costs them on every navigation.

### Server (repo, server function, Zod)

- **Server function.** `loadShell()` (GET) returns `{ user, organization, member, settings,
preferences, entitlements }` or `null`. `_app/route.tsx`'s `beforeLoad` redirects to
  `/login?redirect=<current>` when it is `null` and otherwise puts the result into router context, so
  every screen below gets the session without a refetch.
- **Zod.** No input.
- **Authorisation.** `beforeLoad` is **UX, never a data boundary**. Every server function below `_app`
  calls `requireOrg()` itself. This is written into the stage because the opposite belief is the most
  common way a guarded-looking app leaks.
- `safeRedirect(target)` is a hard open-redirect guard: the target must start with `/`, and `//`,
  `/\`, control characters, and a loop back to `/login` are rejected. It returns `/dashboard` when the
  target fails, never the raw input.
- **Ledger batching.** Not applicable.

### UI (route, components)

- **Route.** `src/routes/_app/route.tsx`, SSR default. It is the layout for every guarded surface.
- **Components.** `app-shell.tsx` (skip link, header, primary navigation, main landmark, toast host)
  and `workspace-switcher.tsx`. Reuses `Menu`, `Popover`, `Avatar`, `Separator` and `Link` from
  `src/components/ui`.
- **States.** The shell's own async state is resolved before render by `beforeLoad`, so it has no
  skeleton of its own; each child route owns its own. The **error** state is the root error boundary
  rendering `ErrorPanel` (owned by `05-S2`) inside the shell so navigation survives a route failure.
- **Tokens.** None new. The shell's stacking order comes from the z-index ladder in `tokens.css`.
- **Accessibility.** A **skip link** as the first focusable element. The header is `position: sticky`
  and is measured against `docs/ACCESSIBILITY.md` §3's 2.4.11 / 2.4.12 claim: a focused element must
  never be obscured by it, which is a `scroll-padding-top` equal to the header's height, tested
  rather than eyeballed. `<main>` receives focus on route change and the route title is announced.

### Quota

No countable row. `loadShell()` returns `entitlements` so no child route has to fetch them; the
resolver is `22-S1` and until it lands the field is the free-plan default.

### Tenant isolation test

`loadShell()` returns the **member's** organization and never one named by the client. The case in
`tenant-isolation.test.ts`: a session belonging to A, with a cookie or search param claiming B's
organization id, still resolves to A. Function covered: `loadShell`.

### Money invariant

The shell carries `settings.base_currency_code` into context, and **it is the only source of the base
currency for every screen below**. A screen that reads a base currency from anywhere else — a prop
drilled from a list row, a per-account guess — will eventually disagree with the ledger. Held by
`money-invariants.test.ts` → _the base currency has one source_, which greps the route tree for a
second read of `base_currency_code` outside the shell loader and the repositories.

### Verification

- Command gate.
- `safe-redirect.test.ts`: `/dashboard` passes; `//evil.example` , `/\evil`, `https://evil.example`,
  `/login`, a `\r\n` injection and an empty string all fall back to `/dashboard`.
- Browser evidence: `/dashboard` shell (with the child route's content stubbed), both themes, at
  **360 / 1280 / 2560 px**, plus the workspace switcher open and the skip link focused — the two
  interaction states that are the point of the stage.
- `e2e/shell.visual.spec.ts` also asserts the sticky-header obscuring rule: tab to an element just
  below the fold and assert its bounding box is fully inside the viewport and below the header.
- axe on the shell route: zero `serious`, zero `critical`.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 04-S4 — The auth screens

### Stage id

`04-S4` · Wave 1 · effort **L**.

### Reference rows

`AUTH-09 missing → done` — login, register, forgot / reset password, verify email, two-factor.
`AUTH-10 missing → done` — invitation acceptance.
`AUTH-11 missing → done` — passkeys as a first-class sign-in path.

### Owned paths

- `src/routes/(auth)/route.tsx` — new
- `src/routes/(auth)/login.tsx` — new
- `src/routes/(auth)/register.tsx` — new
- `src/routes/(auth)/forgot-password.tsx` — new
- `src/routes/(auth)/reset-password.tsx` — new
- `src/routes/(auth)/verify-email.tsx` — new
- `src/routes/(auth)/two-factor.tsx` — new
- `src/routes/(auth)/accept-invitation.$invitationId.tsx` — new
- `src/routes/(auth)/-server/auth-config.ts` — new
- `src/routes/(auth)/-ui/auth-card.tsx` — new
- `src/routes/(auth)/-lib/schemas.ts` — new
- `src/server/auth/passkey/**` — new
- `e2e/auth.visual.spec.ts` — new

### Data and migration

None. `passkey` and `two_factor` exist from `00-S1`.

### Server (repo, server function, Zod)

- **Server function.** `loadAuthConfig()` (GET) returns `{ socialProviders, signedIn, email }` so the
  provider buttons are present in the **first paint** rather than appearing after hydration. Every
  auth screen's `beforeLoad` calls it and redirects when already signed in.
- **Zod.** `-lib/schemas.ts` exports a **factory** taking `{ t, locale }`. Zod bakes its messages at
  construction, and these screens run before any stored language preference exists, so a module-level
  schema would be permanently English. This is the requirement `02-S2` recorded.
- **Authorisation.** These routes are outside `_app`; there is no session in context by design.
- **After a successful sign-in, do a full document load** (`window.location.assign`), not a client
  navigation, so the shell loader sees the session cookie on its first run. A client navigation here
  produces an intermittently-empty shell that is very hard to reproduce.
- `src/server/auth/passkey/**` is our own WebAuthn plugin (`99-boundaries-and-blockers.md` BND-32).

### UI (route, components)

- **Route.** The `(auth)` pathless group, SSR default. All eight screens.
- **Components.** `auth-card.tsx` is the shared frame. Reuses `TextField`, `Button`, `Link`,
  `Separator`, `FieldError` and `Form` from `src/components/ui`.
- **States.** Empty: not applicable (forms). Skeleton: none — `loadAuthConfig` resolves in
  `beforeLoad`, so the first paint is complete. Error: field errors inline with
  `aria-describedby`, and a form-level `ErrorPanel` for a server failure with a Retry that does not
  clear the entered email.
- **Tokens.** None new.
- **Accessibility.** This is the surface `docs/ACCESSIBILITY.md` §3 claims **3.3.9 Accessible
  Authentication (Enhanced)** on, so the claim is kept here or nowhere: no cognitive function test at
  any step — no puzzle, no image identification, no transcription of a distorted character; passkeys
  are offered as a first-class path; the password field allows paste and offers a reveal toggle; the
  two-factor code field is `inputmode="numeric"` with `autocomplete="one-time-code"`. **Any change to
  these screens re-checks the 3.3.9 claim**, and that sentence is in the stage so it reaches the
  agent that edits them next.

### Quota

`accept-invitation` consumes `seats`, and `assertWithinLimit(scope, 'seats', current + 1)` sits in
the acceptance repository call **before** the `member` insert. A seat over the limit is a
`QuotaExceededError` with customer-facing copy naming the plan, not a stack trace.

### Tenant isolation test

Invitation acceptance is the one path where a caller legitimately acts on another workspace's row, so
it gets the sharpest case: an invitation id belonging to B, presented by a user whose email does not
match the invitation, is a `NotFoundError` — not a `ForbiddenError`, because that confirms the id
exists. Functions covered: `loadInvitation`, `acceptInvitation`.

### Money invariant

These screens render no amount. What they do decide is the **workspace a new member joins**, and
therefore which base currency their figures are reported in. The invitation-acceptance copy names the
workspace and its base currency before the person accepts, because joining a household that reports
in a different currency than you expect is a surprise that shows up as "all my numbers are wrong".
No test file; the requirement is a copy key asserted present by `02-S2`'s parity test.

### Verification

- Command gate.
- Unit: the schema factory produces Polish messages for `locale: 'pl'`; `loadAuthConfig` omits a
  provider whose secret is unset (rather than rendering a button that 500s).
- Browser evidence: `/login`, `/register`, `/two-factor` and `/accept-invitation/$id`, **both
  locales**, both themes, at 360 / 1280 / 2560 px, plus the invalid-credentials error state and the
  passkey prompt state.
- `e2e/auth.visual.spec.ts` runs axe on all eight routes: zero `serious`, zero `critical`.
- Console silent, including during the full-document-load sign-in.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.
