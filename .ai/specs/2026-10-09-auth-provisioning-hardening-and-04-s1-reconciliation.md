# Auth configuration pinned by tests, provisioning hardened against a slug race, and plan stage 04-S1 reconciled

| Field              | Value                                     |
| ------------------ | ----------------------------------------- |
| **Status**         | ready                                     |
| **Issue**          | none                                      |
| **Spec PR**        | #TBD                                      |
| **Implementation** | none                                      |
| **Plan**           | 04-S1 (docs/plans/04-auth-and-tenancy.md) |

## 📝 TLDR

Plan stage `04-S1` ("Better Auth, KV sessions, and workspace provisioning",
`docs/plans/04-auth-and-tenancy.md`) was written before the code, and the first vertical slice
(`c70f8bd`) has since delivered nearly all of it: the Better Auth configuration, the KV secondary
storage, both provisioning hooks, `requireUser` / `requireOrg`, the pure `permits` predicate and the
`/api/auth/$` mount all exist and 67 tests in `src/server/auth/__tests__` pass. What is left is the part
that makes the stage's decisions _hold_ rather than merely _be true today_, plus a plan that describes
tables the code does not have. This spec covers that.

- **Phase 1 (code and tests).** Make the personal workspace's id deterministic per user (so the primary key
  arbitrates the race between the two provisioning hooks), close the check-then-insert race in
  `provisionPersonalWorkspace`'s slug ladder, and add the stage's missing money-invariant case: a provisioned workspace always has exactly
  one base currency.
- **Phase 2 (tests).** Pin the load-bearing configuration (no `cookieCache`, `storeInDatabase`, top-level
  `disabledPaths`, `admin()` first, the rate-limit rules, both hooks) and the KV adapter's 60 s TTL floor,
  and prove the two role dictionaries are separate types without an `@ts-expect-error`.
- **Phase 3 (a workerd test, timeboxed).** A real sign-up through `betterAuth(authOptions())` on the real
  `SESSIONS` and `DB` bindings, replacing the plan's manual `wrangler dev` check.
- **Phase 4 (documents).** Amend the plan block and ADR 0011 to what the code is, and add the `Delivered:`
  line last.

No schema change, no migration, no new dependency, no screen.

## 📝 Problem Statement

Verified against the repository at the time of writing (commands in Resolved assumptions row 8).

**What the code already delivers**

- `src/server/auth/config.ts` (`authOptions()`): `secondaryStorage` on the `SESSIONS` KV
  (`createKvSecondaryStorage`, `src/server/auth/secondary-storage.ts`, which clamps every TTL up to the
  60 s KV floor), **no `cookieCache`** (with the reason in a comment), `verification.storeInDatabase: true`,
  `disabledPaths: DISABLED_ADMIN_PATHS` at top level, `plugins: [admin(adminOptions), twoFactor, organization]`
  with `admin` first, `rateLimit` on `secondary-storage` with seven custom rules (the four of ADR 0011
  plus `/reset-password`, `/send-verification-email` and `/two-factor/verify-backup-code`),
  `advanced.cookiePrefix: 'mtr'` and `generateId: () => nanoid(24)`.
- `src/server/auth/organization.ts`: `provisionPersonalWorkspace` inserts the `organization`, the owner
  `member` and the workspace's `organization_currencies` rows (PLN base, EUR, USD, GBP) in **one
  `db.batch`**; `resolveOrProvisionOrganization` is idempotent and is called from both
  `user.create.after` and `session.create.before` in `config.ts`.
- `src/server/auth/guards.ts` + `tenant.ts`: `requireOrg` re-reads the role from `member`
  (`membershipRoleFor`), returns a `TenantScope` built by `createScope`, and treats an
  `organizationId` option as an assertion that must match the membership, never a selector.
  `guards.test.ts` covers a forged id, a demotion between requests, a banned account, a missing
  session and an unknown role.
- `src/server/auth/permissions.ts`: the platform dictionary and `permits(actor, request)` as a pure
  predicate, with `permissions.test.ts` (20 cases).
- `src/routes/api/auth/$.ts` mounts `handleAuthRequest` for `GET`, `POST` and `OPTIONS`.

Test counts, by file: `guards.test.ts` 14, `organization.test.ts` 16, `permissions.test.ts` 20,
`email.test.ts` 17; 67 in 4 files, all passing.

**What does not hold**

1. **The plan names a table that does not exist and a default the code does not apply.** The money
   invariant says provisioning writes `organization_settings.base_currency_code`, "defaulted from the
   negotiated locale's country". There is no `organization_settings` table (`src/server/db/schema.ts`
   lines 52-66 leave it to a later plan; `docs/plans/23-settings.md` now calls it `workspace_settings`
   and requisitions it into `00-S14`). The base currency lives in `organization_currencies`
   (`is_base = 1`, one per workspace by the partial unique index
   `organization_currencies_one_base_per_org_unique`), and provisioning uses the constant
   `DEFAULT_BASE_CURRENCY_CODE = 'PLN'` with no locale: the session hook has no request at all, and
   only two locales ship, one of them (`en`) with no country.
2. **The stage's money-invariant case is missing.** Nothing asserts that a provisioned workspace has
   exactly one base currency that is a catalogue code, or that a failed batch leaves no half-written
   workspace. `organization.test.ts` never reads `organization_currencies`; the only test of
   `DEFAULT_BASE_CURRENCY_CODE` is of the constant itself.
3. **The slug "retry ladder" is check-then-insert, and nothing makes a workspace per user unique.**
   `reserveSlug` reads each candidate and returns the first free one; the batch then inserts it. Two
   provisions that read the same base slug before either inserts (two people of the same name signing
   up at once) make the loser's batch fail on `organization_slug_unique`; the batch is atomic, so
   nothing partial lands, but the exception leaves the hook and the sign-up request errors while the
   `user` row already exists. Worse, the same user's two hooks (which `organization.ts` says do not
   await each other) can interleave so that hook A's batch commits _after_ hook B passed
   `firstOrganizationIdFor` with no rows and _before_ B calls `reserveSlug`: B then sees the base slug
   taken, draws a random suffix and its batch **succeeds**, so the user ends with two workspaces and no
   error. The only unique indexes are `organization_slug_unique` and
   `member_organization_id_user_id_unique` (`src/server/db/auth-schema.ts` lines 238 and 255);
   nothing is unique on `member.user_id`. The existing slug tests are sequential and reach neither.
4. **The load-bearing configuration is asserted nowhere.** No test calls `authOptions()`. A refactor
   that adds `session.cookieCache`, moves `disabledPaths` into `admin({})`, reorders `plugins`, drops
   `storeInDatabase` or removes one provisioning hook keeps every current test green. The plan's
   `organization.test.ts` case "both hooks provision" is therefore unproven, and
   `secondary-storage.ts` (the 60 s floor, `increment`'s window, `getAndDelete`) has no test.
5. **The two-dictionaries proof is not where the code says it is, and the plan asks for a forbidden construct.**
   `permissions.ts` line 14 says `permissions.test.ts` "holds a `@ts-expect-error` fixture proving one
   cannot be passed where the other is wanted"; it does not, and `AGENTS.md` forbids
   `@ts-expect-error` in any case. `tsc --noEmit` covers test files (`tsconfig.json` includes
   `**/*.ts`), so a type-level assertion with `expectTypeOf` is checked by `pnpm typecheck`. (The
   claim is overstated rather than empty: `tenant-isolation.test.ts` line 690 already assigns `'curator'`
   to the workspace role type under a `@ts-expect-error`, which is a pre-existing deviation from the
   `AGENTS.md` rule and is not touched here. The new assertion states the property of the two
   dictionaries as a whole, and does not depend on that line.)
6. **The manual check is not repeatable.** "A manual sign-up against `wrangler dev` showing the session
   key in local KV and the workspace row in local D1" cannot be run unattended, and the Node harness
   cannot show that D1 accepts the SQL Drizzle generated (the purpose of the `workerd` project,
   ADR 0015).
7. **The stage text is stale in three more places.** The owned paths omit `db.ts`, `email.ts`, `env.ts`,
   `secondary-storage.ts`, `tenant.ts` and the test harness; the stage lists no `config.test.ts`;
   `docs/plans/00-foundations.md` (`FND-02`) and `docs/plans/02-i18n.md` name `04-S1` as the owner of
   `organization_settings.locale` and `user_preferences.locale`, which this stage's own data section
   says it does not create. The stage carries no `Delivered:` line, so `backlog-status.mjs --plan` keeps
   offering it.

A stage with an unpinned decision is not delivered, so it is not marked delivered today.

## 📝 Proposed Solution

Four phases, one small pull request each. Stage `04-S1` is this whole spec.

- **Phase 1.** `provisionPersonalWorkspace` gives a user's personal workspace a **deterministic id**
  (so the primary key arbitrates a same-user race), retries its batch on a slug collision (detected
  from database state, not from error text), reuses a concurrent winner for the same user, and the
  base currency invariant gets its test.
- **Phase 2.** `config.test.ts`, `secondary-storage.test.ts`, the role-dictionary type assertion, and
  the false claim in `permissions.ts` corrected.
- **Phase 3.** `auth.workerd.test.ts`, one end-to-end sign-up in workerd, with a stated fallback.
- **Phase 4.** Plan block, ADR 0011 amendment, hand-off sentences, `Delivered:` line.

Out of scope, and why: deriving the base currency from the locale (Resolved assumptions row 1); any
auth screen (`04-S4`); the `organization_settings` / `workspace_settings` and `user_preferences`
tables (`23-S2`, `00-S14`); a passkey plugin (`04-S4` / `AUTH-09`, ADR 0011); seat metering
(`23-S4`).

## 📝 Architecture

- **Owner modules, unchanged.** `src/server/auth/organization.ts` owns provisioning;
  `src/server/auth/config.ts` owns the option set; `src/server/auth/secondary-storage.ts` owns the KV
  adapter; `src/server/auth/permissions.ts` owns the platform dictionary and `permits`;
  `src/server/repos/scope.ts` owns the workspace dictionary (`OrganizationRole`). No new concept, no
  new module.
- **Provisioning is the documented exception to the repository layering.** It writes
  `organization_currencies` outside `src/server/repos` because no `TenantScope` can exist before the
  workspace it names (`organization.ts` docblock; `docs/SPEC.md` §5.2 lists only `catalog` and
  `billing_events`, so the docblock is the record and Phase 4 mentions it in the plan block). This
  spec adds no SQL anywhere else.
- **Seams.** `provisionPersonalWorkspace(db: AppDatabase, user)` keeps its signature. The retry loop
  wraps only the `db.batch` call. The tests use the existing real-SQLite harness
  (`__tests__/harness.ts`), whose `batch` runs inside `BEGIN`/`ROLLBACK`, so atomicity is observable.
  `config.test.ts` mocks `cloudflare:workers` and `./db` (the narrow exception the `server` project
  allows, precedent `src/server/fns/__tests__/attachments.test.ts`); `secondary-storage.test.ts`
  passes an in-memory KV fake as an argument; the workerd test uses the real bindings.
- **One auto-provisioned personal workspace per user is enforced by the primary key.** The personal workspace's
  `organization.id` is a pure function of the user id: `personalWorkspaceId(userId)`, 24 URL-safe
  characters (the shape of every id in the auth tables), for example the first 24 characters of the
  base64url SHA-256 of a fixed prefix plus the user id, via `crypto.subtle` (available in Workers and
  Node). Two concurrent provisions for one user therefore insert the same primary key and exactly one
  batch commits, whichever slug each drew. The hash is deliberately plain and unkeyed: an HMAC keyed with `BETTER_AUTH_SECRET` would stop
  being deterministic the day the secret rotates, and the id protects nothing by being secret
  (`requireOrg` treats an id as an assertion checked against `member`, never as a selector). No
  migration: the id is an ordinary text value, and
  accounts that already have a workspace keep theirs (they are found by `firstOrganizationIdFor`
  before any insert).
- **Phase 1 algorithm.** Up to 4 attempts around `db.batch` only. Attempt 1 uses the deterministic id
  and `reserveSlug`'s result. On a thrown batch error, in this order: (1)
  `firstOrganizationIdFor(db, user.id)`; if it returns a workspace, return it (the other hook won);
  (2) select the attempted `organization.id`; if present, that id is held by a workspace this user has
  no membership in (step 1 found none), so the next attempt uses a random `nanoid(24)` id, which keeps
  sign-in from ever being blocked in that state at the price of the race protection (Edge Cases);
  (3) select the attempted slug; if present, take the next rung (a fresh `base-<nanoid(6)>`, the last
  rung `base-<nanoid(12)>`) and regenerate the `member` id; (4) if neither is present, or the attempts
  are spent, **rethrow the original error**. The error text is never parsed: SQLite and D1 report
  `UNIQUE constraint failed: organization.slug` (or `organization.id`), which names columns and not
  the index, D1 wraps the error again, and the harness rethrows the raw `node:sqlite` error, so a
  string match could pass in the test and miss on D1 (`src/server/repos/notifications.ts` lines
  16-30 say the same). A batch that succeeds ends the loop.
- **The re-read comes before any retry** because after a primary-key failure the winner's workspace
  is the right answer for this user, and only the re-read can tell.

## 📝 Data Model

No schema change and no migration. `organization`, `member` and `organization_currencies` exist from
`00-S1`; `drizzle/` is untouched and `pnpm db:generate` must leave the diff clean. Column keys stay
camelCase in TS across the Better Auth tables (the `admin` plugin addresses columns by property key);
restated because it is the kind of thing a well-meaning refactor "fixes".

## 📝 API Contracts

No server function and no route is added or changed. The one signature that matters, unchanged:

```ts
// src/server/auth/organization.ts
export function provisionPersonalWorkspace(
  db: AppDatabase,
  user: { id: string; name?: string | null; email: string },
): Promise<string> // the organization id: new, or the existing one
```

- No Zod: the input is a Better Auth hook's own user record, not a caller-supplied value; the guards'
  Zod-twice rule applies to server functions, none of which is added.
- **Authorisation.** Provisioning is not a permission decision; it runs for the account that was just
  created or signed in. `requireOrg` still re-reads the role from `member` on every call and the
  precondition test (a forged `organizationId` is ignored) stays.
- No money amount is produced, so no float question arises (`docs/MONEY.md`). The only money-adjacent
  write is the base-currency row, covered by Phase 1.
- **Quota.** `seats`: the provisioning path creates the owner's own seat and is exempt by definition;
  `assertWithinLimit(scope, 'seats', current + 1)` belongs to invitation acceptance (`23-S4`).

## 📝 UI/UX

None. No route, component, state or token; `src/routes/api/auth/$.ts` is a server-only handler. The
auth screens and their accessibility obligations, including the 3.3.9 claim of
`docs/ACCESSIBILITY.md` §3, are `04-S4`.

## 📝 Edge Cases & Failure Scenarios

- **Two sign-ups with the same name at the same instant.** The loser's batch fails; the slug it tried
  is now present; it retries on the next rung and lands one workspace with a different slug.
- **One user, both hooks at once, either interleaving.** Both batches carry the same primary key, so
  one commits and the other fails; the re-read finds the winner's workspace and returns its id. This
  holds when the loser had already drawn the base slug, and when it drew a suffixed slug because the
  winner had committed first. Exactly one workspace and one membership.
- **A user creates further organizations by hand.** `config.ts` sets `allowUserToCreateOrganization:
true` with no `organizationLimit`, and `DISABLED_ADMIN_PATHS` lists only `/admin/*`, so a signed-in
  user can POST `/organization/create` for unlimited extra owner-role organizations, none of which has
  `organization_currencies` rows (no base currency). That is not a cross-tenant leak and not a
  regression from this spec, and the claim above is therefore about the _auto-provisioned_ workspace
  only. The route is out of scope here and should be filed as its own issue; note that creating an
  organization this way before provisioning makes `firstOrganizationIdFor` return it, so no personal
  workspace is provisioned for that user.
- **The deterministic id is held by a workspace the user has no membership in** (possible only if
  their owner membership was removed from their own personal workspace). The re-read finds nothing,
  the id is present, and the next attempt uses a random id so the user is never locked out. This
  state is outside the race protection; a test pins that sign-in still lands a workspace.
- **A batch fails for any other reason** (a foreign-key failure for a vanished user, say). The attempted
  slug is absent, the original error is rethrown, and the loop cannot spin. The rolled-back batch
  leaves no `organization`, `member` or `organization_currencies` row.
- **All four attempts collide.** The original error is rethrown; the next sign-in or `requireOrg` call
  provisions again (self-healing, as today).
- **A user row that is gone.** `resolveOrProvisionOrganization` still returns `null` and invents
  nothing.
- **Config drift.** Adding `session.cookieCache`, nesting `disabledPaths`, reordering plugins, dropping
  a hook or lowering a TTL below the floor fails Phase 2's tests by name.
- **Phase 3 cannot boot Better Auth in workerd** without a production-code change, a new dependency or
  more than a trivial edit to `src/server/worker.workerd-entry.ts`. The ticket ships Phase 2 alone,
  says in its pull request that no end-to-end sign-up was driven, and the `Delivered:` evidence says so
  (Resolved assumptions row 3).

## 📝 Risks & Impact Review

| Risk                                                                                         | Mitigation                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The retry loop, or a race between the two hooks, gives one user two personal workspaces.     | The workspace id is deterministic per user, so the primary key arbitrates; the re-read of `firstOrganizationIdFor` precedes any retry; the two same-user race tests and the different-user slug-collision test (Phase 1 step 1). |
| A string match on the collision error passes in the harness and misses on D1.                | Collision is detected from database state (the attempted slug is present), never from the message.                                                                                                                               |
| The fixed PLN base surprises a non-Polish household, and v1 cannot change a base afterwards. | Recorded as a product decision (row 1, ADR 0011 amendment); `26-S*` onboarding is where a base is chosen for workspaces it creates; the auto-provisioned personal workspace stays PLN until then.                                |
| The workerd test makes the suite slow or flaky.                                              | Timeboxed with a stated fallback; one file; it runs in `pnpm test:workerd`, which CI already runs.                                                                                                                               |
| The test-only `BETTER_AUTH_SECRET` binding leaks into a real environment.                    | It is an obviously fake literal under the workerd project's `miniflare.bindings` only; `wrangler.jsonc` and `.dev.vars*` are not read or edited; `EMAIL_API_KEY: ''` is pinned so no email is sent.                              |
| `config.test.ts` mocks hide a real wiring error.                                             | It asserts the option _values_ and drives both hooks against a real SQLite; Phase 3 covers the wiring end to end.                                                                                                                |

Tenant isolation: this stage adds no tenant repository and no repository function, so it adds no case
to `tenant-isolation.test.ts`. The precondition every case there depends on is already in
`guards.test.ts` (_a forged workspace id in the request is ignored rather than honoured_ and _a session
pinned to a workspace the caller has no row in is refused_); Phase 2 does not weaken either, and the
plan block says where they live. Money invariant: Phase 1 step 2 is the stage's invariant. No new
money-touching write path, so no `money-invariants.test.ts` case.

## 📝 Visual change expected

None. Backend and tests only: no route, component or state changes on screen in either theme, on
desktop or on mobile. No browser evidence and no axe run.

## 📝 Copy

None. This change adds no user-facing string, so no key lands in the EN or PL catalogue
(`i18n-messages` skill).

## 📋 Phasing

| Phase | Delivers                                                                                       | Files                                                                                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Deterministic personal-workspace id, slug retry on collision, the base-currency invariant test | `src/server/auth/organization.ts`, `src/server/auth/__tests__/organization.test.ts`                                                                                                             |
| 2     | Configuration and hooks pinned, KV adapter tested, role dictionaries proved separate           | `src/server/auth/__tests__/config.test.ts`, `src/server/auth/__tests__/secondary-storage.test.ts`, `src/server/auth/__tests__/permissions.test.ts`, `src/server/auth/permissions.ts` (docblock) |
| 3     | End-to-end sign-up in workerd (timeboxed)                                                      | `src/server/auth/__tests__/auth.workerd.test.ts`, `vitest.config.ts` (workerd `miniflare.bindings`)                                                                                             |
| 4     | Plan block, ADR 0011 amendment, hand-offs, `Delivered:` line                                   | `docs/plans/04-auth-and-tenancy.md`, `docs/adr/0011-better-auth-with-kv-session-store.md`                                                                                                       |

Four tickets. Phases 1, 2 and 3 are independent of each other. **Phase 4 is blocked by Phases 1 to 3**:
its `Delivered:` evidence needs their pull request numbers and test counts, so the slicer must not run
it in parallel. The slicer may merge Phases 1 and 2 into one pull request; that leaves Phase 3 and
Phase 4 as separate follow-up tickets, and step 15 says what to do about the `Delivered:` line when
the phases were merged.

## 📋 Implementation Plan

### Phase 1

1. **Write the tests first** (`tdd` skill), in `src/server/auth/__tests__/organization.test.ts` with
   `openAuthTestDb()` and `seedUser`. The injecting tests wrap the harness database in a `Proxy` that
   overrides `batch` only, counts its calls, and **fires its side effect on the first call only** (a
   flag), because a retried batch goes through the same `Proxy`:
   - _a concurrent slug collision lands one workspace_: the first `batch` call first inserts, via
     `seedOrganization`, an `organization` with the slug `personalWorkspaceSlug(user)` (the base slug
     `reserveSlug` returns on a free database; the `Proxy` never sees the slug itself), then delegates.
     Assert `provisionPersonalWorkspace` resolves, exactly one workspace belongs to the user, its slug
     differs from the clashing one, and it has its owner `member` row and its currency rows.
   - _a same-user race reuses the winner's workspace, the loser having drawn the base slug_: the first
     `batch` call first provisions the same user through the unwrapped database, then delegates.
     Assert the returned id equals the winner's, there is one workspace and one membership.
   - _a same-user race reuses the winner's workspace, the loser having drawn a suffixed slug_: the
     winner is provisioned **before** the call, through the unwrapped database, and the loser starts
     from a stale first read. The `Proxy` wraps the database in a `get` trap that returns, on the
     **first `select` call only**, a stub chain (`from`, `where`, `orderBy`, `limit`) that awaits to
     `[]`; that is the `member` read of `firstOrganizationIdFor`, so the loser believes the user has no
     workspace. The real `reserveSlug` then sees the winner's base slug taken and draws a suffixed
     one, and the loser's batch fails on the deterministic primary key. The re-read (the second
     `select`, real) finds the winner. Assert: the returned id is the winner's; there is one
     workspace and one `member` row for the user; the loser's counted `batch` calls equal 1 (the
     winner went through the unwrapped database and is not counted); and the slug of the one
     workspace is the winner's base slug, with no suffixed workspace left behind, which proves the
     suffixed path was taken and rolled back.
   - _a successful batch ends the loop_: with no injection, `batch` was called exactly once.
   - _a deterministic id held by a foreign workspace does not lock the user out_: await
     `personalWorkspaceId(user.id)`, then pre-insert (via `seedOrganization`) an `organization` with
     that id, a different slug and no membership for the user. Assert the call resolves with a
     different id, one membership for the user, and that `batch` was called exactly twice (the failed
     attempt on the deterministic id, then the random-id attempt).
   - _`personalWorkspaceId` is a pure function_: same user id, same id; different user ids, different
     ids; 24 characters from the URL-safe alphabet.
   - _a failure that is not a collision rethrows and cannot loop_: provision for a user id with no
     `user` row (the `member` foreign key fails); assert the call rejects, the test's own counter
     shows `batch` ran once, and no `organization`, `member` or `organization_currencies` row exists.
2. **Add the money-invariant case** in the same file, named for what it holds: "_a provisioned
   workspace always has exactly one base currency_". After `provisionPersonalWorkspace`: exactly one
   `organization_currencies` row with `is_base = 1` for the workspace; its code is a row of the
   `currencies` table (read the table, do not restate a code); every other row of the workspace is
   `is_base = 0`; the row set equals `DEFAULT_WORKSPACE_CURRENCY_CODES` and the base equals
   `DEFAULT_BASE_CURRENCY_CODE` (read from the constants); and the failed-batch case of step 1 leaves
   none of them behind.
3. **Implement** `personalWorkspaceId(userId)` (exported, pure, async because of `crypto.subtle`) and
   the loop in `provisionPersonalWorkspace` as the Architecture section describes: the deterministic
   id on the first attempt, at most 4 attempts around `db.batch` only; on failure the re-read, then
   the id-present check, then the slug-present check, then the next rung; the `member` id regenerated
   per attempt; the original error rethrown when no check applies. Update the `reserveSlug` docblock
   so it no longer claims the ladder alone prevents a failed insert, and the
   `provisionPersonalWorkspace` docblock to say the primary key is what keeps it to one workspace per
   user. Do not parse the error message and do not name an index.
4. **Run the gate**:
   `node -e "require('./.ai/agentic.config.json').validation.commands.forEach(c=>console.log(c))"` and
   every command in the order printed, on the final commit. No `.skip`, `.only`, `.todo`, no
   `@ts-expect-error`, no `eslint-disable`.

Tenant-isolation test: none, no repository function (above). Money invariant: step 2.

### Phase 2

5. **`src/server/auth/__tests__/secondary-storage.test.ts`** (`server` project; the KV is an
   argument, so an in-memory fake with a recording `put` is enough): _a TTL below the floor is clamped
   up to 60 s_ (`set(key, value, 10)` puts `expirationTtl: 60`; `set(key, value, 120)` puts 120;
   `set` with no TTL puts no options); _`increment` counts inside a window and restarts after it_
   (fake timers: 1, 2, then 1 after the window; the stored TTL tracks the remaining window and is not
   below 60); _`increment` treats a corrupt value as no counter_; _`getAndDelete` returns the value and
   removes it, and returns `null` for a miss without deleting_.
6. **`src/server/auth/__tests__/config.test.ts`** (`server` project). `vi.mock('cloudflare:workers')`
   with an `env` holding a KV fake as `SESSIONS`, a fake `BETTER_AUTH_SECRET`, `APP_URL` and an empty
   `EMAIL_API_KEY`; `vi.mock('../db')` so `getDb` returns `openAuthTestDb()`'s handle. Call
   `authOptions()` and assert, one case each, naming the reason in the title:
   - _no `cookieCache`_: `session` has no `cookieCache` key (ADR 0011);
   - `verification.storeInDatabase` is `true`;
   - _`disabledPaths` is top level and equals `DISABLED_ADMIN_PATHS`_, and the options passed to
     `admin()` carry none;
   - _`admin` is the first plugin_ (`plugins.map((plugin) => plugin.id)` starts with `admin`, followed by
     `two-factor` and `organization`);
   - _the rate limiter uses secondary storage and carries exactly the seven custom rules_ (compare to a
     literal table in the test, so adding a rule is a visible diff), including the four ADR 0011 names
     with their windows;
   - `advanced.cookiePrefix` is `mtr`; `advanced.database.generateId()` returns 24 characters;
     `secondaryStorage` is defined;
   - _both provisioning hooks provision_: both hooks are optional in Better Auth's option type and take
     a full user or session record plus an optional context, and `advanced.database.generateId` is a
     union, so the test narrows each (a typed fixture, a guard that throws when the hook is absent) and
     passes `pnpm typecheck` without `@ts-expect-error` or `as any`. Seed a user with `seedUser`; call
     `databaseHooks.user.create.after(user)` and assert one workspace and one owner membership; on a
     second user call `databaseHooks.session.create.before({ userId, ... })` and assert it returns data
     whose `activeOrganizationId` is that user's workspace and that one workspace exists; calling both
     for one user leaves one workspace; `session.create.before` for a vanished user returns nothing.
7. **Prove the dictionaries are separate types.** In `permissions.test.ts` add a type-level case with
   `expectTypeOf` (Vitest's, checked by `pnpm typecheck`; a runtime no-op): `PlatformRole` is not
   equal to `OrganizationRole`, neither extends the other (`curator` and `user` are not workspace
   roles; `owner` and `member` are not platform roles), and the first parameter of `roleSatisfies`
   (`src/server/repos/scope.ts`) does not accept a `PlatformRole`. No `@ts-expect-error`.
   Correct `permissions.ts` line 14 to say what holds: a type-level assertion in `permissions.test.ts`.
8. **Run the gate** as in step 4.

Tenant-isolation test: none. Money invariant: none, no amount.

### Phase 3

9. **Add `BETTER_AUTH_SECRET` and `EMAIL_API_KEY` to the workerd project's `miniflare.bindings`** in
   `vitest.config.ts`: a secret literal that is plainly a non-secret test value (at least the length
   Better Auth accepts, carrying the words `test-only`, and different from any real deployment value, so
   neither a secret scanner nor a reviewer mistakes it for a leak), and
   `EMAIL_API_KEY: ''` so a developer's local `.dev.vars` cannot turn the test into a real send.
   Read no `.dev.vars*`, edit no `wrangler.jsonc`.
10. **`src/server/auth/__tests__/auth.workerd.test.ts`** (`*.workerd.test.ts`, the `workerd` project,
    migrations applied by `vitest.setup.workerd.ts`). Build `betterAuth(authOptions())` by importing
    `config.ts` and **never `index.ts`** (`index.ts` reaches `getRequest` from
    `@tanstack/react-start/server`, which has no meaning here). `POST /api/auth/sign-up/email` through
    `handler(new Request(...))` with an `Origin` header equal to `appUrl()`. Assert: the response is
    successful; a session key exists in the `SESSIONS` namespace; the D1 `user` id is 24 characters;
    exactly one `organization`, one owner `member` and one `organization_currencies` row with
    `is_base = 1` exist for the new user, in the real D1 that the migrations built. Mocking
    `@tanstack/react-start` inside the test is allowed.
11. **Timebox.** If the test cannot boot without a production-code change, a new dependency or more than
    a trivial edit to `src/server/worker.workerd-entry.ts`, drop it, keep steps 5 to 8, and say in the
    pull request that no end-to-end sign-up was driven; the `Delivered:` evidence (step 15) says so too.
    No `.skip` stays behind: the file is not added.
12. **Run the gate** as in step 4, plus `pnpm test:workerd`, on the final commit.

### Phase 4

13. **Amend the 04-S1 block** in `docs/plans/04-auth-and-tenancy.md`, sweeping the whole block so no
    plan-only name survives:
    - Owned paths: add `db.ts`, `email.ts`, `env.ts`, `secondary-storage.ts`, `tenant.ts`, the three new
      tests of this spec, `__tests__/harness.ts`, and the existing `permissions.test.ts`; note that
      `organization.ts` writes `organization_currencies` outside `src/server/repos` by design.
    - Server: plugins are `admin`, `twoFactor`, `organization` with `admin` first; the rate-limit table
      has seven rules, the four of ADR 0011 first; the retry ladder is a retry on the batch (Phase 1), and **one auto-provisioned personal workspace per user is held by the
      deterministic personal-workspace id (a primary key), not by the slug index**;
      `permits(actor, request)` is the real signature.
    - Money invariant: replace `organization_settings.base_currency_code` and "defaulted from the
      negotiated locale's country" with `organization_currencies.is_base`, the fixed PLN default and
      the four-currency list; state that locale derivation was considered and deferred and that the
      personal workspace's base is chosen only through `26-S*` onboarding for workspaces it creates.
    - Verification: replace the `@ts-expect-error` fixture with the `expectTypeOf` assertion, and the
      manual `wrangler dev` sign-up with `auth.workerd.test.ts` (or, if Phase 3 fell back, with the
      sentence that no end-to-end sign-up was driven).
    - One sentence, owed and **not** fixed here: `FND-02` in `00-foundations.md` and the Data section
      of `02-i18n.md` name `04-S1` as the owner of `organization_settings.locale` and
      `user_preferences.locale`; `04-S1` creates neither (`23-S2` and `00-S14` requisition them). One
      more, same status: `04-S3`'s money-invariant text reads `settings.base_currency_code`, which does
      not exist. Change nothing else in those blocks.
14. **Amend ADR 0011** with an `## Amendment` section (amend, never rewrite): the personal workspace's
    base currency is a fixed PLN with EUR, USD and GBP beside it; the rate-limit rules are the seven in
    `config.ts`; the plugin list is `admin`, `twoFactor`, `organization`; one auto-provisioned personal workspace per user is held by the
    deterministic personal-workspace id, not by the slug index; the passkey plugin is not yet
    installed (`04-S4`). Cite the pull requests of Phases 1 to 3.
15. **Add the `Delivered:` line** directly under `## Stage 04-S1` in the plan:
    `Delivered: <YYYY-MM-DD> - <evidence>`, dated the day Phase 4 is written, naming the paths, the
    pull requests of Phases 1 to 3 and the test counts **read from commands run in that pull request**
    (`pnpm vitest run src/server/auth --project=server`, `pnpm test:workerd`). If the slicer merged the
    phases into one pull request, name the paths and tests and add the pull request number in a final
    commit once it is known. Change nothing outside the blocks named in steps 13 and 14 (the stage
    register of `docs/plans/README.md` is not edited).
16. **Run the gate** as in step 4, plus
    `pnpm exec prettier --check docs/plans/04-auth-and-tenancy.md docs/adr/0011-better-auth-with-kv-session-store.md`
    (`pnpm check` cannot be scoped to files).

## 📝 Resolved assumptions (autonomous defaults)

Every row is a decision this run made without a human, or a default it applied. Each is reversible
before merge by saying so on the spec PR.

| #   | Question                                                                                                          | Applied default                                                                                                                                                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | What base currency does an auto-provisioned workspace get: a fixed default, one derived from the locale, or none? | **Keep the fixed PLN base with EUR, USD and GBP; add the missing test; amend the plan text; do not derive from the locale.**                                                                                                                                                          | Decided by product-owner sub-agent (confidence high): no `organization_settings` table exists, the session hook has no request, `en` has no country, and the base is not editable in v1, so a derivation changes every new account irreversibly; "none" breaks the invariant. Conditions applied: the test (one `is_base` row, a catalogue code, atomic with the organization), the plan text, the deferral and the `26-S*` limitation recorded, a note in ADR 0011 (no `product-brief.md` exists), no schema or hook change.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2   | How is a slug collision made unable to fail a sign-up?                                                            | **Retry the batch, at most 4 attempts, detecting the collision from database state: re-read the user's workspace first, then check the attempted id and slug are present (row 9 adds the deterministic id), then take the next rung; otherwise rethrow.**                             | Decided by software architect sub-agent (confidence high): the brief's index-name claim was wrong (SQLite reports columns, D1 wraps the error), and the race includes the same user's two hooks, so the re-read must precede any retry. Conditions applied: only `db.batch` in the loop, ids regenerated, no error parsing, the three tests, the `reserveSlug` docblock corrected; no `tenant-isolation.test.ts` case because no repository function is added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3   | How are the configuration and the hooks tested, and what replaces the manual `wrangler dev` sign-up?              | **Node tests first (`config.test.ts`, `secondary-storage.test.ts`), then one timeboxed `auth.workerd.test.ts`; if it cannot boot without production changes, ship the Node tests and say no end-to-end sign-up was driven.**                                                          | Decided by software architect / test engineer sub-agent (confidence medium): `getRequest` lives only in `index.ts`, the emailer skips without a key, so the open risk is loading `#/server/fns/locale` in workerd. Conditions applied: fake `BETTER_AUTH_SECRET` and `EMAIL_API_KEY: ''` in `miniflare.bindings`, import `config.ts` not `index.ts`, `Origin` header, the timebox, `expectTypeOf`, the docblock fix, the gate plus `pnpm test:workerd`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4   | The plan asks for an `@ts-expect-error` fixture. Keep it?                                                         | **No: `expectTypeOf` assertions in `permissions.test.ts`.**                                                                                                                                                                                                                           | `AGENTS.md` Never forbids `@ts-expect-error`; one defensible answer in the repository, so no specialist was asked. `tsconfig.json` includes tests, so `pnpm typecheck` checks the assertion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 5   | Does this stage add the `organization_settings` / `user_preferences` tables the plan implies?                     | **No.** The plan text is corrected and the cross-references that name `04-S1` as their owner are flagged as owed, not edited.                                                                                                                                                         | The plan's own Data section says no schema change; `23-S2` and `00-S14` requisition them; a migration is Ask First. Default applied by this run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 6   | Does Phase 4 add the `Delivered:` line, and when?                                                                 | **Yes, as its last step, after Phases 1 to 3 have merged.**                                                                                                                                                                                                                           | `docs/plans/TEMPLATE.md` and `docs/plans/README.md` define the line; it stops `backlog-status.mjs --plan` offering the stage. Last keeps the marker true.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | Is the stage covered elsewhere?                                                                                   | **No.**                                                                                                                                                                                                                                                                               | `grep -rn "04-S1" .ai/specs` found nothing; every issue and pull request (state all, 400 of each) was filtered for the string `04-S1` and none matched; the open pull requests are two Dependabot branches; the plan has no `Delivered:` line.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8   | Which numbers in this spec are measured?                                                                          | `67` tests in `4` files: `pnpm vitest run src/server/auth --project=server` (`Test Files 4 passed`, `Tests 67 passed`). By file (verbose reporter): `email` 17, `guards` 14, `organization` 16, `permissions` 20. Seven rate-limit rules: counted in `RATE_LIMIT_RULES`, `config.ts`. | `docs/SPEC.md` §7.7: every number came from a command whose output was read. Phase 4's evidence line re-measures them in its own pull request rather than copying these.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 9   | How is "one auto-provisioned personal workspace per user" held when the slug index does not hold it?              | **A deterministic personal-workspace id (a pure function of the user id), so the primary key arbitrates; the re-read precedes any retry; a foreign-held id falls back to a random id so sign-in is never blocked.**                                                                   | Decided by security-tenancy-reviewer sub-agent (confidence high) and found independently by the product owner in round 1: the only unique indexes are on `organization.slug` and `(organization_id, user_id)`, and one interleaving of the two hooks succeeds with a different suffixed slug and no error. Conditions applied: the false sentence in Architecture and Risks replaced; a third race test (the loser draws a suffixed slug); Phase 4 states the mechanism; no migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 10  | Product owner: approve this spec?                                                                                 | **Round 1: approve with conditions, applied. Round 2: approve.**                                                                                                                                                                                                                      | Decided by product-owner sub-agent (confidence medium): claims verified against the repository; four tickets is the right size. Round 1 conditions applied: the same-user race with a taken base slug is closed (row 9); the Problem item on the dictionaries acknowledges `tenant-isolation.test.ts` line 690; Phasing says Phase 4 is blocked by Phases 1 to 3 and what a merged Phases 1+2 ticket leaves. Round 2 (confidence high): approve; the same-user race, the `tenant-isolation.test.ts` line 690 acknowledgement and the Phase 4 blocking are met and the deterministic id breaks nothing that assumes a nanoid. Two wording slips fixed (the Risks row names the tests; the Phasing row names the deterministic id).                                                                                                                                                                                                              |
| 11  | Software architect: approve this spec?                                                                            | **Round 1: approve with conditions, applied. Round 2: approve with conditions, applied.**                                                                                                                                                                                             | Decided by software architect sub-agent (confidence high): respects ADR 0002, 0011, 0015 and `AGENTS.md`; the harness, the mocks and the plugin ids (`admin`, `two-factor`, `organization`) check out. Round 1 conditions applied: the ADR 0011 path corrected to `docs/adr/0011-better-auth-with-kv-session-store.md`; the `Proxy` fires once, the clashing slug is `personalWorkspaceSlug(user)` and the test counts `batch` calls; the hook typing and `generateId` narrowing without `@ts-expect-error`. Round 2 (confidence high) conditions applied: the third race test constructed with a stale first read (a `Proxy` whose `get` trap returns a stub chain on the first `select`, since `select()` is synchronous and cannot await a side effect); exact `batch` counts (1 for the suffixed-slug loser, 2 for the foreign-held id); stale wording about the race tests corrected; the Phasing row and TLDR name the deterministic id. |
| 12  | Security and tenancy reviewer: approve this spec?                                                                 | **Round 1: approve with conditions, applied. Round 2: approve with conditions, applied.**                                                                                                                                                                                             | Decided by security-tenancy-reviewer sub-agent (confidence high): the retry loop cannot create a workspace without an owner; no guard, tenant id or secret is weakened. Round 1 conditions applied: row 9; the third race test with the loser drawing a suffixed slug; Phase 4 names the mechanism; the test secret is marked `test-only`. Round 2 (confidence medium) conditions applied: the claim scoped to the _auto-provisioned_ personal workspace, with the open `/organization/create` route (no `organizationLimit`) recorded as out of scope and to be filed as its own issue; how the interleaving is forced and what is counted; the id is a plain unkeyed hash on purpose (an HMAC would break on secret rotation). No tenancy hole: the organization plugin's create body accepts no `id`.                                                                                                                                       |
