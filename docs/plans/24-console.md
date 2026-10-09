# 24 — Console

## Area brief

The operator surface: the small set of screens the people who run this product use to answer support
questions, inspect platform health and make the handful of interventions that cannot be made from
inside a workspace. It is **not** an admin god-mode over customer data.

The area exists under a single constraint, and everything below follows from it:

> **The console is the only code permitted to read across workspaces, it does so through an explicitly
> named `platformScope` rather than by bypassing `tenantFilter`, every call is behind
> `requirePermission`, and every read and write lands in `platform_audit_log`.**

`04-S2` established `src/server/catalog` as the first exception to the tenant-scoped repository
boundary; `20-S3` (backup) and `22-S1` (billing events) added themselves to the same explicitly named
allow-list with tests. This plan is the last addition to that allow-list, and it adds the **audit** obligation
that the other two do not carry, because the others are machines and this one is people.

**What the console deliberately cannot do:** read a workspace's transaction amounts, descriptions,
payees, notes or attachments; impersonate a member; export a workspace's data. Support questions are
answered with **counts, statuses and timestamps**, not with content. A support tool that can read
everyone's finances is a breach waiting for a bad day, and refusing that capability is cheaper than
guarding it. `docs/SECURITY.md` §7 records the boundary; this plan enforces it with tests that fail
if a money column is ever selected.

---

## Stage 24-S1 — Platform access, audit and the console shell

### Stage id

`24-S1` · Wave 5 · effort **L**.

### Reference rows

`CON-01 missing → done` — platform roles, `requirePermission` and `platformScope`.
`CON-02 missing → done` — `platform_audit_log` with mandatory write-through.
`CON-03 missing → done` — the `/console` shell, separated from the app shell.

### Owned paths

- `src/server/platform/scope.ts` — new
- `src/server/platform/permissions.ts` — new
- `src/server/platform/audit.ts` — new
- `src/server/platform/__tests__/permissions.test.ts` — new
- `src/server/platform/__tests__/audit.test.ts` — new
- `src/routes/console/route.tsx` — new
- `src/routes/console/index.tsx` — new
- `src/routes/console/-ui/console-nav.tsx` — new
- `e2e/console.spec.ts` — new

### Data and migration

Requisitions into `00-S14`: `platform_roles` (`user_id` primary key, `role` in
`support|operator|owner`, `granted_by`, `granted_at`) and `platform_audit_log` (`id`, `actor_user_id`,
`action`, `target_type`, `target_id`, `workspace_id` nullable, `params_json`, `result` in `ok|denied|
error`, `ip_hash`, `user_agent`, `created_at`), indexed on `(created_at desc)` and
`(actor_user_id, created_at desc)`.

**A platform role is a row, not a flag on `user`.** Granting it is an insert with an actor and a
timestamp, so "who made this person support staff and when" is answerable. Better Auth's `admin()`
plugin (`04-S1`) supplies the session; it does **not** supply this authority — the two are separate
on purpose, because the auth library's admin concept is about auth, not about our platform.

### Server (repo, server function, Zod)

- **`permissions.ts`** — `requirePermission(action)` resolving the session user's platform role and
  checking it against a static capability table. Roles: `support` (read counts and statuses, resolve
  nothing), `operator` (support plus limit overrides, queue replays, backup triggers), `owner`
  (operator plus granting roles). The table is **data**, exhaustively enumerated, and
  `permissions.test.ts` asserts every action in the console has an entry — an action without one is a
  test failure, not a default-allow.
- **`scope.ts`** — `platformScope()` returns a marker type that the repositories accept **instead of**
  a `TenantScope`. It is a distinct type, so a tenant repository cannot be handed a platform scope by
  accident and vice versa; the compiler enforces the boundary that a convention would only suggest.
- **`audit.ts`** — `withAudit(action, target, fn)` wraps every console operation: it writes the log row
  **before** the operation with `result` pending, and updates it after. Logging after success would
  lose the record of a denied or crashed attempt, which is precisely the record that matters. A
  failure to write the audit row **aborts the operation** — an unauditable console action does not
  happen. That is the inverse of `21-S1`'s notification rule, and the difference is deliberate and
  stated in both files.
- **`ip_hash`** is a salted hash of the CF-connecting IP, not the address, matching the posture in
  `21-S2`'s `to_hash`.

### UI (route, components)

- **Route.** `/console`, a top-level route **outside `_app`** with its own layout, its own nav and a
  visually distinct chrome — a persistent banner naming the environment (`staging` / `production`)
  and the actor. Operators mistaking production for staging is a real class of incident and colour
  alone does not prevent it, so the banner carries text.
- **Access.** A user with no platform role gets a **404, not a 403** — a 403 confirms the console
  exists and that the URL is right, which is free reconnaissance.
- **States.** Loading; loaded; **insufficient role** (visible for an action a `support` user cannot
  take: the control is absent with an explanatory note, not present-and-disabled); error.
- **Accessibility.** The console is held to the same bar as the product: WCAG 2.2 AA plus the named
  AAA criteria. It is used daily by whoever we hire, and building the internal tool to a lower
  standard is how a company ends up unable to hire someone who uses a screen reader.

### Quota

No countable row. Console actions are rate-limited per actor (a named constant) as an abuse brake,
with the rejection audited.

### Tenant isolation test

This is the stage's central test, and it is inverted from every other plan's. In
`tenant-isolation.test.ts`:

- `platformScope()` is callable **only** from files on the explicit allow-list — `src/server/catalog`,
  `src/server/cron/backup.ts`, `src/server/billing/*`, `src/server/platform/*`,
  `src/routes/console/**` — asserted by an import-graph check that fails on any addition;
- a tenant repository **rejects a platform scope at the type level** and at runtime;
- a console route reached by a user with no `platform_roles` row returns 404 and writes a `denied`
  audit row;
- every exported console operation is wrapped in `withAudit`, asserted by enumerating the module's
  exports and checking the wrapper — an unwrapped export fails the suite.

### Money invariant

_The console cannot read a money column._ Case in `audit.test.ts` and enforced by a lint rule: _no
file under `src/routes/console/**` or `src/server/platform/**` selects `amount_minor`,
`ref_amount_minor`, `balance_minor`, `description`, `note` or `payee`_, asserted by a query-shape
check over the repositories those files call plus a source scan. The second case: _`params_json` in
the audit log is redacted through `05-S1`'s money-aware scrubber before writing_, so even a mistaken
parameter cannot persist an amount into the platform log.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `permissions.test.ts`: the exhaustive action table; each role against each action; a missing entry
  failing the suite.
- `audit.test.ts`: the pre-write and update; the abort-on-audit-failure path; the scrubber; the
  denied-attempt row.
- `e2e/console.spec.ts`: a non-role user gets 404; a `support` user sees the console without operator
  controls; the environment banner reads `staging`.
- Browser evidence: `/console` in both themes at **360 / 1280 / 2560 px**, plus the **environment
  banner**, the **nav with a focused item**, and the **support-role view showing an absent operator
  control**.
- axe on `/console`: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 24-S2 — Workspace inspector and limit overrides

### Stage id

`24-S2` · Wave 5 · effort **L**.

### Reference rows

`CON-04 missing → done` — the workspace list with search and status filters.
`CON-05 missing → done` — the workspace detail: counts, plan, subscription status, members.
`CON-06 missing → done` — per-workspace limit overrides.

### Owned paths

- `src/routes/console/workspaces/index.tsx` — new
- `src/routes/console/workspaces/$workspaceId.tsx` — new
- `src/routes/console/workspaces/-ui/override-form.tsx` — new
- `src/server/platform/repos/workspaces.ts` — new
- `src/server/platform/repos/__tests__/workspaces.test.ts` — new
- `src/server/platform/repos/limit-overrides.ts` — new
- `src/server/platform/repos/__tests__/limit-overrides.test.ts` — new

### Data and migration

Requisitions `limit_overrides` into `00-S14`: `id`, `workspace_id`, `limit_key`, `value`, `reason`,
`expires_at` nullable, `created_by`, `created_at`, unique on `(workspace_id, limit_key)`.

`resolveLimits()` (`22-S2`) already reads this table as its **highest-precedence** source; this stage
supplies the write path and the screen. The `reason` column is **required and minimum 10 characters**,
because an override with no recorded reason becomes permanent by ignorance.

### Server (repo, server function, Zod)

- `listWorkspaces({ q, status, cursor })` — keyset paginated, returning `id`, `name`, `created_at`,
  `plan_key`, subscription status, member count, and **counts only** for accounts, transactions,
  budgets and attachments. The search matches the workspace **name** and the owner's **email hash**
  (a support person pastes an address; we hash and compare, and never store or display the address
  from this path).
- `getWorkspace(id)` — the same plus per-limit usage, the recent `billing_events` types and times,
  the last export and backup timestamps, and the deletion status. **No content, ever.**
- `setOverride`, `removeOverride` — `operator` role, wrapped in `withAudit`, with the reason required
  and `expires_at` optional. Expired overrides are ignored by `resolveLimits` and shown struck through
  rather than deleted, so the history of interventions survives.
- **`limitOverrideSchema`** validates `limit_key` against the **exhaustive key list from `plans.ts`**,
  so a typo cannot create a silently-ignored override — the failure mode where support believes they
  raised a ceiling and the customer keeps hitting it.

### UI (route, components)

- **Route.** `/console/workspaces` and `/console/workspaces/$workspaceId`.
- **Components.** The `data-table` (`00-S8`) for the list; a detail page of `section.tsx`-shaped
  panels; `override-form.tsx` (limit key `Select`, value, reason, optional expiry).
- **States.** Empty search result (with the query echoed); loading; loaded; **not found**; **pending
  deletion** (banner); **purged** (the row remains with counts zeroed and a purge date, since the
  audit record outlives the data).
- **Accessibility.** The counts are a `<dl>`. The override form's value field states the current
  effective value and the catalogue value side by side, so an operator sees what they are overriding
  and what it will fall back to. Removing an override is an `AlertDialog` naming the key and the
  workspace.

### Quota

No countable row.

### Tenant isolation test

In `tenant-isolation.test.ts`: `listWorkspaces` and `getWorkspace` are the only cross-workspace reads,
they run under `platformScope`, and each is wrapped in `withAudit` with the target workspace recorded;
a `support` user can read and **cannot** call `setOverride` (404 on the action, `denied` audited); an
override written for A does not alter `resolveLimits(scopeB)`, asserted directly.

### Money invariant

_The inspector shows counts, never amounts, and an override changes a ceiling, never a balance._
Cases in `workspaces.test.ts` and `limit-overrides.test.ts`:

- _every numeric field returned by `getWorkspace` is a count or a timestamp_, asserted by a shape test
  that fails on any field whose name matches `/minor|amount|balance/`;
- _the queries select no money column_, asserted at the SQL level by inspecting the generated
  statements;
- _setting an override changes `resolveLimits`'s output and leaves every account balance in that
  workspace byte-identical_, recomputed by the ledger;
- _an expired override is ignored by `resolveLimits`_ while remaining visible in the console.

### Verification

- Command gate.
- `workspaces.test.ts`: pagination; the name and email-hash search; the no-money-column assertions;
  the purged-workspace row.
- `limit-overrides.test.ts`: the exhaustive key validation rejecting a typo; the required reason; the
  expiry semantics; the audit rows for set and remove; the `support`-role denial.
- Browser evidence: `/console/workspaces` and a detail page in both themes at
  **360 / 1280 / 2560 px**, plus the **override form**, an **expired override struck through**, the
  **remove dialog**, and the **empty search state**.
- axe on both routes with the form open: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 24-S3 — Platform health: queues, crons, errors and the catalogue

### Stage id

`24-S3` · Wave 5 · effort **M**.

### Reference rows

`CON-07 missing → done` — queue and DLQ inspection with replay.
`CON-08 missing → done` — cron run history and the last-run health panel.
`CON-09 missing → done` — the currency and FX catalogue admin.
`CON-10 missing → done` — the audit log viewer.

### Owned paths

- `src/routes/console/health/index.tsx` — new
- `src/routes/console/health/-ui/cron-panel.tsx` — new
- `src/routes/console/health/-ui/dlq-panel.tsx` — new
- `src/routes/console/catalog/index.tsx` — new
- `src/routes/console/audit/index.tsx` — new
- `src/server/platform/repos/health.ts` — new
- `src/server/platform/repos/__tests__/health.test.ts` — new
- `src/server/catalog/currencies.ts` — gains the guarded and audited write path (exists from `03-S1`)
- `src/server/catalog/__tests__/currencies.test.ts` — gains its cases (exists from `03-S1`)

### Data and migration

Requisitions into `00-S14`: `cron_runs` (`id`, `cron`, `started_at`, `finished_at`, `status`,
`steps_json`, `error_code`) and `dlq_messages` (`id`, `queue`, `kind`, `payload_json`, `attempts`,
`first_failed_at`, `last_error`, `status` in `parked|replayed|discarded`, `handled_by`,
`handled_at`).

Every cron (`*/15`, `7 * * * *`, `0 3`, `17 4 * * 1` — `00-S2`) writes a `cron_runs` row with a
per-step outcome. The nightly job's four steps (FX refresh, revaluation sweep, backup, export prune)
each appear separately, because "the nightly cron succeeded" while the FX refresh silently no-opped is
the failure this panel exists to surface.

### Server (repo, server function, Zod)

- `getHealth()` — the last run per cron with its per-step outcomes and its age; DLQ depth per queue;
  the count of `billing_events` in `failed`; the count of export jobs in `failed`; the FX rate
  freshness (the newest `as_of` per currency pair against the base).
- `listDlq({ queue, cursor })`, `replayDlq(ids)`, `discardDlq(ids)` — `operator` role, audited,
  capped at 100 ids per call. **Replay re-enqueues the original envelope**, which is safe precisely
  because every handler in this product is idempotent (`19-S3`, `20-S2`, `21-S2`, `22-S2`); the
  panel's copy says so, and `health.test.ts` asserts a replayed import-commit message creates no
  duplicate rows — the console's replay button is only as safe as that property, so it is tested here
  as well as there.
- **Catalogue.** `src/server/catalog` (from `04-S2`, the original boundary exception) gains its screen:
  currencies (add, deactivate, adjust `digits`) and FX provider status with a manual refresh trigger.
  Deactivating a currency **in use by a workspace is refused** with the count, since it would strand
  those accounts.
  **The catalogue write path is this stage's** (`CON-09`): `03-S1` shipped the reads only
  (`listEnabledCurrencies`) because the guard and the audit table arrive with `24-S1`. Acceptance:
  - The guard is the **platform** dictionary, resolved server-side from whichever source `24-S1`
    settles on (`user.role` through `permits`, or `platform_roles`), never a workspace role. Which
    platform role may write the catalogue is `24-S1`'s decision, and this stage's `operator` role
    and `operator`-gated lines are reconciled by it.
  - `ForbiddenError` for a caller without it; one audit row, written through `withAudit` only (it
    records a denied or crashed attempt, which a same-batch write would lose); Zod parsed twice.
  - A currency is added, and its `digits` changed, **only through `src/lib/money/currencies.ts`**: a
    D1-only row would format at the fallback scale of 2. The "adjust `digits`" action above is in
    tension with that and with the immutability of `ref_amount_minor`, and this stage's own spec
    decides it.
  - Deactivating a currency in use is refused with the count. The count is an **aggregate** (a
    number only, no workspace id or name), runs through `24-S1`'s platform scope under `withAudit`,
    and is not an unscoped query inside `src/server/catalog`.
  - `requireCatalogueCurrency` rejects a disabled code (the existence check of `03-S3`).
  - One test for the denied caller and one for the single audit row on success. The no-write
    tripwires of `03-S1` (in `src/server/catalog/__tests__/currencies.test.ts`) are replaced, in
    that pull request, by those cases.
  - The docblock of the `currencies` table in `src/server/db/schema.ts` ("writes go through
    `src/server/catalog` under `requirePermission`") is checked against what shipped.
- **Audit viewer.** Filter by actor, action, target and date; keyset paginated; **read-only, with no
  delete path at all** — an audit log an operator can prune is not an audit log.

### UI (route, components)

- **Route.** `/console/health`, `/console/catalog`, `/console/audit`.
- **Components.** `cron-panel.tsx` (one row per cron with its steps, age and a **stale** highlight
  when the age exceeds twice the interval); `dlq-panel.tsx` (grouped by kind, with the payload shown
  **scrubbed** through `05-S1`'s redactor, since a DLQ payload can contain a transaction).
- **States.** Healthy; **stale cron**; **DLQ non-empty**; provider degraded (FX rates older than 48
  hours); loading; error.
- **Accessibility.** Health status is text plus an icon plus colour, never colour alone. The stale and
  degraded states use `role="status"`. Replay and discard are `AlertDialog`s stating the count and
  that replay may re-run side effects.

### Quota

No countable row.

### Tenant isolation test

In `tenant-isolation.test.ts`: DLQ payloads are **scrubbed** before leaving the server, asserted with
a message containing an amount and a description and checking neither reaches the response; the
catalogue write path is audited and `operator`-gated; the audit viewer exposes no `delete` server
function, asserted by enumerating the module's exports.

### Money invariant

_Health is counts, ages and statuses; the one money-adjacent number is the FX rate, and it is an
integer._ Cases in `health.test.ts`:

- _FX freshness reports `rate_e10` values as integers with their `as_of` dates_, never a decimal rate,
  and a manual refresh writes new rows rather than updating old ones — historical rates are immutable
  and `03-S2` depends on that.
- _deactivating a currency in use is refused with the usage count_, and the refusal touches no row.
- _adjusting a currency's `digits` is refused when any transaction exists in that currency_, because
  changing the scale reinterprets every stored integer by a factor of ten — the single most
  destructive available action, and it is forbidden rather than warned about (`OPEN-6` covers the
  zero-decimal scope question that makes this matter).
- _a scrubbed DLQ payload contains no `amount_minor` value_, asserted against a real import-commit
  envelope.

### Verification

- Command gate.
- `health.test.ts`: the four money cases; stale detection at the boundary; the DLQ replay idempotency
  assertion; the 100-id cap; the `support`-role denial on replay and discard.
- Browser evidence: `/console/health` in **healthy**, **stale cron** and **DLQ non-empty** states,
  `/console/catalog`, and `/console/audit` with a filter applied — all in both themes at
  **360 / 1280 / 2560 px**, plus the **replay dialog** and a **scrubbed DLQ payload**.
- axe on all three routes: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

`OPEN-4` — the FX provider is unchosen, so "provider degraded" thresholds and the manual refresh's
behaviour are written against `03-S2`'s provider interface rather than a specific API. The panel and
its tests are complete against that interface; the thresholds are constants to be tuned once a
provider's actual SLA is known.
