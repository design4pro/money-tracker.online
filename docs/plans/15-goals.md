# 15 — Savings goals

## Area brief

A savings goal is a target amount, a currency, an optional target date, and the contributions that
count towards it. It is the smallest feature area in the product and it fills a real gap: without it
there is no answer to _"am I going to make it"_ except reading a balance.

Two accounts can be attached and they mean different things, which is the one modelling subtlety
here: `account_id` is **where contributions come from** and `linked_account_id` is **where the money
is held**. A goal may have either, both or neither, and the screen says which is which rather than
showing two account pickers with similar labels.

Contributions are **links to real transactions**, never their own amounts. A goal that stores its own
progress number is a second ledger, and a second ledger disagrees with the first.

---

## Stage 15-S1 — Goals and contributions

### Stage id

`15-S1` · Wave 3 · effort **M**.

### Reference rows

`GOAL-01 missing → done` — the goals repository with the two account roles.
`GOAL-02 missing → done` — contributions as transaction links, with automatic linking from the
funding account.
`GOAL-03 missing → done` — the goal list screen.

### Owned paths

- `src/server/repos/goals.ts` — new
- `src/server/goals/contributions.ts` — new
- `src/server/fns/goals.ts` — new
- `src/routes/_app/goals/index.tsx` — new
- `src/routes/_app/goals/-ui/goal-card.tsx` — new
- `src/routes/_app/goals/-ui/goal-form.tsx` — new
- `src/server/repos/__tests__/goals.test.ts` — new
- `e2e/goals.visual.spec.ts` — new

### Data and migration

`savings_goals` and `savings_goal_contributions` exist from `00-S7`. No schema change.

`savings_goals` carries `contributed_minor` as a **denormalised cache**, and the stage is explicit
about what that means: it is recomputed from `savings_goal_contributions` on every contribution write,
in the same batch, and a repair function recomputes it from scratch. It is never the authority — the
links are.

### Server (repo, server function, Zod)

- **Repository.** `goals.ts`: `listGoals`, `getGoal`, `createGoal`, `updateGoal`, `archiveGoal`,
  `deleteGoal`. `contributions.ts`: `listContributions(goalId)`, `addContribution({ goalId,
transactionId })`, `removeContribution`, `recomputeContributed(goalId)`.
- **`addContribution` refuses** a transaction whose currency differs from the goal's — netting across
  currencies would need a rate and a date the person did not choose, and the error names both
  currencies. It also refuses an expense when the goal is funded by income, and vice versa, with the
  direction rule stated in the message.
- **Automatic linking:** when a goal has an `account_id`, a transfer **into** its `linked_account_id`
  from that account is offered as a contribution on the goals screen — offered, not linked. Automatic
  linking without confirmation would silently reinterpret somebody's transfer.
- **Status.** `active | reached | archived`. `reached` is set **when a contribution brings
  `contributed_minor >= target_minor`**, in the same batch, and dispatches `goal.reached` through plan
  `21`'s dispatcher (the no-op-until-wave-5 arrangement of `12-S3`). It is not derived on read,
  because the moment matters and a derived status has no moment.
- **Zod.** `target_minor` is `z.number().int().positive()`; `target_date` is optional
  `z.iso.date()`.
- **Authorisation.** `requireOrg()`.
- **Ledger batching.** Contributions link existing transactions and change no amount. **No rebuild is
  enqueued**, stated explicitly.

### UI (route, components)

- **Route.** `/goals`, SSR default.
- **Components.** Reuses `Card`, `Meter`, `Dialog`, `MoneyField`, `DatePicker`, `Select`, `Badge`.
  New: `goal-card.tsx`, `goal-form.tsx`.
- **States.** Empty: _"No savings goals yet"_ with a one-line explanation and one action. Skeleton:
  three cards with the meter's space reserved. Error: `ErrorPanel` retryable; a goal whose progress
  failed to load shows `—`, never `0%`, which would read as "no progress".
- **Tokens.** None new. Progress uses the `success` family; a goal past its target date and unreached
  uses `warning`, **with a text state** beside it.
- **Accessibility.** The `Meter`'s `aria-valuetext` reads the amounts and the remaining amount, not
  only the percentage. The two account fields have **distinct visible labels and descriptions** —
  _"Funded from"_ and _"Held in"_ — because two similarly-labelled account pickers is the exact place
  a person makes a mistake they will not notice for months.

### Quota

`goals` is a metered metric. `createGoal` calls `assertWithinLimit(scope, 'goals', current + 1)`
**inside the repository, before the insert**. Archived and reached goals count; the copy says so, and
offers deletion as the way to free one.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: A attempts every goal write on B's ids, `createGoal` with B's
`account_id` and `linked_account_id`, and `addContribution` with B's `transactionId` onto A's goal.
Every one is a `NotFoundError`; B's goals keep their `contributed_minor`. Functions covered: all ten
exports.

### Money invariant

_Progress is the sum of linked transactions, and the cache is never the authority._ Cases in
`money-invariants.test.ts`:

- _`contributed_minor` always equals the integer sum of the goal's linked contributions_ — asserted
  after add, after remove, and after `recomputeContributed`, so the cache and the links can never
  drift silently.
- _a contribution and its goal share a currency_, and a cross-currency link is refused.
- _removing a contribution reduces `contributed_minor` by exactly that transaction's amount_, and
  clears `reached` if it drops below the target — a goal that stays "reached" after the money left is
  a lie the product tells once and is never trusted again.
- _editing a linked transaction's amount updates `contributed_minor`_ — `07-S1`'s update path calls
  `recomputeContributed` for every goal the transaction contributes to, in the same batch. This is a
  requirement recorded here and honoured there.
- _the goal's target and progress are in the goal's own currency_, with the base equivalent as
  secondary text, so a person saving in EUR sees EUR.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `goals.test.ts`: the five money cases, the direction refusal, `reached` set and cleared in the same
  batch, the quota call site, the isolation cases.
- Browser evidence: `/goals` with **one in progress, one reached and one past its target date**, both
  themes, at **360 / 1280 / 2560 px** — the three states are the point — plus the **empty state** and
  the form with **both account fields visible and labelled**.
- `e2e/goals.visual.spec.ts` runs axe on `/goals`: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 15-S2 — The goal detail screen and the projection

### Stage id

`15-S2` · Wave 3 · effort **M**.

### Reference rows

`GOAL-04 missing → done` — the goal detail screen with its contribution list.
`GOAL-05 missing → done` — the projected completion date.

### Owned paths

- `src/routes/_app/goals/$goalId.tsx` — new
- `src/routes/_app/goals/-ui/contribution-list.tsx` — new
- `src/routes/_app/goals/-ui/projection.tsx` — new
- `src/routes/_app/goals/-server/detail.ts` — new
- `src/server/goals/project.ts` — new
- `src/server/goals/__tests__/project.test.ts` — new
- `e2e/goal-detail.visual.spec.ts` — new

### Data and migration

None. The projection is computed, never stored — it changes with every contribution, and a stored
projection would be stale the moment it was written.

### Server (repo, server function, Zod)

- **`project.ts`** exports `projectCompletion({ goal, contributions, today })`, returning
  `{ kind: 'on_track' | 'behind' | 'insufficient_data' | 'reached', projectedDate?, monthlyRateMinor?
}`.
  - The rate is the **median monthly contribution over the last six months**, as an integer — a median
    for the same reason `13-S3` uses one, and six months because three is noise and twelve is stale.
  - **`insufficient_data` is a first-class result**, returned when there are fewer than three
    contribution months. Extrapolating from one contribution produces a confident, absurd date, and
    the screen must be able to say "not enough yet" rather than guess.
  - With no `target_date`, `kind` is `on_track` or `insufficient_data` only — you cannot be behind a
    deadline you do not have.
- **Server function.** `loadGoalDetail({ goalId })` (GET) returning the goal, its contributions, its
  projection and its progress series in one call.
- **Zod.** `z.strictObject({ goalId })`.
- **Authorisation.** `requireOrg()`.
- **Ledger batching.** Reads only.

### UI (route, components)

- **Route.** `/goals/$goalId`, SSR default.
- **Components.** Reuses `Card`, `Meter`, `data-table`, `Badge`, `Button`. The progress chart is plan
  `16`'s line primitive, rendered here. New: `contribution-list.tsx`, `projection.tsx`.
- **States.** Empty (no contributions): the projection panel shows the `insufficient_data` copy with
  what is needed — _"Add at least three months of contributions to see a projection"_ — rather than an
  empty chart. Skeleton: the header, the meter, six list rows. Error: `ErrorPanel` per section.
- **Tokens.** None new.
- **Accessibility.** The projection is a **sentence**, not a badge: _"At 500,00 zł a month, you reach
  20 000,00 zł in March 2028 — four months after your target date."_ The chart carries its
  visually-hidden data table from `00-S10`'s frame. The `behind` state is text plus colour, never
  colour alone.

### Quota

No new metric; the goal was counted at creation.

### Tenant isolation test

Added to `tenant-isolation.test.ts`: `loadGoalDetail` with B's `goalId`, in A's scope, is a
`NotFoundError` with no partial payload. Function covered: `loadGoalDetail`.

### Money invariant

_The projection is arithmetic over integers and never invents progress._ Cases in
`project.test.ts` and `money-invariants.test.ts`:

- _the monthly rate is an integer median of integer monthly sums_, deterministic for an even count.
- _`insufficient_data` is returned below three contribution months_, and no `projectedDate` is
  present in that result — the type makes reading one impossible.
- _a reached goal returns `reached` and no projection_, even if the rate would suggest a future date.
- _the projection never modifies `contributed_minor`_ — it is a pure function over values it is
  given, asserted by passing frozen objects.
- _a goal whose currency is not the base projects in its own currency_ and converts only for the
  secondary display line.

### Verification

- Command gate.
- `project.test.ts`: the five cases above, plus a goal with one very large contribution and five small
  ones (the median resists it), and a goal with a target date already passed.
- Browser evidence: `/goals/$id` for a goal that is **on track**, one that is **behind**, and one with
  **insufficient data**, both themes, at 360 / 1280 / 2560 px, plus the contribution list with ten
  rows.
- `e2e/goal-detail.visual.spec.ts` runs axe on the route: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

**A dependency on plan `16`** for the progress chart primitive. Plan `16` is wave 4 and this stage is
wave 3, so the detail screen ships with the contribution table and the projection sentence, and the
chart lands as an addition in `16-S3`'s consumer pass. The table is the accessible equivalent the
chart would need anyway, so nothing is lost by shipping in that order — stated here so the ordering
reads as a decision rather than an omission.
