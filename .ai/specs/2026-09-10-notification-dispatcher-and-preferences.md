# The notification dispatcher, the store and per-user preferences

| Field              | Value |
| ------------------ | ----- |
| **Status**         | draft |
| **Issue**          | #219  |
| **Spec PR**        | #220  |
| **Implementation** | none  |

## 📝 TLDR

Three shipped features — budget thresholds, recurring reminders and reached savings goals — already
compute their events correctly and then hand them to a no-op. This spec designs `21-S1`: one
vocabulary, one registry, the `notifications` and `notification_prefs` tables, the tenant-scoped
repository, the `notify()` dispatcher that is their only writer, and the adapters that finally
install the three seams. **One capability: events produced by three modules become durable,
deduplicated, per-member rows.** It ships no UI and no reader API (`21-S3`) and sends no email
(`21-S2`, #210) — the email leg leaves this stage as a named seam in the style of the three it
replaces. Four corrections to `docs/plans/21-notifications.md` land with it.

## 📝 Problem Statement

`docs/plans/21-notifications.md`'s Area brief states the failure mode plainly:

> a permanent no-op is a silent feature failure that nobody notices until a person asks why they
> never got their budget alert.

That is the tree today. Three modules expose a dispatcher seam of identical shape, each carrying the
same doc comment — _"What `21-S1` installs"_:

| Module                              | Type                          | Payload handed over                                    |
| ----------------------------------- | ----------------------------- | ------------------------------------------------------ |
| `src/server/budgets/thresholds.ts`  | `BudgetAlertDispatcher`       | `(scope, crossings: ReadonlyArray<ThresholdCrossing>)` |
| `src/server/recurring/reminders.ts` | `RecurringReminderDispatcher` | `(scope, reminders: ReadonlyArray<DueReminder>)`       |
| `src/server/goals/reached.ts`       | `GoalReachedDispatcher`       | `(scope, event: GoalReachedEvent)`                     |

Each defaults to a `NOOP_*` constant, each has `set*Dispatcher(next | null)`, each has an
`is*Installed()` predicate the cron logs. It logs `false`: `runBudgetThresholdSweep` and
`runRecurringReminderSweep` both report `dispatcherInstalled: false` on every run, and
`src/server/cron/__tests__/recurring.test.ts` asserts that `false` as the current truth.

So the arithmetic is right, the plumbing is right, the seams are tested on both sides — and the
person who crossed 80% of their grocery budget at 03:15 hears nothing, with no way to tell anything
was owed. There is no `src/server/notify/`, no `notifications` table, no `notification_prefs` table.

**Four claims in the plan do not survive contact with the tree.** All four change what gets built,
and step 11 corrects the plan for each:

1. **`notifyNoop` does not exist.** The Area brief says `21-S1` replaces it and the Verification asks
   for `expect(notify).not.toBe(notifyNoop)`. Five hits in the plan, zero in `src/`. The assertion
   has to be written against the three real `NOOP_*` constants.
2. **The registry names disagree with the exported constants.** The plan lists `budget.threshold` and
   `recurring.due`; the tree exports `budget.threshold_crossed`, and two separate constants
   `recurring.due_soon` and `recurring.overdue` — because a bill due in three days and a bill that
   was due last week are different sentences, which `dueReminders` documents at length.
3. **`workspace_id` is not a column here.** 74 occurrences of `organization_id` in
   `src/server/db/schema.ts`, zero of `workspace_id` anywhere under `src/`.
4. **The digest needs no marker column** — see **API Contracts**.

## 📝 Proposed Solution

One dispatcher, one store, preferences resolved per person and per kind. `notify()` is the only
module that writes `notifications`; everything else asks it to.

The shape is the one already proven three times here: a module-level seam with a named no-op
default, an installer, and an `is*Installed()` predicate, wired at isolate start by a
side-effect-only module the Worker entry imports — the pattern `src/server/billing/install.ts`
establishes beside `./ledger`. This spec adds `./notify/install` to that same line and one more seam
of identical shape for the email leg, so `21-S2` has a greppable, tested socket to land in.

**Alternatives considered.** _A generic event bus_ — rejected: three producers, one consumer, all
in-process, all typed; a bus buys indirection and loses the compile-time guarantee that a dispatched
kind is a registered kind. _Writing rows straight from each producing module_ — rejected: it puts
preference resolution and dedupe in three places, against `docs/SPEC.md` §8's one-owner-per-concept
rule. _Collapsing the three seams into one_ — rejected explicitly: their payload types are specific
(`ThresholdCrossing` carries `availableMinor`; `GoalReachedEvent` carries the transaction that
crossed the line), both sides are tested, and a union would replace typed payloads with something
nobody needs. `21-S1` implements _against_ the seams, as they are.

## 📝 Architecture

```
src/lib/enums.ts        — NOTIFICATION_KIND_IDS joins the other ~35 vocabularies (see below)
src/server/notify/
  kinds.ts      — the registry: payload schema, defaults, copy keys, deep link, digestible
  copy.ts       — notificationCopy(kind, payload) → { titleKey, bodyKey, params }; pure, no formatting
  dedupe.ts     — goalReachedDedupeKey(); the other two keys come from their producers
  email.ts      — the email seam (NOOP_EMAIL_ENQUEUER + installer + predicate); 21-S2 fills it
  dispatch.ts   — notify(): membership → prefs → dedupe → in-app row → email seam
  adapters.ts   — three functions translating the producers' payloads into notify() calls
  install.ts    — side-effect only; installs all four seams. Imported by src/server/worker.ts.
src/server/repos/notifications.ts   — tenant-scoped rows; the insert is the dispatcher's alone
```

**The vocabulary lives in `#/lib/enums`, not in the registry.** `src/server/db/schema.ts` generates a
SQL `CHECK` from a readonly tuple for every enumerated column, and every one of those ~35 tuples
comes from `#/lib/enums` — whose own header says why: _"Nothing in this file may import anything. It
is data."_ Putting the kind ids in `kinds.ts` and pointing `enumCheck` at them would make
`schema.ts` import `kinds.ts` → `#/server/budgets/thresholds` → `#/server/repos/budgets` →
`#/server/db/schema`, a cycle. So `NOTIFICATION_KIND_IDS` is declared in `#/lib/enums` beside its
peers; `schema.ts` and `kinds.ts` both read it.

The three producing modules keep their `*_EVENT` constants exactly as they are — this stage does not
edit them — and `kinds.test.ts` welds the two together: each producer's constant must be
`toBe`-identical to its `NOTIFICATION_KIND_IDS` entry. Drift becomes a test failure at the seam
rather than a silent mismatch at runtime.

**Import direction.** `adapters.ts` imports the producers' payload types and their marker-key
builders. Nothing under `src/server/budgets/**`, `src/server/recurring/**` or `src/server/goals/**`
imports anything from `src/server/notify/**` — the seams are how the dependency stays one-way, which
is the whole reason they exist.

**The registry is the type.** `NotificationKind` is the union from `NOTIFICATION_KIND_IDS`, `notify`'s
`kind` parameter is typed as it, and the payload type is inferred from that kind's Zod schema — so a
`budget.exceeded` payload cannot be passed as a `goal.reached` one, and an unregistered kind is a
compile error rather than a runtime branch.

**The recipient is not the scope's principal.** `listCronScopes` builds each cron scope from the
workspace **owner** — its doc comment says so: _"the cron acts on behalf of somebody who could have
performed the same writes by hand"_. A notification, by contrast, belongs to a person: the plan opens
with _"two members of a household get their own read state and their own preferences"_. So an adapter
**fans out** over `listMembers(scope)`. Writing one row for `scope.ctx.userId` would silently notify
only the owner, and in a two-person household that is half the product missing with nothing in the
logs.

**Fan-out is resolved once per workspace per tick, not per event.** The adapter reads the member list
and every member's stored preferences for the kinds in play **once**, then calls `notify` with the
resolution already in hand. The naive shape — three D1 round-trips per recipient-event — is 300
round-trips for a five-member household with twenty crossings, inside a single cron tick that also
sweeps every other workspace sequentially. See **Edge Cases** for what happens when the tick budget
is exceeded anyway.

**Failure isolation, and the one place it must not apply.** The plan requires that a dispatcher throw
never fail the business operation that triggered it, and `dispatchGoalReached` is awaited inside
`src/server/fns/goals.ts` after a contribution commits, so that rule is real. But
`sweepBudgetThresholds` documents the opposite requirement in the same words:

> Writing the marker before dispatch would turn a transient failure into a notification nobody ever
> gets, with no record that it was owed.

It awaits the dispatcher and only then writes the markers; `src/server/cron/recurring.ts` does the
same. If a cron adapter swallowed failures, the marker would be written for a crossing that was never
stored, and that crossing is gone for the rest of the period. Both rules hold at once because they
govern different callers:

- `notify()` **returns an outcome** — `'written' | 'deduped' | 'skipped' | 'failed'` — and never throws.
- The **request-path adapter** (goals) wraps its **entire body**, not merely the outcome, in a
  `try/catch` that logs and returns. The fan-out itself — `listMembers` — is a D1 read outside
  `notify`, and an unwrapped transient failure there would fail the `addContribution` response after
  the contribution had already committed.
- The **cron adapters** throw when any recipient came back `'failed'`. `runBudgetThresholdSweep` and
  `runRecurringReminderSweep` each already wrap a workspace in `try/catch`, count it in `failures` and log it
  with the `organizationId`, so the blast radius is one workspace's sweep, the markers stay unwritten
  and the next tick retries. Nothing new is needed for that to work.

## 📝 Data Model

Two additive tables in `src/server/db/schema.ts`, in sibling style (`id()`, `organizationId()`,
`createdAt()`, `updatedAt()`, `enumCheck`). Only the rows that carry a decision are listed; the
standard columns are the helpers named above. Workspace deletion is already handled — `organizationId()`
carries `onDelete: 'cascade'` — so only the `user_id` choice needs stating.

### `notifications`

| Column         | Decision                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_id`      | `references(() => user.id, { onDelete: 'cascade' })` — a notification with no recipient is unreadable by construction, and orphans would make the unread count a lie |
| `kind`         | `enumCheck` over `NOTIFICATION_KIND_IDS`                                                                                                                             |
| `payload_json` | the kind's Zod payload, serialised, carrying its own `v` — see **Payload versioning**                                                                                |
| `dedupe_key`   | the producer's key, never re-derived — see below                                                                                                                     |
| `read_at`      | ms, nullable; null means unread                                                                                                                                      |

- `unique(organization_id, user_id, dedupe_key)` — the dedupe guarantee.
- `index(organization_id, user_id, created_at desc)` — the list query `21-S3` runs.
- `index(organization_id, user_id, read_at)` — the unread count. Without it, a badge that renders on
  every screen scans the reader's whole history.

### `notification_prefs`

`user_id` and `kind` as above; `in_app`, `email`, `digest` as non-null booleans;
`unique(organization_id, user_id, kind)`. It carries `createdAt()` **and** `updatedAt()`, unlike the
plan's column list: "when did this person turn budget email off" is a question a support conversation
asks, and three booleans with no timestamps cannot answer it.

**Nothing writes this table in `21-S1`.** `setPref` moves to `21-S3` with the settings screen (Q7) and
no row is seeded (Q6), so the table ships read-only: `notify` resolves preferences from it and finds it
empty, which is exactly the defaults path. That is a consequence of two stated decisions rather than an
omission, and it is written here so a reader does not go looking for the writer.

**Rows are created lazily.** Absence means "use the kind's defaults"; nothing seeds a row for an
existing or a new member. A backfill of three booleans × five kinds × every member restates the
defaults and freezes today's values into every existing household the moment a default is revised.

### `dedupe_key` — the load-bearing column

The producers' keys are reused, never re-derived: `crossingMarkerKey`
(`budget:threshold:v1:{budgetId}:{periodStart}:{threshold}`) and `reminderMarkerKey`, both versioned
`v1` so that changing what an occasion means cannot silently inherit markers written under the old
rule. **`goal.reached` has no producer key** — `src/server/goals/reached.ts` exports none, and unlike
the two cron paths it has no marker store at all. This stage defines one, in `src/server/notify/dedupe.ts`:

```
goal:reached:v1:{goalId}
```

Keyed on the **goal**, not the transaction that crossed the line. A goal that is withdrawn from and
reaches its target again therefore notifies **once, ever**. That is the same call `thresholds.ts`
rule 3 already makes for a refund that drops spend back under a threshold — re-arming means
notifying somebody twice about one occasion — and it is recorded here as a decision rather than an
accident of key choice.

The `unique` is scoped to `(organization_id, user_id, …)`, so two households can hold the same key,
and two members of one household each get their own row for one occasion.

### Payload versioning

Every payload schema carries `v: z.literal(1)`. Stored rows are read back and parsed against a
registry that will evolve, and `BACKWARD_COMPATIBILITY.md` treats the analogous case — stored import
presets — as requiring an additive migration rather than a shrug. The policy, one sentence:
**payload schemas widen only; a narrowing is a new kind id**, exactly as the marker keys are
versioned. The Edge Cases table's "skip and log" is then the response to a genuine bug, not the
migration strategy.

### Sensitive data

`payload_json` holds ids, integer minor units, currency codes — and **user-authored free text**:
`budgetName`, `seriesName`, the goal's `name`. "Therapy", "Alimony to Anna" and "Divorce lawyer" are
ordinary series names. That text is already stored in its own table and readable by every member of
the workspace, so duplicating it into a notification row grants no new access — but it does copy it
into a second place, and at `21-S2` into an email body leaving the platform. No email address, no
token and no payload content reaches a log: failures log the kind and the `organizationId` only.

**Retention is deferred, deliberately.** `notifications` rows accumulate with no purge. That is a
data-minimisation gap, not an oversight: a purge policy needs a retention period the product has not
chosen, and `21-S3` is the stage that learns what a reader expects to still be able to see. Filed as
a follow-up rather than guessed at here.

## 📝 API Contracts

### `notify(scope, args)` — `src/server/notify/dispatch.ts`

```ts
export type NotifyOutcome = 'written' | 'deduped' | 'skipped' | 'failed'

export function notify<K extends NotificationKind>(
  scope: TenantScope,
  args: {
    readonly userId: string
    readonly kind: K
    readonly payload: NotificationPayload<K>
    readonly dedupeKey: string
    /** Producer-level opt-out for the email leg only. Never widens a preference. */
    readonly suppressEmail?: boolean
  },
): Promise<NotifyOutcome>
```

Order of operations:

1. **Membership check.** A `userId` who is not a member of `scope.ctx.organizationId` returns
   `'skipped'` and logs. Never an orphan row addressed to somebody who cannot see it.
2. **Preference resolution.** The stored row for `(organization, user, kind)` if there is one, else
   the kind's `defaults`.
3. **The row is written whenever any channel is enabled** — `inApp` **or** `email` **or** `digest` —
   through the repository's insert. A unique violation on `dedupe_key` returns `'deduped'` — the
   expected path, caught by constraint name rather than by message text, and not logged as an error.
   Only when all three are off is nothing written, and that is the `'skipped'` case.
4. **Email**, when `email` is enabled **and** `suppressEmail` is not set **and** the kind is
   `immediate`, handed to the email seam with the id of the row step 3 wrote.
5. **Every step is wrapped.** A throw becomes `'failed'` plus one `logger.error` carrying the kind and
   the `organizationId`. `notify` itself never throws.

**`in_app` governs the bell, not the row.** The three preference booleans are independent, so
`in_app: false, email: true` — "mail me, do not clutter the bell" — is reachable the moment `21-S3`
ships `setPref`, and the row has to be written on that path for two reasons that have nothing to do
with the reader. The row **is** the dedupe record: the guarantee lives in the unique index on
`(organization_id, user_id, dedupe_key)`, so a stage that skipped the insert would leave the email leg
with no dedupe at all, and a cron retry would mail the same occasion twice. The row is also what
`21-S2`'s digest selects, so `in_app: false, digest: true` would otherwise be a preference combination
that silently delivers nothing. Writing it unconditionally keeps one record of one occasion; `21-S3`
filters on `in_app` when it renders the list and the unread count. `notificationId` therefore always
names a real row, which is what lets the email seam's signature take a non-nullable `string`.

`suppressEmail` exists for exactly one caller. A recurring series carries its own `notifyEmail` flag
(`DueReminder.notifyEmail`), which says whether _this series_ wants reminders at all — a different
question from whether _this person_ wants `recurring.*` by email. Both must be true, so the two
compose as an AND. It is a one-way lever: `suppressEmail: true` can only turn the email leg off, never
on, so a preference can never be widened by a producer.

**"Marks it for the digest" needs no column.** The plan's wording implies state; the design needs
none. A digestible notification _is_ its in-app row: `21-S2`'s nightly digest selects rows whose kind
is digestible, whose `read_at` is null and whose `created_at` falls in the window. A `digest_pending`
flag would be a second record of the same fact, and the two drift the first time a row is read
between the write and the sweep.

### The email seam — `src/server/notify/email.ts`

```ts
export type NotificationEmailEnqueuer = (
  scope: TenantScope,
  args: {
    readonly userId: string
    readonly notificationId: string
    readonly kind: NotificationKind
    readonly payload: unknown
  },
) => Promise<void>

export const NOOP_EMAIL_ENQUEUER: NotificationEmailEnqueuer = async () => {}
export function setNotificationEmailEnqueuer(
  next: NotificationEmailEnqueuer | null,
): void
export function isNotificationEmailEnqueuerInstalled(): boolean
```

Identical in shape to the three seams it sits beside, for the same reason: "nothing is being sent
yet" stays greppable. `21-S2` (#210) installs the real enqueuer, which is where `notify.email` joins
`taskMessageSchema`.

### The registry — `src/server/notify/kinds.ts`

Five entries, one per producer the tree actually has:

| Kind                       | Payload (beyond `v`)                                                                          | in-app / email / digest | Class      |
| -------------------------- | --------------------------------------------------------------------------------------------- | ----------------------- | ---------- |
| `budget.threshold_crossed` | `budgetId, budgetName, periodStart, threshold, spentMinor, availableMinor, currencyCode`      | on / on / on            | digestible |
| `budget.exceeded`          | the above plus `overspentMinor`                                                               | on / on / off           | immediate  |
| `recurring.due_soon`       | `seriesId, seriesName, periodStart, dueOn, expectedAmountMinor, expectedCurrencyCode, offset` | on / on / on            | digestible |
| `recurring.overdue`        | the above                                                                                     | on / on / off           | immediate  |
| `goal.reached`             | `goalId, name, targetMinor, contributedMinor, currencyCode, transactionId`                    | on / on / on            | digestible |

Each entry also carries its two copy keys and its deep link (`/budgets/$budgetId`,
`/recurring/$seriesId`, `/goals/$goalId`).

`overspentMinor` reuses the name and the meaning `src/server/budgets/utilisation.ts` already ships —
_"`spent − available` when that is positive, else zero. The magnitude, for 'over by X'"_. The adapter
computes it with `subtractMinor` from `#/lib/money`, never with a bare `-`: it is a positive magnitude
with a sign-bearing name, and inventing a second name for an existing concept is how two fields end
up disagreeing. It is carried rather than recomputed at render time for the reason
`src/server/goals/reached.ts` already gives about its own amounts — re-reading the budget later
prints a different sentence about a different moment.

### `notificationCopy(kind, payload)` — `src/server/notify/copy.ts`

Returns `{ titleKey, bodyKey, params }`. **Pure, and it formats nothing**: `params` carries integers,
currency codes and ISO dates, exactly as stored. Rendering — turning those into a locale's string —
belongs to the reader, and the reader is `21-S3`. The function exists here because it is what makes
the copy keys and the payload-to-placeholder mapping testable in a stage that has no component.

## 📝 UI/UX

**None in this stage.** The bell, `/notifications` and `/settings/notifications` are `21-S3`, and
`21-S1`'s Definition of done carries `docs/SPEC.md` §2's visual clauses forward to that stage
explicitly.

**The reader API moves to `21-S3` as well** — see **Resolved assumptions**, Q7. `listNotifications`,
`countUnread`, `markRead`, `getPrefs` and `setPref` have no consumer until the bell and the settings
screen exist, and shipping five server functions with no caller is a second capability wearing this
one's clothes. `src/server/repos/notifications.ts` still exposes the reads they will need (paginated
via `pageInputSchema` / `MAX_PAGE_SIZE = 100` from `src/server/repos/pagination.ts`), because the
repository is what `21-S2`'s digest queries.

## 📝 Visual change expected

**None.** No route, component or style file changes. Nothing in CI compares a pixel (ADR 0016), so
this line is the only notice a reviewer gets — and here it is a true negative: the diff contains no
file under `src/routes/`, `src/components/` or `src/styles/`.

## 📝 Copy

Two keys per kind, landing in `src/lib/i18n/messages/en.ts` **and** `pl.ts` in the same change (skill
`i18n-messages`). The `notifications.*` namespace already exists — `notifications.title`,
`notifications.markAllRead`, `notifications.empty.*`, `notifications.unread`, `notifications.badge` —
so these land under `notifications.kind.*` beside it, not as a new namespace.

Household words, not accountancy — the catalogue's own rule. Amounts and dates arrive as placeholders
and are formatted by the reader at render time; **no key contains a pre-formatted amount**, which is
what lets a Polish member of an English-preferring household read their own formatting off the same
stored row.

| Key                                               | `en`                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `notifications.kind.budgetThresholdCrossed.title` | `{budget} is at {threshold}%`                                      |
| `notifications.kind.budgetThresholdCrossed.body`  | `You have spent {spent} of {available} in {budget} this period.`   |
| `notifications.kind.budgetExceeded.title`         | `{budget} is spent`                                                |
| `notifications.kind.budgetExceeded.body`          | `You are {overspent} over the {available} you set for {budget}.`   |
| `notifications.kind.recurringDueSoon.title`       | `{series} is due {date}`                                           |
| `notifications.kind.recurringDueSoon.body`        | `{amount} for {series} is due on {date}.`                          |
| `notifications.kind.recurringOverdue.title`       | `{series} was due {date}`                                          |
| `notifications.kind.recurringOverdue.body`        | `{amount} for {series} was due on {date} and is not recorded yet.` |
| `notifications.kind.goalReached.title`            | `You reached {goal}`                                               |
| `notifications.kind.goalReached.body`             | `{goal} is complete — you put aside {contributed} of {target}.`    |

The Polish column is written in the same change and is not a transliteration; `docs/I18N.md` and the
`i18n-messages` skill own how it is phrased. None of the ten needs plural branches — every count in
them is an amount or a date, both formatted rather than counted.

**These keys become a protected surface the moment the first row is written.**
`BACKWARD_COMPATIBILITY.md` → Message catalogue: notification rows store keys and parameters, so a
key a stored row references cannot be removed or renamed, and a placeholder rename is a new key.

## 📝 Edge Cases & Failure Scenarios

| Scenario                                                           | Behaviour                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The budget cron re-evaluates a crossed threshold every 15 minutes  | `findCrossings` already skips a crossing whose marker was remembered, so in normal operation there is one dispatch, not 96. The unique index earns its place on the **retry** path: a sweep that failed after writing rows but before writing markers re-dispatches, and the index makes that a no-op.                                                                      |
| A refund brings spend back under a threshold in the same period    | The marker stays and the notification stays. Re-arming means notifying somebody twice about one overspend — `thresholds.ts` rule 3.                                                                                                                                                                                                                                         |
| A goal is withdrawn from and reaches its target again              | Nothing. The dedupe key is the goal, not the crossing transaction — a stated decision, not an accident.                                                                                                                                                                                                                                                                     |
| Two households cross the same threshold                            | Both get rows: the unique index is scoped, so keys cannot collide across `organization_id`.                                                                                                                                                                                                                                                                                 |
| Two members of one household, one crossing                         | Two rows, one per member, each with its own `read_at` and its own preference resolution.                                                                                                                                                                                                                                                                                    |
| A member has `in_app: false`, `email: false` and `digest: false`   | Nothing written, `'skipped'`. A row nobody asked for is not a safe default; the person turned every channel off.                                                                                                                                                                                                                                                            |
| A member has `in_app: false` but `email` or `digest` on            | The row is written anyway and `'written'` is returned: it is the dedupe record and the digest's source. `21-S3` filters it out of the bell and the unread count. See **API Contracts**.                                                                                                                                                                                     |
| The recipient is not a member of the scope's workspace             | Nothing written, `'skipped'`, one log line. Never an orphan row.                                                                                                                                                                                                                                                                                                            |
| `listMembers` throws inside the request path (a goal contribution) | The adapter's whole body is wrapped, so the contribution stays committed and the response succeeds. One log line; the notification is lost, which is the correct trade at that seam.                                                                                                                                                                                        |
| The notification write throws inside a cron sweep                  | The adapter throws, the sweep does not reach the marker writes, the cron wrapper counts one `failures` and logs the `organizationId`, and the next tick retries the occasion.                                                                                                                                                                                               |
| The sweep exceeds the cron tick's CPU or D1 subrequest budget      | The tick dies mid-workspace. Workspaces already swept keep their markers; the rest are untouched and swept on the next tick — the sequential loop plus marker-after-dispatch makes a partial tick safe by construction. The per-workspace resolution of members and preferences is what keeps the round-trip count linear in recipients rather than in recipients × events. |
| A member is deleted, or a workspace is deleted                     | Rows cascade away with the `user` row and with `organizationId()`'s own cascade.                                                                                                                                                                                                                                                                                            |
| A kind is dispatched that the registry does not know               | Impossible: `notify`'s `kind` parameter is the vocabulary's union type. A compile error, not a runtime branch.                                                                                                                                                                                                                                                              |
| The email seam is not installed (the state on merge)               | `notify` still writes the in-app row and returns `'written'`. `isNotificationEmailEnqueuerInstalled()` returns `false`, which keeps the remaining gap visible in production the way the three current ones are.                                                                                                                                                             |
| `payload_json` fails to parse when read back                       | The row is skipped in the list and logged with its kind and id. This is the response to a bug — the widen-only policy under **Payload versioning** is what stops it being routine.                                                                                                                                                                                          |
| The migration is applied and the deploy is then rolled back        | The two tables are left behind, read by nothing. `db:generate` output is additive and forward-only; see **Risks** for what the rollback does and does not undo.                                                                                                                                                                                                             |

## 📝 Risks & Impact Review

**Blast radius.** New tables, a new module tree, one new import in `src/server/worker.ts`, and the
first behaviour change in three shipped features. That last one is the real risk and is what
`risk-high` is about.

**`BACKWARD_COMPATIBILITY.md` surfaces touched.**

- **D1 schema** — two new tables. Additive: nothing dropped, renamed, narrowed or made required, and
  no constraint an existing row violates. **`AGENTS.md` → Ask First covers a schema migration; the
  maintainer approved this one on #210 before the spec was written** — a reviewer should confirm it
  at https://github.com/design4pro/money-tracker.online/issues/210#issuecomment-5623757024 rather
  than take this sentence on trust.
- **Tenant scope** — the new repository takes `TenantScope` first and its predicate is not removable
  by a caller (ADR 0002).
- **Message catalogue** — the ten keys above become referenced by stored rows on the first write.

**Existing tests that change — and it is fewer than it looks.** No assertion in either cron suite
changes, and no assertion anywhere is narrowed. `install.ts` is side-effect-only and reached through
`src/server/worker.ts`, which neither cron suite imports, so `dispatcherInstalled` stays `false` in
those graphs and both suites pass untouched; only the stale comment at
`src/server/cron/__tests__/recurring.test.ts` is reworded to say why. The `NOOP_*` default assertions in
`thresholds.test.ts` and its siblings **stay exactly as they are**: they test each module's default
before installation, which is still the default. `AGENTS.md` → Ask First covers narrowing a test; none
is narrowed, none is deleted, and the only new suite is `install.test.ts`, which asserts the four
predicates are `true` inside its own `vi.resetModules()` graph.

**Rollback, in three parts.**

1. **Partial, and it is the first thing to reach for.** Deleting the one
   `import './notify/install'` line from `src/server/worker.ts` disables all dispatch: the three
   seams fall back to their `NOOP_*` defaults, which is the failure mode they were designed for. The
   store stays readable and the tables stay.
2. **KV markers are not reverted, and a `git revert` does not touch them.** `sweepBudgetThresholds`
   and the recurring cron write markers **after** a successful dispatch, and `crossingMarkerKey`'s
   own doc calls the key _"the only record that a notification was sent"_. Markers written during a
   bad deploy therefore permanently suppress those occasions for the rest of the period. An operator
   rolling back mid-period must clear the `budget:threshold:v1:*` and the reminder key prefixes for
   the affected period, or accept that those crossings are silent until the period turns over.
3. **Rows already written are retained deliberately**, not cleaned up. They are correct rows about
   real occasions; they will surface in `21-S3`'s unread badge when it ships, which is the intended
   outcome rather than a leak from a rolled-back deploy.

**Deploy order.** Irrelevant here — nothing is enqueued, so there is no in-flight message shape.
`21-S2` is where the consumer-first rule starts to matter.

**What this stage cannot prove.** That anybody receives anything. Until `21-S2`, "delivered" means "a
row exists in `notifications`". `isNotificationEmailEnqueuerInstalled()` is what keeps that gap
honest rather than assumed, and it is why the email seam is built here rather than left as a `TODO`.

## 📝 Resolved assumptions (autonomous defaults)

Written under `--autonomous`; every one is reversible and here to be overridden before merge. Each
resolution is argued in the section named beside it.

| #   | Question                                                                      | Resolution                                                                                                                                                                                                             | See                  |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Q1  | Plan's registry names or the tree's exported constants?                       | The tree's constants; the plan is corrected in the same PR                                                                                                                                                             | Problem Statement, 2 |
| Q2  | Register all fifteen kinds the plan lists, or only those with a producer?     | **Only the five with a producer.** Ten entries with no caller, no test and no copy are speculative surface; the registry is designed so adding one later is one entry plus two keys, as the plan itself says           | —                    |
| Q3  | `workspace_id` or `organization_id`?                                          | `organization_id`, via the `organizationId()` helper                                                                                                                                                                   | Problem Statement, 3 |
| Q4  | How does `notify` "enqueue an email" before `21-S2`?                          | A named seam of the same shape as the three it sits beside                                                                                                                                                             | API Contracts        |
| Q5  | How does `notify` "mark for the digest"?                                      | No new state; the in-app row is the mark                                                                                                                                                                               | API Contracts        |
| Q6  | Are preference rows seeded for existing members?                              | No — lazily created; absence means defaults                                                                                                                                                                            | Data Model           |
| Q7  | Do the reader/preferences server functions ship here or with `21-S3`?         | **`21-S3`.** They have no consumer this stage, and the spec's own phasing showed them as a separately shippable unit — which is the definition of a second capability. The plan's Owned paths move with them (step 11) | UI/UX                |
| Q8  | Who receives a notification when the cron principal is the owner?             | Fan out to every member, resolved once per workspace per tick                                                                                                                                                          | Architecture         |
| Q9  | `notify` never throws, but the sweeps need a failure to stop the marker write | Both: an outcome return; cron adapters throw on `'failed'`, the request-path adapter wraps its whole body                                                                                                              | Architecture         |
| Q10 | Series `notifyEmail` flag or the per-kind preference?                         | Both, as an AND, via a one-way `suppressEmail` argument that can never widen a preference                                                                                                                              | API Contracts        |
| Q11 | `goal.reached` has no producer dedupe key — what is it?                       | `goal:reached:v1:{goalId}`; a re-reached goal notifies once, ever                                                                                                                                                      | Data Model           |
| Q12 | Is the in-app row written when `in_app` is off but `email` or `digest` is on? | **Yes — the row is written whenever any channel is on.** It is the dedupe record and the digest's source; skipping it would leave the email leg undeduplicated and make `in_app: false, digest: true` deliver nothing  | API Contracts        |

None carries `⚠ NEEDS HUMAN CONFIRMATION`: each is a code-level choice reversible in a follow-up, and
none weakens tenant scoping, the money rules or a `BACKWARD_COMPATIBILITY.md` surface. The one
decision that would have — the additive migration — was taken by the maintainer on #210 before this
spec was written.

## 📋 Phasing

Three phases, each independently shippable, each leaving the gate green, at most one migration per
phase (`docs/SPEC.md` §8).

- **Phase 1 — The store.** Vocabulary, registry, migration, repository, tenant-isolation cases.
  Nothing dispatches; the seams stay no-ops and the crons keep reporting `false`.
- **Phase 2 — The dispatcher.** `notify()`, the email seam, dedupe, copy, money invariants. Still
  nothing installed: `notify` is exported, tested and unused in production.
- **Phase 3 — Installation.** The three adapters, `install.ts`, the Worker import, the plan
  corrections. This is the phase that flips `dispatcherInstalled` to `true`, and it is where a
  reviewer should spend their attention.

## 📋 Implementation Plan

### Phase 1 — The store

1. **Add the vocabulary.** `NOTIFICATION_KIND_IDS` in `src/lib/enums.ts` beside its ~35 peers, as a
   readonly tuple plus its union type. Nothing else moves; the three producers keep their `*_EVENT`
   constants untouched.
   _Verify:_ `kinds.test.ts` asserts each producer's exported constant is `toBe`-identical to its
   entry, so a rename on either side fails at the seam.
2. **Write the registry.** `src/server/notify/kinds.ts`: five entries with a Zod `payload` schema
   (each carrying `v: z.literal(1)`), `defaults`, `titleKey`, `bodyKey`, `deepLink`, `digestible`.
   Export `NOTIFICATION_KINDS` and the `NotificationPayload<K>` helper.
   _Verify:_ every entry's `titleKey`/`bodyKey` resolves in the EN catalogue; every entry's id is in
   `NOTIFICATION_KIND_IDS` and vice versa.
3. **Add the two tables** to `src/server/db/schema.ts` in sibling style, with the unique indexes, the
   `read_at` index and `enumCheck` over `NOTIFICATION_KIND_IDS`, then `pnpm db:generate`.
   _Verify:_ `pnpm db:generate < /dev/null && git diff --exit-code -- drizzle/` is clean on a second
   run; `drizzle/` is not hand-edited.
4. **Write the repository.** `src/server/repos/notifications.ts`, `TenantScope` first, inputs
   Zod-parsed a second time, list paginated through `pageInputSchema`. The row insert is exported
   only for the dispatcher and documented as such.
   _Tenant-isolation cases_ (in `src/server/repos/__tests__/tenant-isolation.test.ts`): A's member
   cannot list, read or mark B's notifications; the scoped unique index lets two workspaces hold the
   same `dedupe_key`.

### Phase 2 — The dispatcher

5. **Write the email seam.** `src/server/notify/email.ts` — type, `NOOP_EMAIL_ENQUEUER`, installer,
   predicate.
   _Verify:_ the default is the no-op; `null` restores it; an installed enqueuer receives what
   `notify` hands it.
6. **Write the goal dedupe key.** `src/server/notify/dedupe.ts` — `goalReachedDedupeKey({ goalId })`.
   _Verify:_ two `goal.reached` events for one goal produce one key; two goals produce two.
7. **Write `notify()`.** `src/server/notify/dispatch.ts`, in the order under **API Contracts**,
   including `suppressEmail`. The unique-violation path is caught by constraint and returns
   `'deduped'`.
   _Verify:_ `dispatch.test.ts` — the same occasion dispatched 100 times leaves one row; the
   non-member case writes nothing and logs; preference resolution with and without a stored row; a
   throwing email seam still leaves the in-app row written and returns `'written'`; `suppressEmail`
   suppresses the email leg and cannot enable it when the preference is off.
   _Tenant-isolation case:_ `notify` with a non-member `userId` writes nothing.
8. **Write `notificationCopy()`** and add the ten keys to `en.ts` and `pl.ts` in the same commit
   (skill `i18n-messages`).
   _Verify:_ the catalogue parity test; `notificationCopy` returns every placeholder each message
   declares, and `params` contains no pre-formatted string.
9. **Money invariants.** _Cases in `dispatch.test.ts`, with the write-path case in
   `src/server/repos/__tests__/money-invariants.test.ts`:_ `payload_json` stores `amountMinor` and a
   currency **code**, never a formatted string; `budget.exceeded` carries `overspentMinor` as a
   positive magnitude computed with `subtractMinor`, asserted against `12-S3`'s own fixture;
   `notificationCopy`'s `params` for one row are byte-identical regardless of locale, which is the
   property that proves no formatting leaked into the store; a zero-decimal currency's payload is an
   integer at `currencies.digits` scale and never a hard-coded 2 (`docs/MONEY.md`). _The `en` vs `pl`
   rendered-string case moves to `21-S3` with the renderer — nothing in this stage renders._

### Phase 3 — Installation

10. **Write the adapters.** `src/server/notify/adapters.ts`: one per seam. Each resolves
    `listMembers(scope)` and the members' preferences once, then calls `notify` per recipient, reusing
    the producer's dedupe key. The recurring adapter passes the series' `notifyEmail` through **negated** —
    `suppressEmail: !reminder.notifyEmail` — because the two flags carry opposite polarity:
    `DueReminder.notifyEmail` is _"whether the workspace asked for this one by email"_, and
    `suppressEmail` is the one-way off switch. Passing it through unnegated inverts both sides.
    The goals adapter wraps its **entire body**; the two cron adapters throw on any `'failed'`.
    _Verify:_ `adapters.test.ts` — a two-member household gets two rows for one crossing; a cron
    adapter throws when a recipient fails; the goals adapter does not, even when `listMembers` itself
    throws; the member and preference reads happen once for a multi-event batch. **A polarity case:**
    a series with `notifyEmail: true` reaches `notify` with `suppressEmail: false` and one with
    `notifyEmail: false` with `suppressEmail: true` — the assertion that catches the inversion, which
    step 7's `notify`-level case cannot see.
11. **Install.** `src/server/notify/install.ts` (side-effect only, in the style of
    `src/server/billing/install.ts`) plus one `import './notify/install'` in `src/server/worker.ts`
    beside `./ledger` and `./billing/install`.
    _Verify:_ a dedicated `install.test.ts` using `vi.resetModules()`, with `set*Dispatcher(null)` in
    `afterEach`, asserts the four `is*Installed()` predicates return `true` after the import. The
    isolation is not optional: the neighbouring suites assert the `NOOP_*` defaults are still the
    defaults, and a shared module graph would make those two facts fight.
    **The two cron suites are not edited, and the reason is the same isolation.** `install.ts` is
    side-effect-only and reached through `src/server/worker.ts`; neither cron suite imports the Worker
    entry, so neither observes an installed dispatcher and both keep reporting `false` after this stage.
    `budget-thresholds.test.ts` must not be touched at all — it is not a snapshot of today's truth but a
    test of the predicate itself, asserting `false`, installing a dispatcher, asserting `true`, restoring
    `NOOP_ALERT_DISPATCHER` and asserting `false` again; flipping its assertions breaks it, and
    `AGENTS.md` → Ask First gates that edit. In `recurring.test.ts` only the **comment** above the
    assertion changes — "Plan 21 has not landed" becomes the accurate reason, that an isolated module
    graph installs nothing — while the `false` it explains stays exactly as it is.
    _Verify:_ both cron suites pass unmodified except for that comment.
12. **Correct the plan.** `docs/plans/21-notifications.md`: replace the `notifyNoop` references in the
    Area brief and in `21-S1`'s Verification with the three real `NOOP_*` constants; correct the
    registry kind names to the exported constants; correct `workspace_id` to `organization_id` in
    `21-S1`'s **Data and migration**; note that the digest needs no marker column; move
    `src/server/fns/notifications.ts` from `21-S1`'s **Owned paths** to `21-S3`'s. Also correct the
    doc comment in `src/server/budgets/thresholds.ts` that calls the marker key _"the only record
    that a notification was sent"_ — after this stage the `notifications` row is, and that comment is
    what a future reader will trust.
    _Verify:_ `rg 'notifyNoop' docs/plans/21-notifications.md` returns nothing;
    `rg "budget\.threshold'|recurring\.due'" docs/plans/21-notifications.md` returns nothing;
    `rg 'only record that a notification was sent' src/` returns nothing. **`workspace_id` is checked
    against `21-S1` only** — `awk '/^## Stage 21-S2/{exit} /workspace_id/{print}' docs/plans/21-notifications.md`
    returns nothing. The unscoped grep cannot pass: `21-S2`'s `email_deliveries` requisition names
    `workspace_id` too, and correcting another stage's table is not this stage's business — `21-S2`
    fixes its own when it is built.
13. **Run the full gate** (`AGENTS.md` → Validation Commands), then update this spec's `Status` and
    `Implementation` fields and re-run `pnpm generate-spec-index`.

### Follow-ups this stage deliberately does not do

- **Retention/purge for `notifications`** — needs a retention period the product has not chosen;
  `21-S3` learns what a reader expects to still see. File an issue when this merges.
- **The reader API** (`listNotifications`, `countUnread`, `markRead`, `getPrefs`, `setPref`) — moves
  to `21-S3` with the surfaces that call it (Q7).
