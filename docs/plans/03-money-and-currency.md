# 03 — Money and currency

## Area brief

The arithmetic layer everything else stands on: the currency catalogue with its `digits`, the rate
store in `rate_e10`, the FX client and its nightly refresh, and the workspace currency layer with its
single base currency.

`docs/MONEY.md` is the contract; this plan implements it. Where the two disagree the document wins
and the plan is amended — never the reverse, because half the product reads the document and only
this plan reads the code.

**`src/lib/money.ts` is a shared path** and is written by `00-S4`. This plan requisitions it and then
builds the catalogue, the rates and the workspace layer on top.

Three properties this plan exists to protect, each of which is a recorded failure in
`docs/MONEY.md` §8: the scale of an amount is `currencies.digits` and never a hard-coded 2; a rate is
an integer `rate_e10` and never a float; and `ref_amount_minor` is written once, at `booked_on`'s
rate, and never recomputed.

---

## Stage 03-S1 — The currency catalogue

Delivered: 2026-10-07 - `src/server/catalog/currencies.ts` (`listEnabledCurrencies`, reads only) with `src/server/catalog/__tests__/currencies.test.ts` and section 15 of `src/server/repos/__tests__/money-invariants.test.ts`, merged in #596; the seed is `drizzle/0002_seed_currency_catalogue.sql` and the static table `src/lib/money/currencies.ts`, both 56 currencies (5 at `digits: 0`, 46 at 2, 5 at 3), all enabled; `pnpm vitest run src/server/catalog/__tests__/currencies.test.ts src/lib/__tests__/currencies.test.ts` passes 29 tests in 2 files (9 and 20), section 15 passes 2 tests; the guarded and audited write is `24-S3`'s.

### Stage id

`03-S1` · Wave 1 · effort **M**.

### Reference rows

`MNY-01 missing → done` — the ISO-4217 catalogue with `digits`, seeded and curated.
`MNY-02 missing → done` — the catalogue repository's **reads** under `src/server/catalog`
(`listEnabledCurrencies`). Its guarded and audited **writes** are `CON-09` of `24-S3`, where the
platform audit table is built.

### Owned paths

- `src/server/catalog/currencies.ts` — new
- `src/server/catalog/__tests__/currencies.test.ts` — new
- `src/server/repos/__tests__/money-invariants.test.ts` — a section for the catalogue's `digits`

### Data and migration

`currencies` exists from `00-S1` (`code text(3) PK`, `name`, `digits integer NOT NULL`,
`numeric_code`, `is_disabled`). No schema change and no migration; this stage reads it and pins it.

- The seed is the existing seed migration, `drizzle/0002_seed_currency_catalogue.sql`, which loads
  all 56 currencies. The source of the catalogue is the static table
  `src/lib/money/currencies.ts`, which the browser needs too (the transaction form parses input at
  the currency's scale); `src/server/catalog/data/currencies.ts` is its derived projection
  (`CURRENCY_SEED_ROWS`). `digits` is each currency's ISO-4217 minor-unit count, which is the only
  reason JPY (`0`) and KWD (`3`) are right without anybody remembering them.
- **Excluded, with the exclusion list in `src/lib/__tests__/currencies.test.ts` and in
  `docs/MONEY.md` §1:** the precious metals `XAU XAG XPT XPD`, the fund codes, `XDR`, `XXX` (no
  currency) and `XTS` (testing). A metal is not a currency with minor units and modelling it as one
  produces a net-worth figure that is wrong by orders of magnitude.
- **No generator.** The stage once prescribed `scripts/catalog/build-currencies.mjs` and a
  byte-identity test over its output; both are dropped because the repository holds no ISO-4217
  data file, adding a dependency for one is Ask First (`docs/SPEC.md` §3), and a hand-typed source
  would be the second copy that the static table and the seed projection exist to prevent. The
  drift that can actually happen is between the static table and the hand-authored migration, and
  the parity test pins that.
- The migration is `0002`, untouched here (`drizzle/` is immutable history); this stage adds none.

### Server (repo, server function, Zod)

- **Repository.** `src/server/catalog/currencies.ts`, the **named exception** to the tenant-scoped
  rule (`docs/SPEC.md` §6.1): `currencies` has no `organization_id`, so the module takes a bare
  `Database` and never a `TenantScope`. It exports one function, `listEnabledCurrencies(db)`, which
  reads the rows with `is_disabled = 0` as stored, in the static table's declaration order. Reads
  only: **the guarded and audited write path is `24-S3`'s** (`CON-09`), because it needs the
  platform audit table of `24-S1`, and `setCurrencyDisabled` moves there with it. Nothing can set
  `is_disabled` before that stage.
- **Server function.** None here. `listCurrencies` (GET), which returns the enabled catalogue for
  the currency pickers, moves to `03-S3`, the first stage with a caller (`src/server/fns/currencies.ts`
  is its owned path); a function with no caller fails the deletion test.
- **Zod.** None: `listEnabledCurrencies` takes no caller-supplied value. The server function that
  `03-S3` adds carries the strict input schema.
- **Authorisation.** None in the repository: it is a read of a global reference table, called only
  from server code that has already resolved a user (`requireUser()` in `03-S3`). The write guard
  is the **platform** permission, described as it is today: no `requirePermission` function
  exists, only the pure `permits(actor, { catalog: ['write'] })` in `src/server/auth/permissions.ts`
  over Better Auth's `admin | curator | user` roles, and the audited guard arrives with `24-S1`.
- **Ledger batching.** Not applicable: no account balance changes.

### UI (route, components)

- **Route.** None. The console surface is `24-S3`; the workspace picker is `03-S3`.
- **Components.** None new.
- **States.** Not applicable.
- **Tokens.** None.
- **Accessibility.** A currency is always presented as **code plus name** (`PLN — Polish złoty`),
  never a flag alone: a flag is not a currency, and several currencies share a country.

### Quota

This stage creates no tenant row and consumes no metric. The `currencies` metric in `src/lib/plans.ts`
counts **workspace** currencies (`organization_currencies`), which is `03-S3`.

### Tenant isolation test

`currencies` is global, so there is no tenant predicate to test, and `listEnabledCurrencies` lives
in `src/server/catalog`, not `src/server/repos`: there is deliberately **no
`tenant-isolation.test.ts` case**, a justified deviation from the rule that every new repository
function ships with one. The cases that guard the carve-out in its place are the **no-write
tripwires** in `src/server/catalog/__tests__/currencies.test.ts`: the module exports exactly
`listEnabledCurrencies` and its source holds no write call, and no non-test file under `src` writes
the `currencies` table. They are tripwires, not an authorisation guard; the guard, a `ForbiddenError`
for a caller without the platform permission and exactly one audit row per successful write, is
`24-S3`'s, and those cases replace the tripwires in that stage's pull request.

### Money invariant

**`digits` is the scale, always.** It is the static table's scale (`src/lib/money/currencies.ts`,
read by `minorUnitDigits`), mirrored by the stored `currencies.digits` row and pinned equal to it by
the parity test; it is never read from the table at runtime. `money-invariants.test.ts` → section 15,
_the catalogue's digits is the scale the arithmetic uses_: through `listEnabledCurrencies`, JPY has
`digits` `0`, KWD `3` and EUR `2`, each equal to `minorUnitDigits(code)`, with `parseMoney('en',
'1234', 'JPY')` equal to `1234` and `parseMoney('en', '1.234', 'KWD')` equal to `1234`. A second
case, _the catalogue excludes non-currencies_, asserts `XAU`, `XAG`, `XPT`, `XPD`, `XDR`, `XXX` and
`XTS` are absent from the listing, because a metal with `digits: 0` silently behaves like JPY. There
is no new write path, so no further money-invariant case; the guarded-and-audited write case moves
to `24-S3`.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `currencies.test.ts`: the seeded table equals the static catalogue in code, English name, `digits`
  and numeric code, with every row enabled (the parity test, which names `0002` and the static
  table in its failure message); the exclusion list; the listing's contents and order, with a
  disabled row and a code the static table lacks; and the no-write tripwires.
- No browser evidence and no axe run: this stage ships no surface. The currency picker is `03-S3`.

### Definition of done

§7 items 1–3 and 5–7. Item 4 does not apply (no surface).

### Blockers

**`OPEN-6`** — whether zero-decimal currencies are in v1 scope. The catalogue models `digits`
correctly either way; what the decision changes is whether JPY-style currencies ship **enabled**.
Until it is answered they ship enabled, because disabling later is a flag and enabling later is a
data migration. The catalogue ships all 56 currencies enabled, the five with `digits: 0` included.

---

## Stage 03-S2 — Rates: storage, the FX client and the nightly refresh

### Stage id

`03-S2` · Wave 1 · effort **L**.

### Reference rows

`MNY-03 missing → done` — `exchange_rates` reads and writes in `rate_e10`.
`MNY-04 missing → done` — the FX provider client with a primary and a fallback, recording `source`.
`MNY-05 missing → done` — the nightly refresh cron branch.

### Owned paths

- `src/server/catalog/rates.ts` — new
- `src/server/fx/client.ts` — new
- `src/server/fx/providers.ts` — new
- `src/server/cron/refresh-rates.ts` — new
- `src/server/fx/__tests__/client.test.ts` — new
- `src/server/catalog/__tests__/rates.test.ts` — new

### Data and migration

`exchange_rates` exists from `00-S1`: PK `(base_code, quote_code, date)`, `rate_e10 integer NOT
NULL`, `source text`. No schema change.

`rate_e10` is **the rate × 10^10, stored as an integer**. The reference implementation stores a
float; that is the second explicit fix this product makes, and the column type is where the fix
lives — a repository convention over a `real` column would be one careless insert from being wrong.

### Server (repo, server function, Zod)

- **Repository.** `src/server/catalog/rates.ts`: `getRate({ base, quote, date })`,
  `getRatesForDates({ base, quote, dates })` (batched, because the balance-history rebuild asks for a
  whole grid at once), `upsertRates(rows)`. Global table, so the `src/server/catalog` exception
  applies and writes carry the guard and audit rule of `24-S1`, whose platform guard and audit table
  this stage cites. The **cron** writes through a system principal that satisfies the same guard
  rather than bypassing it.
  `upsertRates` is a write to a global table in the same carve-out as `currencies` and **may not
  merge unguarded and unaudited**: `03-S2`'s own spec must record how its write is attributed and
  audited before it ships, or this stage carries a `blocked` hold with a `🤖 HUMAN-ONLY:` comment.
  In practice `03-S2` is held until `24-S1`, unless its spec designs an interim attribution that a
  specialist approves (an audit table ahead of `24-S1` is a migration, which is Ask First). No
  no-write tripwire is extended to `rates.ts`: it would fail `03-S2`'s own legitimate `upsertRates`.
- **Server function.** None user-facing. The refresh is a **cron branch**, not a request path.
- **Zod.** `z.strictObject({ base, quote, date: z.iso.date() })`; a rate response from a provider is
  parsed before it is trusted, because a provider returning `null` for a pair must produce a skipped
  pair, not a `NaN` written into an integer column.
- **Authorisation.** Cron principal for the refresh; `requirePermission('catalog:write')` for the
  console path.
- **Ledger batching.** Not applicable directly. What **is** stated here: a rate write does **not**
  trigger a balance-history rebuild. The nightly sweep (`09-S3`) revalues; a rate arriving at 03:00
  and a rebuild starting at 03:00 would otherwise race. The cron order is rates first, then the
  sweep, inside one scheduled invocation.
- **Provider policy.** `FX_PRIMARY` and `FX_FALLBACK` are `wrangler.jsonc` vars. The client tries the
  primary, falls back on any non-2xx or a parse failure, and **records `source` per row** so a bad
  day is identifiable afterwards. Timeout 10 s, two retries, no retry on 4xx.

### UI (route, components)

- **Route.** None.
- **Components.** None.
- **States.** Not applicable.
- **Tokens.** None.
- **Accessibility.** Where a converted amount is shown later, the rate and its date are available as
  text — not only as a tooltip — because a tooltip is not reachable in every input mode. That
  requirement is recorded here and honoured by `07-S3` and `17-S2`.

### Quota

No countable tenant row: rates are global. The **cost** is a nightly outbound fetch per currency pair
any workspace holds, which is a line in `docs/ARCHITECTURE.md` §7 and is bounded by only refreshing
pairs that are actually held.

### Tenant isolation test

`exchange_rates` is global; the isolation property that matters is the **inverse** —
`organization_exchange_rates` (`03-S3`) must never fall back to another workspace's flat rate. That
case lives in `03-S3`. Here, `rates.test.ts` asserts the console write path is permission-guarded and
audited, as in `24-S1`'s guard and audit table; `03-S2`'s pull request adds that guarded-and-audited
write case.

### Money invariant

Three cases in `money-invariants.test.ts`:

- _a rate is an integer_: `upsertRates` rejects a non-integer `rate_e10` at the repository parse, not
  at the column.
- _conversion is integer arithmetic_: `mulRate(minor, rateE10, digits)` for a known pair equals a
  hand-computed integer exactly — no epsilon, no `toBeCloseTo`. A test that tolerates a float is a
  test that documents the bug.
- _a missing rate is an error, not a 1.0_: `getRate` for a pair with no row throws
  `RateUnavailableError`. Defaulting to parity is how a foreign-currency account silently reports its
  native balance as its base balance.

### Verification

- Command gate.
- `client.test.ts`: primary success; primary 5xx → fallback used and `source` recorded as the
  fallback; both fail → the pair is skipped with a log, and **no partial row is written**; a provider
  returning a string rate parses to an integer `rate_e10` or is rejected.
- `rates.test.ts`: the three money cases above plus batched `getRatesForDates` returning a dense map
  with explicit holes rather than an implicit forward-fill (forward-filling belongs to the rebuild,
  not the store).
- A local cron invocation through `wrangler dev --test-scheduled` for `0 3 * * *`, with the rate rows
  observed and the ordering (rates before sweep) visible in the log.
- No browser evidence and no axe run: no surface.

### Definition of done

§7 items 1–3 and 5–7. Item 4 does not apply (no surface).

### Blockers

**`OPEN-4`** — the FX provider decision. The client is written to a **two-provider interface** so the
decision is a configuration change rather than a rewrite, and `FX_API_KEY` is read only if the
selected provider declares that it needs one. Shipping without the decision is possible; shipping
without recording `source` per row is not, because that is what makes a wrong day diagnosable.

---

## Stage 03-S3 — The workspace currency layer

### Stage id

`03-S3` · Wave 1 · effort **M**.

### Reference rows

`MNY-06 missing → done` — `organization_currencies` with exactly one base.
`MNY-07 missing → done` — `organization_exchange_rates` as effective-dated **ranges**.
`MNY-08 missing → done` — the rate-resolution order.

### Owned paths

- `src/server/repos/workspace-currencies.ts` — new
- `src/server/fns/currencies.ts` — new
- `src/routes/_app/settings/currencies.tsx` — new
- `src/routes/_app/settings/-ui/currency-list.tsx` — new
- `src/routes/_app/settings/-ui/flat-rate-form.tsx` — new
- `src/server/repos/__tests__/workspace-currencies.test.ts` — new
- `e2e/currencies.visual.spec.ts` — new

### Data and migration

`organization_currencies` and `organization_exchange_rates` exist from `00-S5`. No schema change.

Two properties are enforced by the schema and re-asserted by the repository:

- **Exactly one `is_base` per organization**, by a partial unique index. Changing the base currency
  is therefore a transaction that clears and sets in one `db.batch`, never two statements.
- `organization_exchange_rates` is keyed on `effective_from` with a nullable `effective_to` — a
  **range**, not a point. A flat rate that applies "from March" and a later one "from June" must not
  both claim March.

### Server (repo, server function, Zod)

- **Repository.** `src/server/repos/workspace-currencies.ts` on the tenant-scoped base:
  `listWorkspaceCurrencies`, `addWorkspaceCurrency`, `removeWorkspaceCurrency`, `setBaseCurrency`,
  `setLiveRateUpdate`, `upsertFlatRate`, `resolveRate({ base, quote, date })`.
- **`resolveRate` is the rate-resolution order, and it is the whole point of this stage.** In order:
  (1) a workspace flat rate whose range contains `date` **only when** `live_rate_update = false` for
  that currency **and** the quote is the base currency; otherwise (2) the per-day catalogue rate for
  `date`; otherwise (3) throw `RateUnavailableError`. There is no step 4 and no default of 1.0.
- **Server function.** `listWorkspaceCurrencies` (GET), `addWorkspaceCurrency`,
  `removeWorkspaceCurrency`, `setBaseCurrency`, `upsertFlatRate` (POST). `setBaseCurrency` enqueues a
  **full balance-history rebuild for every account** on `TASKS`, because every `ref_amount` grid is
  now against a different base.
- **Zod.** `z.strictObject` per input; `upsertFlatRate` validates `effective_from <= effective_to`
  and rejects an overlapping range against the existing set **in the repository**, after the shape
  parse — overlap is a data question, not a shape one.
- **Authorisation.** `requireOrg({ role: ['owner', 'admin'] })` for every write, re-reading the role
  from `member` rather than trusting the session claim.
- **Ledger batching.** `setBaseCurrency` and `removeWorkspaceCurrency` run inside
  `runWithLedgerBatch` at the server-function boundary, so the rebuilds are enqueued once per account
  after the write settles — including when the write throws, because the rows are already committed.
- **`removeWorkspaceCurrency` refuses** when an account or a transaction still holds the currency.
  A currency with rows behind it is not removable, and the error names the first blocking account.
- **Acceptance items handed off from `03-S1`**, which ships the catalogue's reads only
  (`listEnabledCurrencies` in `src/server/catalog/currencies.ts`):
  - `listCurrencies` is a GET server function in `src/server/fns/currencies.ts` with `requireUser()`
    and a strict empty Zod input, and it calls `listEnabledCurrencies`.
  - The catalogue-existence check refuses a disabled code **through the catalogue module**.
    `requireCatalogueCurrency` is private to `src/server/repos/workspace-currencies.ts` today and
    does not read `is_disabled`, so that means exporting it or moving it. Nothing can disable a
    currency before `24-S3`, so this lands no later than that stage.
  - The stage decides what a workspace that already holds a currency sees once it is disabled.
  - The locale-sorted picker applies the enabled set over `currenciesForPicker(locale)`, which keeps
    the first eleven in declaration order and re-sorts the tail by localised name.
  - Two facts are owed to this stage's own reconciliation and are **not** fixed by `03-S1`: the
    workspace-currencies module already exists although the stage lists it as new, and the stage
    has no `Delivered:` line.

### UI (route, components)

- **Route.** `/settings/currencies` (`src/routes/_app/settings/currencies.tsx`), SSR default.
- **Components.** Reuses `Table`, `Select`, `Switch`, `Button`, `Dialog`, `MoneyField` and
  `DatePicker` from `src/components/ui`. New: `currency-list.tsx` (the workspace's currencies with
  base, live-update and today's rate), `flat-rate-form.tsx` (the effective-dated flat rate).
- **States.** Empty: never truly empty — a workspace always has its base — so the empty state is the
  _one-currency_ state, with copy explaining what adding a second gets you and a single primary
  action. Skeleton: three table rows. Error: an `ErrorPanel` with a Retry that refetches the list;
  a rate that failed to load renders as `—` with a title, never as `1.0000`.
- **Tokens.** None new; rates are `tabular-nums` and end-aligned.
- **Accessibility.** Changing the base currency is a **destructive-adjacent** action: it opens a
  confirmation dialog naming what will be recomputed, and the confirm button is not the default
  focus. The rate column shows the rate **and its date as text**, per `03-S2`.

### Quota

The `currencies` metric counts workspace currencies **beyond the base**. `addWorkspaceCurrency` calls
`assertWithinLimit(scope, 'currencies', current + 1)` **inside the repository, before the insert**.
The metric exists in `src/lib/plans.ts` from `00-S4`; the resolver wiring is `22-S1`, and until that
lands `assertWithinLimit` is a no-op that still sits at the correct call site — the call site is the
part that is expensive to add later.

### Tenant isolation test

Added to `src/server/repos/__tests__/tenant-isolation.test.ts`: workspace A, in A's scope, attempts to
read, list, update and delete B's `organization_currencies` and `organization_exchange_rates` rows by
id, and to `upsertFlatRate` onto B's currency. Every one is a `NotFoundError`, and B's rows are
unchanged afterwards. Functions covered: all seven exports of `workspace-currencies.ts`.

**Plus the case this stage exists for:** `resolveRate` in A's scope **never returns B's flat rate**,
even when B has one for the same pair and date and A has none. It falls through to the catalogue
rate, or throws.

### Money invariant

_A workspace has exactly one base currency, and a flat rate only wins when it is allowed to._ Cases
in `money-invariants.test.ts`:

- _exactly one base_: two concurrent `setBaseCurrency` calls leave exactly one `is_base` row.
- _flat rate precedence_: with `live_rate_update = true`, the catalogue rate wins even when a flat
  rate covers the date; with `live_rate_update = false` and the quote **not** the base, the catalogue
  rate still wins.
- _ranges do not overlap_: `upsertFlatRate` rejects a range overlapping an existing one for the same
  pair.
- _changing the base enqueues a rebuild per account_, asserted on the queue spy, because a base change
  that does not rebuild leaves every historical `ref_amount` measured against a currency the workspace
  no longer reports in.

### Verification

- Command gate.
- `workspace-currencies.test.ts` and the isolation and money cases above.
- Browser evidence: `/settings/currencies`, both themes, at **360 / 1280 / 2560 px** — six frames —
  plus the base-change confirmation dialog open (the interaction state that is the point of the
  stage) and the one-currency empty state.
- `e2e/currencies.visual.spec.ts` runs `@axe-core/playwright` on `/settings/currencies`: zero
  `serious`, zero `critical`. No `moderate` waiver expected.
- Console silent on load, on add, and on base change.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

**`OPEN-1`** — whether multi-currency is a paid module. It changes whether
`/settings/currencies` renders an upgrade wall for a `free` workspace, which is a real surface, not a
flag. The stage ships the surface and the `assertWithinLimit` call site; the _gate_ is `22-S3`'s
wiring, which is where the answer lands.
