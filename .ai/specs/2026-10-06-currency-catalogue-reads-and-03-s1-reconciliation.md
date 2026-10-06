# The currency catalogue's read side, its seed parity test, and plan stage 03-S1 reconciled

| Field              | Value                                       |
| ------------------ | ------------------------------------------- |
| **Status**         | ready                                       |
| **Issue**          | none                                        |
| **Spec PR**        | none                                        |
| **Implementation** | none                                        |
| **Plan**           | 03-S1 (docs/plans/03-money-and-currency.md) |

## 📝 TLDR

Plan stage `03-S1` (`docs/plans/03-money-and-currency.md`, "The currency catalogue") was written
before the code, and the code has since delivered most of it in a different shape: the catalogue is
the hand-written table in `src/lib/money/currencies.ts` (56 currencies), `src/server/catalog/data/currencies.ts`
derives the seed rows from it, and `drizzle/0002_seed_currency_catalogue.sql` loads them. Three claims of
the stage no longer hold and one of them cannot be built at all. This spec covers what is left.
Phase 1 adds the stage's missing server half, a read-only `listEnabledCurrencies(db)` in
`src/server/catalog/currencies.ts`, and the tests that pin the seeded D1 table to the catalogue, pin
`digits` as read from that table and keep every non-currency out of it. Phase 2 amends the plan to
what the code is, hands the guarded and audited write path to stage `24-S3` (where the audit table
is built) with an explicit checklist, adds the exclusion list to `docs/MONEY.md` §1 and records the
stage as delivered. No schema change, no migration, no new dependency, no write path.

## 📝 Problem Statement

Verified against the repository at the time of writing (commands in Resolved assumptions row 9).

**What the code already delivers**

- The `currencies` table exists (`src/server/db/schema.ts`, `code` PK, `name`, `digits` with a
  `0..4` `CHECK`, `numeric_code`, `is_disabled`, an index on `is_disabled`) and holds all 56 ISO-4217
  currencies the product supports, every one enabled, from `drizzle/0002_seed_currency_catalogue.sql`.
  Plan row `MNY-01` is therefore met, and `OPEN-6` (zero-decimal currencies) is answered the way the
  stage said it would be until a person decides otherwise: ISK, JPY, KRW, VND and CLP, the five `digits: 0`
  rows ship **enabled**.
- `src/lib/money/currencies.ts` is the single source of `digits`, names and symbols, browser-safe
  because the transaction form needs the scale to parse input. `src/server/catalog/data/currencies.ts`
  derives `CURRENCY_SEED_ROWS` from it rather than restating it, and `src/server/auth/organization.ts`
  consumes the defaults. `src/lib/__tests__/currencies.test.ts` pins the table, the ISO-vs-CLDR
  divergence for HUF, IDR, ALL and COP, the picker order, the projection and the absence of
  `XAU XAG XPT XPD XDR XXX XTS` from the table.
- A read of the table already exists in `src/server/repos/workspace-currencies.ts`
  (`requireCatalogueCurrency`, an unscoped existence check) and the DB test harness
  (`src/server/repos/__tests__/db-harness.ts`) replays every migration, seed included.

**What does not hold**

1. **The stage's server half does not exist.** `src/server/catalog/currencies.ts` is absent: nothing
   reads `currencies.is_disabled`, so "the enabled catalogue" is not a thing any code can ask for,
   and the stage's money invariant (`digits` is read from this table) has no test against the table.
2. **The guarded, audited write cannot be built in Wave 1.** The stage requires
   `requirePermission('catalog:write')` plus a `platform_audit_log` row in the same `db.batch`.
   Neither exists. `platform_audit_log` is not in the schema or in any migration (`schema.ts` line 60
   says it is deliberately left to the console plan, and `00-S1`'s FND-02 row defers it to `24-S1`,
   Wave 5). `requirePermission` exists only as prose: the code has the pure
   `permits(actor, { catalog: ['write'] })` in `src/server/auth/permissions.ts` over Better Auth's
   `admin | curator | user` roles, not the `platform_roles` table that `24-S1` describes. The plan's
   own text already says `setCurrencyDisabled` "is `24-S3`'s surface", and nothing can set
   `is_disabled` before that stage, so the write has no caller for four waves.
3. **The generator is a plan-time guess the code outgrew.** The stage prescribes
   `scripts/catalog/build-currencies.mjs` emitting `src/server/catalog/data/currencies.ts` from an
   ISO list, plus a byte-identity test. There is no ISO data file in the repository, adding a
   dependency for one is Ask First (`docs/SPEC.md` §3), and a hand-typed "source" file would be the
   second copy that `src/lib/money/currencies.ts` and the seed module exist to prevent. The drift
   that can actually happen is between that table and the hand-authored migration `0002`: they agree
   today (56 tuples, no mismatch in code, name, digits or numeric code) and **nothing pins it**.
4. **The stage text is stale in three more places.** "No migration is produced and none is needed"
   ignores `0002`. The exclusion list is promised "in the script and in `docs/MONEY.md` §1", and
   §1 has none. `src/server/catalog/index.ts` is an owned path, but every importer uses a direct path
   (`#/server/catalog/account-types`), and `account-types.ts` is deliberately importable from a route
   module without a database handle, which a shared barrel would break.
5. **The stage carries no `Delivered:` line**, so `backlog-status.mjs --plan` keeps offering it.

A stage with an unpinned invariant is not delivered, so it is not marked delivered today
(`afk-plan-to-spec` § 2a). It gets this spec.

## 📝 Proposed Solution

Two phases, one small pull request each. Stage `03-S1` is this whole spec.

- **Phase 1 (code and tests).** Add `src/server/catalog/currencies.ts` exporting one function,
  `listEnabledCurrencies(db)`: a read of `currencies where is_disabled = 0` that returns the rows
  as stored (`code`, `name`, `digits`, `numericCode`), in the catalogue's picker order. Add the
  tests that tie the D1 table to `CURRENCIES`, read `digits` from it, exclude non-currencies and
  assert the module holds no write.
- **Phase 2 (documents).** Reconcile the plan with the code, write the hand-off checklists for the
  stages that inherit the write path, add the exclusion list to `docs/MONEY.md` §1, and add the
  `Delivered:` line last.

Out of scope, and why: a write path (needs `24-S1`'s audit table, row 1); a `listCurrencies` server
function (no caller until `03-S3`, whose file it is, row 3); a generator (row 2); touching
`workspace-currencies.ts` (`03-S3`'s file); any UI.

## 📝 Architecture

- **Owner module** of the currency catalogue's server reads is `src/server/catalog/currencies.ts`
  (`docs/SPEC.md` §6.1: the stated carve-out, a global table with no `organization_id`). The
  catalogue's _values_ stay owned by `src/lib/money/currencies.ts`; `src/server/catalog/data/currencies.ts`
  stays the derived projection.
- **Seam.** `listEnabledCurrencies(db: Database)` takes a bare database, never a `TenantScope`:
  there is no tenant predicate to compose, and handing a catalogue read a scope would suggest there
  is one. `Database` is the type-only import from `#/server/repos/scope`.
- **No barrel.** `src/server/catalog/index.ts` is not created (Resolved assumptions row 4).
- **Ordering.** The function returns rows in the static table's order (`CURRENCIES` index), the
  order the pickers already use; a code the static table does not know (one a future console stage
  adds) sorts after the known ones, by code. Ordering is applied in TypeScript over the rows read,
  because the order is not a column.
- **Types.** `digits` is returned as the stored `number`; the schema `CHECK` allows `0..4`, the
  static type `MinorUnitDigits` is `0 | 2 | 3`, and the function does not narrow it, so a catalogue
  row with `digits: 4` flows through as `4` rather than being silently coerced.

## 📝 Data Model

No schema change and no migration. `currencies` exists from `00-S1`; `0002_seed_currency_catalogue.sql`
loads it and is not edited (`drizzle/` is generated or immutable history, and `pnpm db:generate` must
leave the diff clean). Stated so nobody looks for one.

## 📝 API Contracts

```ts
// src/server/catalog/currencies.ts
export interface CatalogueCurrency {
  readonly code: CurrencyCode
  readonly name: string // English, as stored
  readonly digits: number // as stored; never assumed
  readonly numericCode: number | null
}

export function listEnabledCurrencies(
  db: Database,
): Promise<ReadonlyArray<CatalogueCurrency>>
```

- No Zod: the function takes no caller-supplied value. (The rule "Zod twice" applies to the
  `listCurrencies` server function that `03-S3` adds.)
- **Authorisation.** Not decided here. The function is a read of a global reference table and is
  called only from server code that has already resolved a user; the guard belongs to the server
  function that calls it (`requireUser()` in `03-S3`).
- No money amount is produced, so no float question arises.

## 📝 UI/UX

None. No route, component, state or token. The accessibility rule the plan states, that a currency is
always presented as code plus name (`PLN — Polish złoty`) and never a flag alone, is carried by
`03-S3`, the first surface to render the list.

## 📝 Edge Cases & Failure Scenarios

- **A disabled currency.** `is_disabled = 1` rows are excluded. Nothing can set the flag today, so
  the test sets it with a direct `update` on the harness database, which is a test fixture and not a
  production path.
- **A code in D1 that the static table lacks.** Returned, sorted last; not dropped. Dropping it would
  hide a currency an operator added on purpose, and a hidden currency is a reader who cannot find
  their account's unit.
- **An empty table.** Returns `[]`. The empty catalogue is what the migration exists to prevent
  (`0002`'s header), and the parity test fails first.
- **A non-currency in the table** (`XAU`, `XXX`, `XTS`, a fund code). Cannot arrive through this
  module (no write); the exclusion test asserts it is absent from the seeded table, because a metal
  with `digits: 0` silently behaves like JPY (`docs/MONEY.md` §1.2).
- **Drift between `0002` and `CURRENCIES`.** Fails the parity test in CI, which is the point.

## 📝 Risks & Impact Review

| Risk                                                                                                                           | Mitigation                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The stage's authorisation-and-audit obligation is silently dropped by moving the write.                                        | Phase 2 writes the checklist into `24-S3` and the carve-out sentence stays in `docs/SPEC.md` §5.2 unedited; a Phase 1 test asserts `src/server/catalog/currencies.ts` contains no write, so nobody adds an unguarded one in the meantime (row 1). |
| A disabled currency can still be added to a workspace, because `requireCatalogueCurrency` does not read the flag.              | Unreachable until `24-S3` makes the flag writable. Phase 2 makes "reject a disabled code through the catalogue module" an acceptance item of both `03-S3` and `24-S3`, to land no later than `24-S3` (row 3).                                     |
| `03-S2`'s plan text says rate writes "carry the `requirePermission` + audit rule of `03-S1`", which this spec moves.           | Phase 2 re-points that sentence at `24-S1` and says `03-S2`'s own spec settles how its cron write is attributed meanwhile (row 8).                                                                                                                |
| The parity test reads `drizzle/0002` through the harness and would break if a later migration legitimately changes a currency. | A later migration that changes the catalogue must change `src/lib/money/currencies.ts` in the same pull request, which is the invariant being pinned; the test names both files in its failure message.                                           |

Tenant isolation: the table is global, so there is no tenant predicate and no
`tenant-isolation.test.ts` case. The case that guards the carve-out in its place is the
no-write assertion in Phase 1 step 3.

## 📝 Visual change expected

None. Backend and tests only: no route, component or state changes on screen in either theme, on
desktop or on mobile. No browser evidence and no axe run.

## 📝 Copy

None. This change adds no user-facing string, so no key lands in the EN or PL catalogue
(`i18n-messages` skill).

## 📋 Phasing

| Phase | Delivers                                                                                       | Files                                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `listEnabledCurrencies`, the seed parity, `digits`-is-read, exclusion and no-write tests       | `src/server/catalog/currencies.ts`, `src/server/catalog/__tests__/currencies.test.ts`, `src/server/repos/__tests__/money-invariants.test.ts` |
| 2     | Plan reconciliation, hand-off checklists, `docs/MONEY.md` §1 exclusion list, `Delivered:` line | `docs/plans/03-money-and-currency.md`, `docs/plans/24-console.md`, `docs/MONEY.md`                                                           |

Two tickets. The slicer may merge them into one pull request; step 8 says what to do then.

## 📋 Implementation Plan

### Phase 1

1. **Write the tests first** (`tdd` skill). In `src/server/catalog/__tests__/currencies.test.ts`
   (the `server` vitest project, Node, `openTestDb()` from `#/server/repos/__tests__/db-harness`):
   - _the seeded table equals the catalogue_: select every `currencies` row and assert it equals
     `CURRENCIES` in code, `name` (English), `digits` and `numeric_code`, that the counts agree (read
     both, never a literal 56) and that every row has `is_disabled = 0`. The failure message names
     `drizzle/0002_seed_currency_catalogue.sql` and `src/lib/money/currencies.ts`.
   - _non-currencies are absent from the table_: `XAU XAG XPT XPD XDR XXX XTS` select no row.
   - _only the enabled rows are listed, in picker order_: with the seeded table the result equals
     `CURRENCIES` order; after setting one row `is_disabled = 1` by a direct `update` on the harness
     database it is missing and the rest keep their order; a row inserted with a code the static
     table lacks sorts last.
   - _the module holds no write_: read `src/server/catalog/currencies.ts` as text and assert it
     contains none of `.insert(`, `.update(`, `.delete(`, `.run(`, `.batch(`, and that its runtime
     exports are exactly `['listEnabledCurrencies']`. The message says a write needs the guard and
     the audit row of `24-S3` first.
2. **Add a section `15` to `src/server/repos/__tests__/money-invariants.test.ts`**,
   "_`digits` is read, never assumed_": through `listEnabledCurrencies`, JPY has `digits` `0` and
   `parseMoney('en', '1234', 'JPY')` is `1234`; KWD has `3` and `parseMoney('en', '1.234', 'KWD')` is
   `1234`; EUR has `2`. The second case, "_the catalogue excludes non-currencies_", repeats the
   absence check through the listing. Read `parseMoney`'s signature in `src/lib/money/format.ts`
   (`locale, text, currencyCode`) before writing the call.
3. **Implement** `src/server/catalog/currencies.ts` to make them pass: a `select` of the four columns
   `where is_disabled = 0` (drizzle `eq(currencies.isDisabled, false)`), mapped to
   `CatalogueCurrency`, ordered by the static table's index then by code. A docblock states: global
   table, no scope, **reads only**, why there is no write here yet (`24-S3`), and that `digits` comes
   from the row.
4. **Run the gate.** `node -e "require('./.ai/agentic.config.json').validation.commands.forEach(c=>console.log(c))"`
   and every command in the order printed, on the final commit. No `.skip`, `.only`, `.todo`, no
   `@ts-expect-error`, no `eslint-disable`.

Tenant-isolation test: none, global table; the no-write assertion (step 1) stands in. Money
invariant: step 2 is the stage's invariant; there is no new write path, so no further
`money-invariants.test.ts` case.

### Phase 2

5. **Amend the 03-S1 block** in `docs/plans/03-money-and-currency.md`, sweeping the whole block so no
   plan-only name survives:
   - Reference rows: `MNY-01` as is; `MNY-02` reworded to the catalogue repository's **reads** under
     `src/server/catalog`, with the guarded and audited **writes** stated as `CON-09` of `24-S3`.
   - Owned paths: `src/server/catalog/currencies.ts`, `src/server/catalog/__tests__/currencies.test.ts`,
     and the `money-invariants.test.ts` section; drop `data/currencies.ts` (exists, derived), `index.ts`
     and `scripts/catalog/build-currencies.mjs`.
   - Data and migration: the seed is `drizzle/0002_seed_currency_catalogue.sql`; the table
     `src/lib/money/currencies.ts` is the source; the projection is `src/server/catalog/data/currencies.ts`;
     the exclusion list is in the lib test and in `docs/MONEY.md` §1; the generator and the byte-identity
     test are dropped with the reason in one sentence.
   - Server: `listEnabledCurrencies`; the `listCurrencies` GET function moves to `03-S3`; the write
     path and `setCurrencyDisabled` move to `24-S3`; `requirePermission` is described as it is
     (`permits({ catalog: ['write'] })` over the platform roles today, the audited guard arriving
     with `24-S1`).
   - Tenant isolation test, Money invariant and Verification: the cases of Phase 1; the guard-and-audit
     case moves to `24-S3`.
   - Blockers: `OPEN-6` stays; the line says the catalogue ships all 56 enabled, which is the
     plan's own default.
6. **Write the hand-offs.**
   - `03-S3` (same plan file): `listCurrencies` (GET, `src/server/fns/currencies.ts`, `requireUser()`,
     strict empty Zod input) calls `listEnabledCurrencies`; `requireCatalogueCurrency` refuses a
     disabled code through the catalogue module. Both as acceptance items.
   - `03-S2` (same plan file): the sentence that rate writes "carry the `requirePermission` + audit
     rule of `03-S1`" (Server bullet, and the test sentence further down) is re-pointed at `24-S1`'s
     guard and audit table, with the note that `03-S2`'s own spec settles how its cron write is
     attributed until then. Change nothing else in `03-S2`.
   - `24-S3` (`docs/plans/24-console.md`, catalogue paragraph): the catalogue write path acceptance
     list: `permits({ catalog: ['write'] })` checked server-side and `ForbiddenError` otherwise; one
     audit row, written through `withAudit` or in the same `db.batch`; Zod parsed twice; deactivating
     a currency in use by a workspace is refused with the count; `requireCatalogueCurrency` rejects a
     disabled code; one test for the denied caller and one for the single audit row on success; and
     the no-write assertion of this spec's Phase 1 is replaced, in that PR, by those cases.
7. **Add the exclusion list to `docs/MONEY.md` §1** (a short paragraph after §1.2's table, no
   renumbering): the metals `XAU XAG XPT XPD`, fund codes, `XDR`, `XXX` and `XTS` are not currencies
   with minor units and are excluded from the catalogue; cite `src/lib/__tests__/currencies.test.ts`
   ("carries no metal, fund or placeholder code") and Phase 1's table test. Cite §1.2, never restate the arithmetic.
8. **Add the `Delivered:` line** directly under `## Stage 03-S1`:
   `Delivered: <YYYY-MM-DD> - <evidence>`, dated the day Phase 2 is written, naming the paths, the
   Phase 1 pull request and a currency count and test count read from commands run in that PR. If
   the slicer merged the phases into one pull request, name the paths and tests and add the pull
   request number in a final commit once it is known. Change nothing outside the blocks named in
   steps 5 to 7 (the stage register of `docs/plans/README.md` is not edited).
9. **Run the gate** as in step 4, plus
   `pnpm exec prettier --check docs/plans/03-money-and-currency.md docs/plans/24-console.md docs/MONEY.md`
   (`pnpm check` cannot be scoped to files).

## 📝 Resolved assumptions (autonomous defaults)

Every row is a decision this run made without a human, or a default it applied. Each is reversible
before merge by saying so on the spec PR.

| #   | Question                                                                                                       | Applied default                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Where does the guarded, audited catalogue write live: now with a new audit table, now without audit, or later? | **Later: 03-S1 ships reads only; the write and its audit move to `24-S3`, with a hand-off checklist and a test that `src/server/catalog/currencies.ts` holds no write.**                                                                                                                                                                                                                                                                                                            | Decided by security-tenancy-reviewer sub-agent (confidence high): `platform_audit_log` and `requirePermission` exist only in comments (`schema.ts` lines 60 and 492), so a Wave 1 write would either be unaudited, which the carve-out in `docs/SPEC.md` §5.2 and ADR 0002 forbids, or pre-empt `24-S1`'s `withAudit` design with a second migration. Nothing reads `is_disabled` yet. Conditions applied: no table, migration or `permits()` wrapper here; plan text corrected; checklist and the no-write test; the `03-S3` rate-write dependency noted (row 8). |
| 2   | Build `scripts/catalog/build-currencies.mjs`, or keep the lib table as the source?                             | **Retire the generator. `src/lib/money/currencies.ts` stays the source; a test replays the migrations and pins the `currencies` table to it.**                                                                                                                                                                                                                                                                                                                                      | Decided by software architect sub-agent (confidence high): a generator needs an ISO data file or a dependency (Ask First, `docs/SPEC.md` §3), a hand-typed source is a second copy, and the real drift risk is the hand-authored `0002`. Conditions applied: table test with count, `is_disabled` and the exclusion check through the harness; plan text amended; `drizzle/` untouched.                                                                                                                                                                            |
| 3   | Ship the `listCurrencies` server function in 03-S1?                                                            | **No. 03-S1 ships the repository read only; `listCurrencies` and the disabled-code refusal in `requireCatalogueCurrency` are acceptance items of `03-S3` and `24-S3`.**                                                                                                                                                                                                                                                                                                             | Decided by software architect sub-agent (confidence medium): a function with no caller fails the deletion test in `afk-codebase-design`, and `src/server/fns/currencies.ts` is `03-S3`'s owned path. Conditions applied: bare-`Database` signature, `where is_disabled = 0`, row-sourced `digits`, picker order; the hand-off wording; both choices recorded.                                                                                                                                                                                                      |
| 4   | Create the plan's `src/server/catalog/index.ts` barrel?                                                        | **No.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Every importer uses a direct path, and `account-types.ts` is documented as importable from a route module with no database handle; one barrel over both would drag a handle into route bundles. A one-function barrel also fails the deletion test. Default applied by this run; the architect named a re-export, which the plan's file list is amended to drop.                                                                                                                                                                                                   |
| 5   | Do zero-decimal currencies ship enabled (`OPEN-6`)?                                                            | **Yes, all 56 stay enabled.**                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The stage's own default: disabling later is a flag, enabling later is a data migration. `0002` already seeds them enabled. No decision reserved for a person (`afk-decide` § 5).                                                                                                                                                                                                                                                                                                                                                                                   |
| 6   | Where do the money-contract cases live?                                                                        | **Section `15` of `money-invariants.test.ts` for the two named cases; table, ordering and no-write cases in the catalogue test.**                                                                                                                                                                                                                                                                                                                                                   | The plan names `money-invariants.test.ts`; its sections are numbered by invariant, so this is the next number. The harness is borrowed through `openTestDb`, as `dashboard-data.test.ts` does.                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | Does Phase 2 add the `Delivered:` line, and when?                                                              | **Yes, as its last step, after Phase 1 has merged.**                                                                                                                                                                                                                                                                                                                                                                                                                                | `docs/plans/TEMPLATE.md` and `docs/plans/README.md` define the line; it stops `backlog-status.mjs --plan` offering the stage. Last keeps the marker true.                                                                                                                                                                                                                                                                                                                                                                                                          |
| 8   | What about `03-S2`'s dependence on the same guard?                                                             | **Phase 2 re-points its sentence at `24-S1`; `03-S2`'s own spec settles the cron write's attribution.**                                                                                                                                                                                                                                                                                                                                                                             | Security reviewer condition (row 1): the cron "system principal" must not become a bypass, and that stage is a separate one-spec-per-stage run. This spec only stops its text citing a rule that moved.                                                                                                                                                                                                                                                                                                                                                            |
| 9   | Which numbers in this spec are measured?                                                                       | `56` seeded tuples: `grep -c "^  ('" drizzle/0002_seed_currency_catalogue.sql`. `56` catalogue entries, `5` with `digits: 0` and `5` with `3` (so `46` with 2): `grep -c "digits: [03]" src/lib/money/currencies.ts` is `10`, split by `grep -c "digits: 2"` (`46`) and `grep -B2 "digits: 0\|digits: 3"` over `code:` lines (ISK JPY KRW VND CLP; KWD BHD OMR JOD TND). No mismatch in code, name, digits or numeric code between the two: a throwaway vitest file, since deleted. | `docs/SPEC.md` §7.7: every number written down came from a command whose output was read. Phase 2's evidence line re-measures them in its own pull request rather than copying these.                                                                                                                                                                                                                                                                                                                                                                              |
