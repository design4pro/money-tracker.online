# 13 — Recurring

## Area brief

Subscriptions, bills, instalments and recurring income — modelled as a **series** with materialised
**periods**, links to the transactions that settled them, and **candidates** detected from history.

The tables are named `recurring_*` and never `subscriptions`: that name belongs to billing, and one
word for two concepts is exactly what `CONTEXT.md` forbids.

One structural refusal, enforced by a schema `CHECK` from `00-S7`: **`auto_record` and
`matching_rules` may not coexist.** They race for the same period — one writes a transaction and the
other tries to match a transaction that the first one wrote. The `CHECK` rather than a repository
guard, because the import path would otherwise be able to create the combination.

Because this product has no bank connectors, recurring series carry more weight here than in a
connected product: they are how an expected payment appears before it happens, and how a missed one
becomes visible.

---

## Stage 13-S1 — Series and periods

### Stage id

`13-S1` · Wave 3 · effort **XL**.

### Reference rows

`REC-01 missing → done` — the series repository with frequencies and anchors.
`REC-02 missing → done` — period materialisation and the `upcoming | paid | overdue | skipped`
lifecycle.
`REC-03 missing → done` — the series list and detail screens.

### Owned paths

- `src/server/repos/recurring-series.ts` — new
- `src/server/repos/recurring-periods.ts` — new
- `src/server/recurring/schedule.ts` — new
- `src/server/recurring/materialize.ts` — new
- `src/server/fns/recurring.ts` — new
- `src/routes/_app/recurring/index.tsx` — new
- `src/routes/_app/recurring/$seriesId.tsx` — new
- `src/routes/_app/recurring/-ui/series-card.tsx` — new
- `src/routes/_app/recurring/-ui/series-form.tsx` — new
- `src/routes/_app/recurring/-ui/period-grid.tsx` — new
- `src/server/recurring/__tests__/schedule.test.ts` — new
- `src/server/repos/__tests__/recurring.test.ts` — new
- `e2e/recurring.visual.spec.ts` — new

### Data and migration

`recurring_series`, `recurring_periods` and `recurring_links` exist from `00-S7`. No schema change.

`frequency` is `weekly | biweekly | monthly | quarterly | semi_annual | annual`; `anchor_day` fixes
the day of the month or the day of the week; `end_date` and `max_occurrences` are alternative
terminations and **at most one may be set** (a repository invariant).

### Server (repo, server function, Zod)

- **Repository.** `recurring-series.ts`: `listSeries`, `getSeries`, `createSeries`, `updateSeries`,
  `pauseSeries`, `resumeSeries`, `completeSeries`, `deleteSeries`. `recurring-periods.ts`:
  `listPeriods(seriesId)`, `markPaid({ periodStart, transactionId })`, `markSkipped`, `revertPeriod`,
  `getUpcoming({ within })`.
- **`schedule.ts`** is a pure function: `nextDueDates({ frequency, anchorDay, startDate, endDate,
maxOccurrences, count })`. Its edge cases are the whole content of the module and each has a test:
  - **month-end anchoring**: `anchor_day = 31` on a 30-day month is the 30th, and on February the
    28th or 29th — and it does **not** drift permanently, so March returns to the 31st.
  - `biweekly` counts from `start_date`, never from the calendar week.
  - a leap day anchor.
  - `end_date` and `max_occurrences` terminate on the correct occurrence, inclusive.
  - **All arithmetic goes through `@internationalized/date` on calendar dates, never through
    `Date` and never through UTC-ms addition** — adding 30 days is not adding a month, and a
    daylight-saving boundary is where a `Date`-based implementation silently shifts by an hour and
    lands on the wrong calendar day.
- **`materialize.ts`** creates `recurring_periods` rows for the next N occurrences, idempotent per
  `(series_id, period_start)`. It runs on series create/update and from the `7 * * * *` cron branch.
- **`markPaid`** links an existing transaction; it does **not** create one. Creating is
  `auto_record` (`13-S2`) or the person's own entry.
- **Overdue** is derived, not stored: a period is overdue when `due_on < today` and `status =
'upcoming'`. Storing it would need a job to flip it and would be wrong between runs.
- **Zod.** A discriminated union on the termination: `{ endDate }` or `{ maxOccurrences }` or neither.
  `expected_amount_minor` is `z.number().int().positive()`.
- **Authorisation.** `requireOrg()`.
- **Ledger batching.** Series and periods carry no account balance. `markPaid` links an existing
  transaction and changes no amount, so **no rebuild is enqueued** — stated explicitly.

### UI (route, components)

- **Route.** `/recurring` and `/recurring/$seriesId`, SSR default.
- **Components.** Reuses `Card`, `data-table`, `Select`, `MoneyField`, `DatePicker`, `Badge`, `Menu`,
  `Dialog`, `Meter`. New: `series-card.tsx`, `series-form.tsx`, `period-grid.tsx`.
- **States.** Empty: _"No recurring payments yet"_ with **Review detected candidates** as the primary
  action when any exist (`13-S3`), because a person with history should not be asked to type what the
  product can already see. Skeleton: four cards; on the detail screen, the period grid's shape. Error:
  `ErrorPanel` retryable.
- **Tokens.** None new.
- **Accessibility.** `period-grid.tsx` is a real `<table>` with one row per period and a **text status
  per row** (`Upcoming`, `Paid`, `Overdue`, `Skipped`) beside the colour. The next-due date is stated
  in full text on the card, not only as a relative phrase — _"Due 3 September 2026 (in 4 days)"_ —
  because a relative phrase alone is ambiguous when the page has been open for a day. Mark paid /
  skip / revert are real buttons in the row, keyboard-reachable without hover.

### Quota

`recurringSeries` is a metered metric. `createSeries` calls `assertWithinLimit(scope,
'recurringSeries', current + 1)` **inside the repository, before the insert**. Completed and paused
series count; the copy says so.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A attempts every series and period write on B's ids,
`markPaid` with B's `transactionId` onto A's period, and `getUpcoming` in A's scope. Every write is a
`NotFoundError`; `getUpcoming` never returns B's periods. Functions covered: all thirteen exports.

### Money invariant

_An expected amount is a plan, not a fact, and the two are never conflated._ Cases in
`money-invariants.test.ts`:

- _`expected_amount_minor` is never summed into a report_ — reports sum transactions, and an expected
  amount has no `ref_amount_minor` because it has no rate and no booking date until it settles.
- _`markPaid` does not copy the expected amount onto the transaction_: the transaction keeps the
  amount actually paid, and the period records both, so a variable bill shows its variance.
- _the variance is computed at read as `settled - expected` in the series' currency_, integer, and is
  never stored.
- _an expected amount in a currency other than the base is displayed in its own currency_ on the
  series card, with the base equivalent as secondary text — converting a plan at today's rate and
  showing only that is how a person's expectations quietly change with the exchange rate.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `schedule.test.ts`: the five edge cases above, each with a hand-written expected date list, plus a
  DST-boundary case for a weekly series in Europe/Warsaw asserting the calendar date does not shift.
- `recurring.test.ts`: idempotent materialisation, the derived-overdue rule, the termination union,
  the four money cases, the isolation cases.
- Browser evidence: `/recurring` with **four series in mixed states (one overdue)**, both themes, at
  **360 / 1280 / 2560 px**, plus `/recurring/$id`'s **period grid with a paid, an overdue and a
  skipped row**, and the **mark-paid dialog**.
- `e2e/recurring.visual.spec.ts` runs axe on both routes: zero `serious`, zero `critical`.
- Console silent through mark paid, skip and revert.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 13-S2 — Auto-record, matching and reminders

### Stage id

`13-S2` · Wave 3 · effort **L**.

### Reference rows

`REC-04 missing → done` — `auto_record` materialisation from the `7 * * * *` cron.
`REC-05 missing → done` — `matching_rules` linking an entered transaction to a period.
`REC-06 missing → done` — `remind_before` presets and their dispatch.

### Owned paths

- `src/server/recurring/auto-record.ts` — new
- `src/server/recurring/match.ts` — new
- `src/server/recurring/reminders.ts` — new
- `src/server/cron/recurring.ts` — new
- `src/server/recurring/__tests__/auto-record.test.ts` — new
- `src/server/recurring/__tests__/match.test.ts` — new

### Data and migration

None. Dedupe markers live in KV: `recurring:auto:v1:<seriesId>:<periodStart>` and
`recurring:remind:v1:<seriesId>:<periodStart>:<offset>`, both written **after** the action so a
failure retries.

### Server (repo, server function, Zod)

- **`auto-record.ts`** materialises a transaction for a period whose `due_on` has passed and whose
  series has `auto_record` set. It writes through `07-S1`'s `createTransaction`, marks the period
  paid, and writes the `recurring_links` row — **all in one `runWithLedgerBatch`**, so the account
  rebuilds once.
  - It is **idempotent per `(seriesId, periodStart)`**: the KV marker plus a unique check on
    `recurring_links` means a retried cron invocation cannot double-post a bill. Double-posting a
    rent payment is the worst failure this feature can have, so the guard is belt and braces.
  - The created transaction carries `categorization_source = 'automation'`, so it is distinguishable
    in the ledger from something the person entered.
- **`match.ts`** evaluates `matching_rules` (payee, amount tolerance, account, day window) against a
  newly created or imported transaction and links it to the earliest unpaid period. It links; it never
  creates. Its result carries a `match_source` of `rule`, and the person can unlink.
- **`reminders.ts`** resolves `remind_before` (max 3 offsets from `0d|1d|2d|3d|5d|1w|2w|1m`) into due
  reminder dispatches for the `*/15 * * * *` branch, emitting `recurring.due_soon` and
  `recurring.overdue` through plan `21`'s dispatcher (the same no-op-until-wave-5 arrangement as
  `12-S3`).
- **Zod.** `matching_rules` is a strict object with an explicit tolerance (`amountToleranceMinor`,
  integer) rather than a percentage — a percentage tolerance on a large bill matches unrelated
  transactions.
- **Authorisation.** Cron principal, per workspace, per scope.
- **Ledger batching.** As above: `auto-record` opens one batch per cron invocation and every
  transaction it writes joins it.

### UI (route, components)

None new. The series form (`13-S1`) already exposes `auto_record`, `matching_rules` and
`remind_before`; this stage supplies the behaviour behind those controls. The form's mutual-exclusion
message for `auto_record` + `matching_rules` is a copy requirement stated here and rendered there.

### Quota

No new metric. The auto-record path creates transactions, which are unmetered (`07-S1`).

### Tenant isolation test

Added to `tenant-isolation.test.ts`: the cron's auto-record pass, run over a fixture with A and B,
writes every transaction under the `organization_id` of its own series; `match` in A's scope never
links A's transaction to B's period. Functions covered: `runAutoRecord`, `matchTransaction`.

### Money invariant

**No double-posting, and no amount invented.** Cases in `money-invariants.test.ts`:

- _auto-record is idempotent_: running the cron branch three times for one due period produces exactly
  one transaction and one `recurring_links` row.
- _the auto-recorded amount is the series' `expected_amount_minor` exactly_, with `ref_amount_minor`
  computed at the **due date's** rate, not at the cron's run date — a bill due on the 1st that posts
  at 07:00 on the 1st uses the 1st's rate, which is the same thing, but a retry on the 2nd must still
  use the 1st's.
- _a matched transaction's amount is never overwritten by the expected amount_ — matching links, it
  does not correct.
- _the amount tolerance is an integer minor-unit window_, and a transaction outside it does not match.
- _auto-record and matching never both run for one series_, held by the schema `CHECK` and re-asserted
  here so a future migration that relaxes the `CHECK` fails a test.

### Verification

- Command gate.
- `auto-record.test.ts`: the idempotence case run three times; the due-date rate case; a series whose
  account was archived (it does not post and logs, rather than posting into an archived account); the
  single ledger batch.
- `match.test.ts`: the tolerance window, the day window, earliest-unpaid-period selection, and the
  no-overwrite case.
- A local `wrangler dev --test-scheduled` invocation for `7 * * * *` showing one transaction and the
  KV marker written after.
- No browser evidence and no axe run: no surface of its own; `13-S1`'s frames cover the controls.

### Definition of done

§7 items 1–3 and 5–7. Item 4 does not apply (no surface of its own).

### Blockers

**A dependency on plan `21`** for reminder dispatch, handled by the same named no-op arrangement as
`12-S3`.

---

## Stage 13-S3 — Candidate detection

### Stage id

`13-S3` · Wave 3 · effort **M**.

### Reference rows

`REC-07 missing → done` — detection of recurring patterns from transaction history.
`REC-08 missing → done` — the candidate review screen.

### Owned paths

- `src/server/recurring/detect.ts` — new
- `src/server/repos/recurring-candidates.ts` — new
- `src/routes/_app/recurring/candidates.tsx` — new
- `src/routes/_app/recurring/-ui/candidate-card.tsx` — new
- `src/server/recurring/__tests__/detect.test.ts` — new
- `e2e/recurring-candidates.visual.spec.ts` — new

### Data and migration

`recurring_candidates` exists from `00-S7`: `status` (`pending | accepted | dismissed`), `confidence`,
`sample_transaction_ids` JSON. No schema change.

### Server (repo, server function, Zod)

- **`detect.ts`** groups the last 18 months of transactions by `(payee_id, account_id, direction)`,
  looks for **three or more** occurrences whose date gaps cluster around a supported frequency within
  a tolerance of ±3 days, and whose amounts agree within 10% of the median. It emits a candidate with
  a `confidence` derived from the count, the gap variance and the amount variance — **and the
  candidate records which of the three signals was weakest**, because "why did you suggest this" is a
  question a person will ask.
- Detection is **on demand**, from the candidates route, not on a cron: the scan is over one
  workspace's history and running it nightly for everybody buys nothing.
- Accepting a candidate calls `13-S1`'s `createSeries` pre-filled from the samples; dismissing writes
  `status = 'dismissed'` so it never reappears.
- **Zod.** The accept payload is the same `createSeries` input, so a person can adjust everything
  before it becomes a series.
- **Authorisation.** `requireOrg()`.
- **Ledger batching.** None; detection reads and accepting writes a series, which carries no balance.

### UI (route, components)

- **Route.** `/recurring/candidates`, SSR default.
- **Components.** Reuses `Card`, `Table`, `Button`, `Badge`, `Dialog`. New: `candidate-card.tsx`.
- **States.** Empty: _"Nothing detected"_ with a line explaining that detection needs at least three
  similar transactions — which turns a dead end into an explanation. Skeleton: three cards. Error:
  `ErrorPanel` retryable.
- **Tokens.** None new.
- **Accessibility.** Each candidate shows **the sample transactions that produced it**, as a real
  table, so the person can check the evidence rather than trust a confidence number. Confidence is
  rendered as a word (`High` / `Medium` / `Low`) with the numeric value available as text — a bare
  `0.72` means nothing to most readers and a bar alone means nothing to a screen-reader user.

### Quota

Accepting a candidate consumes `recurringSeries` through `13-S1`'s call site. Detection itself
consumes nothing.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: `detectCandidates` in A's scope reads only A's transactions and
never returns a candidate whose samples include B's rows; `dismissCandidate` on B's id is a
`NotFoundError`. Functions covered: `detectCandidates`, `listCandidates`, `acceptCandidate`,
`dismissCandidate`.

### Money invariant

_Detection compares amounts within one currency and never across._ Cases:

- _a group whose transactions are in two currencies produces no candidate_ — a 10% amount agreement
  across currencies is meaningless, and converting to base first would make an FX-driven variation
  look like a variable bill.
- _the candidate's suggested `expected_amount_minor` is the **median** of its samples, as an integer_,
  not the mean — a mean is dragged by one unusual month, and a median of an even count takes the
  lower of the two middle values deterministically so the suggestion is reproducible.
- _accepting a candidate writes no transaction_ — it writes a series, and the samples stay exactly as
  they are.

### Verification

- Command gate.
- `detect.test.ts`: a clean monthly series is detected with high confidence; a series with one skipped
  month is detected with lower confidence; two transactions are not enough; a mixed-currency group is
  not detected; the median case with an even sample count; a dismissed candidate does not reappear.
- Browser evidence: `/recurring/candidates` with **three candidates at different confidences**, both
  themes, at 360 / 1280 / 2560 px, plus a **candidate expanded to show its samples** and the **empty
  state**.
- `e2e/recurring-candidates.visual.spec.ts` runs axe on the route: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.
