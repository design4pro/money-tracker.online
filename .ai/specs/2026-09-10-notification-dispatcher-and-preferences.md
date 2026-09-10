# The notification dispatcher, the store and per-user preferences

| Field              | Value |
| ------------------ | ----- |
| **Status**         | draft |
| **Issue**          | #219  |
| **Spec PR**        | none  |
| **Implementation** | none  |

## 📝 TLDR

Three shipped features — budget thresholds, recurring reminders and reached savings goals — already
compute their events correctly and then hand them to a no-op. This spec designs `21-S1`: the kind
registry, the `notifications` and `notification_prefs` tables, the tenant-scoped repository, the
`notify()` dispatcher that is their only writer, the server functions behind reading and preference
writes, and the adapters that finally install the three seams. It ships no UI (`21-S3`) and sends no
email (`21-S2`, #210) — the email leg leaves this stage as a named seam in exactly the style of the
three it replaces. Two corrections to `docs/plans/21-notifications.md` land with it: `notifyNoop`
does not exist, and the plan's kind ids disagree with the event constants the tree already exports.

## 📝 Problem Statement

`docs/plans/21-notifications.md`'s Area brief states the failure mode plainly:

> a permanent no-op is a silent feature failure that nobody notices until a person asks why they
> never got their budget alert.

That is the state of the tree today. Three modules expose a dispatcher seam, each with the identical
shape and each carrying the same doc comment — _"What `21-S1` installs"_:

| Module                              | Type                          | Payload handed over                                    |
| ----------------------------------- | ----------------------------- | ------------------------------------------------------ |
| `src/server/budgets/thresholds.ts`  | `BudgetAlertDispatcher`       | `(scope, crossings: ReadonlyArray<ThresholdCrossing>)` |
| `src/server/recurring/reminders.ts` | `RecurringReminderDispatcher` | `(scope, reminders: ReadonlyArray<DueReminder>)`       |
| `src/server/goals/reached.ts`       | `GoalReachedDispatcher`       | `(scope, event: GoalReachedEvent)`                     |

Each defaults to a `NOOP_*` constant, each has a `set*Dispatcher(next | null)` installer, and each
has an `is*Installed()` predicate the cron logs so the gap is visible in production. It is visible:
`runBudgetThresholdSweep` reports `dispatcherInstalled: false` on every run, and
`src/server/cron/__tests__/recurring.test.ts` asserts that `false` as the current truth.

So the arithmetic is right, the plumbing is right, the seams are tested on both sides — and the
person who crossed 80% of their grocery budget at 03:15 hears nothing, with no way to tell that
anything was owed to them. There is no `src/server/notify/` directory, no `notifications` table and
no `notification_prefs` table.

Two claims in the plan do not survive contact with the tree, and both change what gets built:

1. **`notifyNoop` does not exist.** The Area brief says `21-S1` replaces it and its Verification
   asks for `expect(notify).not.toBe(notifyNoop)`. There is no such symbol anywhere in `src/`. The
   assertion has to be written against the three real `NOOP_*` constants instead.
2. **The registry names disagree with the exported constants.** The plan lists `budget.threshold`
   and `recurring.due`; the tree exports `BUDGET_THRESHOLD_EVENT = 'budget.threshold_crossed'`, and
   two separate constants `RECURRING_DUE_SOON_EVENT = 'recurring.due_soon'` and
   `RECURRING_OVERDUE_EVENT = 'recurring.overdue'` — because a bill due in three days and a bill
   that was due last week are different sentences, which `dueReminders` documents at length.

## 📝 Proposed Solution

One dispatcher, one store, preferences resolved per person and per kind. `notify()` is the only
module that writes `notifications`; everything else asks it to.

The shape is deliberately the one already proven three times in this repository: a module-level
seam with a named no-op default, an installer, and an `is*Installed()` predicate, wired at isolate
start by a side-effect-only module the Worker entry imports — the pattern
`src/server/billing/install.ts` establishes beside `./ledger`. This spec adds `./notify/install` to
that same line in `src/server/worker.ts` and adds one more seam of the identical shape for the email
leg, so `21-S2` has a greppable, tested place to land.

**Alternatives considered.**

- _A generic event bus._ Rejected: three producers, one consumer, all in-process, all typed. A bus
  buys indirection and loses the compile-time guarantee that a dispatched kind is a registered kind.
- _Writing notification rows straight from each producing module._ Rejected: it puts preference
  resolution and dedupe in three places, and `docs/SPEC.md` §8 wants one owner module per concept.
- _Rewriting the three seams into one._ Rejected explicitly. Their payload types are specific
  (`ThresholdCrossing` carries `availableMinor`; `GoalReachedEvent` carries the transaction that
  crossed the line), they are covered by tests on both sides, and collapsing them would replace
  typed payloads with a union nobody needs. `21-S1` implements _against_ the seams, as they are.

**Research — what mature open-source products do here.** Discourse, GitLab and Zulip all converge on
the same three properties, and this design takes all three: a **registry of notification types** with
per-type defaults rather than a hard-coded switch (Discourse's `Notification.types`); **per-user,
per-type channel preferences with lazily-created rows** and defaults inherited from the type when no
row exists (GitLab's notification settings, Zulip's per-stream settings); and a **deduplication key
distinct from the row id** so a repeatedly-evaluated condition cannot notify twice (Zulip's
`unique_together` on the message-notification pair). What this spec skips, on purpose: digest
scheduling windows and per-user quiet hours (Zulip's is a substantial subsystem, and `21-S2` owns
the digest), notification grouping/bundling, and any read-receipt or delivery-tracking beyond
`read_at` — the plan's `21-S3` decides what the reader sees.

## 📝 Architecture

```
src/server/notify/
  kinds.ts      — the registry: id, payload schema, defaults, copy keys, deep link, digestible
  dispatch.ts   — notify(): resolve prefs → dedupe → write in-app row → hand to the email seam
  email.ts      — the email seam (NOOP_EMAIL_ENQUEUER + setNotificationEmailEnqueuer), 21-S2 fills it
  adapters.ts   — three functions translating the producers' payloads into notify() calls
  install.ts    — side-effect-only; installs all four seams. Imported by src/server/worker.ts.

src/server/repos/notifications.ts   — tenant-scoped rows; write methods internal to the dispatcher
src/server/fns/notifications.ts     — list, mark read, read/write preferences
```

**Import direction.** `kinds.ts` imports the `*_EVENT` constants from the producing modules
(`#/server/budgets/thresholds`, `#/server/recurring/reminders`, `#/server/goals/reached`) and never
re-declares the strings. `adapters.ts` imports the producers' payload types. Nothing in
`src/server/budgets/**`, `src/server/recurring/**` or `src/server/goals/**` imports anything from
`src/server/notify/**` — the seams are how the dependency stays one-way, which is the whole reason
they exist.

**The registry is the type.** `NotificationKind` is `keyof typeof NOTIFICATION_KINDS`, and `notify`'s
`kind` parameter is typed as it. An unregistered kind is a compile error, and the payload type is
inferred from that kind's Zod schema, so a `budget.exceeded` payload cannot be passed as a
`goal.reached` one.

**The recipient is not the scope's principal, and this is the subtlest thing in the design.**
`listCronScopes` builds each cron scope from the workspace **owner** — its doc comment says so: _"The
principal is the workspace owner: the cron acts on behalf of somebody who could have performed the
same writes by hand"_. A notification, by contrast, belongs to a person: `docs/plans/21-notifications.md`
opens with _"two members of a household get their own read state and their own preferences"_. So an
adapter must **fan out**: read the workspace's members, then call `notify` once per member with that
member's `userId`. Writing one row for `scope.ctx.userId` would silently notify only the owner, and
in a two-person household that is half the product missing with nothing in the logs.

**Failure isolation, and the one place it must not apply.** The plan requires that a dispatcher throw
never fails the business operation that triggered it, and `src/server/goals/reached.ts` is called
from inside `src/server/fns/goals.ts` after a contribution commits, so that rule is real. But
`sweepBudgetThresholds` documents the opposite requirement in the same words:

> Writing the marker before dispatch would turn a transient failure into a notification nobody ever
> gets, with no record that it was owed.

It awaits the dispatcher and only then writes the markers. If the cron adapter swallowed every
failure, the marker would be written for a crossing that was never stored, and that crossing is gone
for the rest of the period. Both rules are satisfiable at once because they are about different
callers:

- `notify()` **returns a result** — `'written' | 'deduped' | 'skipped' | 'failed'` — and never throws.
- The **request-path adapter** (goals) ignores the result. A goal contribution that commits is not
  rolled back because a notification row failed.
- The **cron adapters** (thresholds, reminders) throw when any recipient came back `'failed'`.
  `runBudgetThresholdSweep` already wraps each workspace in `try/catch`, counts it in `failures` and
  logs it with the `organizationId`, so the blast radius is one workspace's sweep, the markers stay
  unwritten, and the next quarter-hour retries. Nothing new is needed for that to work.

## 📝 Data Model

Two additive tables in `src/server/db/schema.ts`, in the style of the siblings around them
(`id()`, `organizationId()`, `createdAt()`, `enumCheck`).

**The plan says `workspace_id`; the column is `organization_id`.** The schema has 74 occurrences of
`organization_id` and zero of `workspace_id`: _workspace_ is the word `CONTEXT.md` uses in prose and
`organization` is what the auth schema calls the row. Every composite index keeps `organization_id`
first (`docs/SPEC.md` §5.2, and `BACKWARD_COMPATIBILITY.md` → D1 schema restates it).

### `notifications`

| Column            | Type                   | Notes                                                |
| ----------------- | ---------------------- | ---------------------------------------------------- |
| `id`              | `text` pk              | `id()`                                               |
| `organization_id` | `text` not null        | `organizationId()`                                   |
| `user_id`         | `text` not null        | `references(() => user.id, { onDelete: 'cascade' })` |
| `kind`            | `text` not null        | `enumCheck` over the registry's ids                  |
| `payload_json`    | `text` not null        | the kind's Zod payload, serialised                   |
| `dedupe_key`      | `text` not null        | see below                                            |
| `read_at`         | `integer` ms, nullable | null means unread                                    |
| `created_at`      | `integer` ms not null  | `createdAt()`                                        |

- `unique(organization_id, user_id, dedupe_key)` — the dedupe guarantee.
- `index(organization_id, user_id, created_at desc)` — the list query `21-S3` will run.

`onDelete: 'cascade'` on `user_id` rather than `set null`: a notification with no recipient is
unreadable by construction, and leaving orphan rows behind would make the unread count a lie.

### `notification_prefs`

| Column            | Type              | Notes                               |
| ----------------- | ----------------- | ----------------------------------- |
| `id`              | `text` pk         | `id()`                              |
| `organization_id` | `text` not null   | `organizationId()`                  |
| `user_id`         | `text` not null   | cascade, as above                   |
| `kind`            | `text` not null   | `enumCheck` over the registry's ids |
| `in_app`          | `integer` boolean | not null                            |
| `email`           | `integer` boolean | not null                            |
| `digest`          | `integer` boolean | not null                            |

- `unique(organization_id, user_id, kind)`.

**Rows are created lazily.** Absence means "use the kind's defaults", and nothing seeds a row for an
existing member or for a new one. A migration that backfilled three booleans × fifteen kinds × every
member would be a large write whose only effect is to restate the defaults, and it would freeze
today's defaults into every existing household the moment a default is ever revised.

### `dedupe_key` — the load-bearing column

The budget cron re-evaluates every threshold every fifteen minutes. Without a dedupe key, one person
crossing 80% of a grocery budget receives 96 identical notifications a day. **The producer's key is
reused, never re-derived**: `crossingMarkerKey` already builds
`budget:threshold:v1:{budgetId}:{periodStart}:{threshold}` and is versioned `v1` precisely so that
changing what a crossing means cannot silently inherit markers written under the old rule. Deriving a
second key in `notify` would give two records of the same fact that can drift apart.

The `unique` is scoped to `(organization_id, user_id, …)`, so two households can legitimately hold
the same `dedupe_key` — and two members of one household each get their own row for one crossing,
which is the point.

**Sensitive data.** `payload_json` holds ids, names the member can already read, integer minor units
and currency codes. No email address, no token, no free text about a person. Nothing here needs
encryption beyond what the D1 binding already provides, and nothing here is written to a log:
failures log the kind and the `organizationId`, never the payload.

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
  },
): Promise<NotifyOutcome>
```

Order of operations, and each one's reason:

1. **Membership check.** A `userId` who is not a member of `scope.ctx.organizationId` returns
   `'skipped'` and logs. Never an orphan row addressed to somebody who cannot see it.
2. **Preference resolution.** The stored row for `(organization, user, kind)` if there is one, else
   the kind's `defaults`.
3. **In-app write**, when `inApp` is enabled, through the repository's internal write method. A
   unique-constraint violation on `dedupe_key` returns `'deduped'` — it is the expected path, not an
   error, and it is caught by constraint name rather than by message text.
4. **Email**, when `email` is enabled and the kind is `immediate`, handed to the email seam. When the
   kind is `digestible` instead, nothing further happens here — see below.
5. **Every step is wrapped.** A throw becomes `'failed'` plus one `logger.error` carrying the kind and
   the `organizationId`. `notify` itself never throws.

**"Marks it for the digest" needs no column.** The plan's wording implies state; the design needs
none. A digestible notification _is_ its in-app row: `21-S2`'s nightly digest selects rows whose kind
is digestible, whose `read_at` is null and whose `created_at` falls in the window. A separate
`digest_pending` flag would be a second record of the same fact, and the two would drift the first
time a row was marked read between the write and the sweep.

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

### `src/server/fns/notifications.ts`

Reads are `GET`, writes are `POST`, `requireOrg()` inside every handler and never in a `beforeLoad` —
the contract `src/server/fns/goals.ts` documents. Every input is Zod-parsed here and again in the
repository.

| Function            | Method | Input                                                  | Returns                              |
| ------------------- | ------ | ------------------------------------------------------ | ------------------------------------ |
| `listNotifications` | `GET`  | `{ cursor?, limit? }` via the shared pagination schema | page of rows for `ctx.userId` only   |
| `countUnread`       | `GET`  | none                                                   | `number`                             |
| `markRead`          | `POST` | `markReadSchema` — `{ ids: string[] }`, max 100        | `{ marked: number }`                 |
| `getPrefs`          | `GET`  | none                                                   | one resolved row per registered kind |
| `setPref`           | `POST` | `notificationPrefSchema` — kind enum + three booleans  | the resolved row after the upsert    |

`getPrefs` returns a **resolved** view — the stored row where one exists, the kind's defaults where
none does — so the caller never has to know that absence means defaults. `setPref` upserts on the
unique index.

No route consumes these in this stage; `21-S3` builds the bell, `/notifications` and
`/settings/notifications` on top of them. They ship here because the plan's Owned paths put them
here, and because a server function with a unit test is a smaller, more reviewable unit than a
server function plus a screen.

### The registry — `src/server/notify/kinds.ts`

Five entries, one per producer the tree actually has:

| Kind (from the producer's constant) | Payload                                                                                       | Defaults (in-app / email / digest) | Class      |
| ----------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------- | ---------- |
| `budget.threshold_crossed`          | `budgetId, budgetName, periodStart, threshold, spentMinor, availableMinor, currencyCode`      | on / on / on                       | digestible |
| `budget.exceeded`                   | the above plus `overspentByMinor`                                                             | on / on / off                      | immediate  |
| `recurring.due_soon`                | `seriesId, seriesName, periodStart, dueOn, expectedAmountMinor, expectedCurrencyCode, offset` | on / on / on                       | digestible |
| `recurring.overdue`                 | the above                                                                                     | on / on / off                      | immediate  |
| `goal.reached`                      | `goalId, name, targetMinor, contributedMinor, currencyCode, transactionId`                    | on / on / on                       | digestible |

Each entry also carries its two copy keys and its deep link (`/budgets/$budgetId`,
`/recurring/$seriesId`, `/goals/$goalId`).

`overspentByMinor` is a **positive magnitude with a sign-bearing name**, computed as
`spentMinor - availableMinor` at the adapter and asserted against `12-S3`'s own fixture. It is
carried rather than recomputed by the reader for the reason `src/server/goals/reached.ts` already
gives about its own amounts: re-reading the budget when the row is rendered prints whatever it says
then, which is a different sentence about a different moment.

## 📝 UI/UX

**None in this stage.** The plan states it under **UI (route, components)**: the bell, `/notifications`
and `/settings/notifications` are `21-S3`, and `21-S1`'s Definition of done carries `docs/SPEC.md`
§2's visual clauses forward to that stage explicitly.

## 📝 Visual change expected

**None.** No route, component or style file changes. Nothing in CI compares a pixel (ADR 0016), so
this line is the notice a reviewer gets, and here it is a true negative: the diff contains no file
under `src/routes/`, `src/components/` or `src/styles/`.

## 📝 Copy

Two keys per kind, landing in `src/lib/i18n/messages/en.ts` **and** `pl.ts` in the same change (skill
`i18n-messages`). Household words, not accountancy — the catalogue's own rule. Amounts and dates
arrive as placeholders and are formatted by the reader's locale at render time; **no key contains a
pre-formatted amount**, which is the property that lets a Polish member of an English-preferring
household read their own formatting off the same stored row.

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

The Polish column is written in the same change and is not a transliteration of the English: the
`i18n-messages` skill and `docs/I18N.md` own how a count inside a sentence gets its four branches.
None of the ten keys above needs plural branches — every count in them is an amount or a date, both
of which are formatted, not counted.

**These keys become a protected surface the moment the first row is written.**
`BACKWARD_COMPATIBILITY.md` → Message catalogue: notification rows store keys and parameters, so a
key referenced by a stored row cannot be removed or renamed, and a placeholder rename is a new key.

## 📝 Edge Cases & Failure Scenarios

| Scenario                                                                  | Behaviour                                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The same crossing is swept 96 times in a day                              | The first write succeeds; the other 95 hit the unique index on `dedupe_key` and return `'deduped'`. One row.                                                                                                            |
| A refund brings spend back under a threshold in the same period           | The marker stays and the notification stays. Re-arming means notifying somebody twice about one overspend — `thresholds.ts` rule 3.                                                                                     |
| Two households cross the same threshold on budgets with the same id shape | Both get a row: the unique index is scoped, so the keys cannot collide across `organization_id`.                                                                                                                        |
| Two members of one household, one crossing                                | Two rows, one per member, each with its own `read_at` and its own preference resolution.                                                                                                                                |
| A member has `in_app: false` and `email: false` for the kind              | Nothing is written and `notify` returns `'skipped'`. A row nobody asked for is not a safe default; the person turned it off.                                                                                            |
| The recipient is not a member of the scope's workspace                    | Nothing is written, `'skipped'`, one log line. Never an orphan row.                                                                                                                                                     |
| The notification write throws inside a request path (goal contribution)   | The contribution stays committed. The adapter ignores the outcome; `notify` already logged it.                                                                                                                          |
| The notification write throws inside the budget cron                      | The adapter throws, `sweepBudgetThresholds` does not reach the marker writes, `runBudgetThresholdSweep` counts one `failures` and logs the `organizationId`, and the next sweep retries the crossing.                   |
| A member is deleted                                                       | Their notification and preference rows cascade away with the `user` row.                                                                                                                                                |
| A kind is dispatched that the registry does not know                      | Impossible: `notify`'s `kind` parameter is the registry's key type, so this is a compile error, not a runtime branch.                                                                                                   |
| The email seam is not installed (the state on merge)                      | `notify` still writes the in-app row and returns `'written'`. `isNotificationEmailEnqueuerInstalled()` returns `false`, which is what makes the remaining gap visible in production the way the three current ones are. |
| `payload_json` fails to parse when read back                              | The row is skipped in the list and logged. A stored payload that no longer matches its kind's schema is a bug in a migration, not something to render half of.                                                          |

## 📝 Risks & Impact Review

**Blast radius.** New tables, a new module tree, one new import in `src/server/worker.ts`, and the
first behaviour change in three shipped features. That last one is the real risk and it is the one
the labels call out: `risk-high`.

**`BACKWARD_COMPATIBILITY.md` surfaces touched.**

- **D1 schema** — two new tables. Additive: nothing dropped, renamed, narrowed or made required, and
  no constraint an existing row violates. Approved by the maintainer on #210 per `AGENTS.md` →
  **Ask First**.
- **Tenant scope** — the new repository takes `TenantScope` first and its predicate is not removable
  by a caller (ADR 0002). There is no path around this.
- **Message catalogue** — the ten keys above become referenced by stored rows on the first write.

**Existing tests that must change, and why that is not a narrowing.** Three assertions currently
encode "nothing is installed" as the truth:
`src/server/cron/__tests__/recurring.test.ts` asserts `report.dispatcherInstalled` is `false`, and the
budget and goal suites assert their `NOOP_*` defaults. The `false` assertions become `true`
assertions — the fact under test is unchanged, its value flipped because this stage is what flips it.
The `NOOP_*` default assertions **stay exactly as they are**: they test the module's own default
before installation, which is still the default. `AGENTS.md` → **Ask First** covers narrowing a test;
none is narrowed here, and the diff should be read with that distinction in mind.

**Rollback.** Revert the PR. The two tables are left behind by an additive migration and read by
nothing; the three seams fall back to their `NOOP_*` defaults the moment `./notify/install` stops
being imported, which is the failure mode they were designed for. No data written by this stage is
depended on by anything else until `21-S2` lands.

**Deploy order.** Irrelevant here — nothing is enqueued, so there is no in-flight message shape.
`21-S2` is where the queue-consumer-first rule starts to matter.

**What this stage cannot prove.** That anybody receives anything. Until `21-S2`, "delivered" means "a
row exists in `notifications`". The `isNotificationEmailEnqueuerInstalled()` predicate is what keeps
that gap honest rather than assumed, and it is the reason the email seam is built here rather than
left as a `TODO`.

## 📝 Resolved assumptions (autonomous defaults)

Written under `--autonomous`; every one is reversible and every one is here to be overridden before
merge.

| #   | Question                                                                                                                                                                  | Resolution                                                                                                                              | Why                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | The plan's registry names (`budget.threshold`, `recurring.due`) or the tree's exported constants (`budget.threshold_crossed`, `recurring.due_soon`, `recurring.overdue`)? | **The tree's constants.** The plan document is corrected in the same PR.                                                                | The constants are already embedded in versioned dedupe marker keys and asserted in shipped tests. Changing them is a data migration; changing the plan is a paragraph.                                                                              |
| Q2  | Register all fifteen kinds the plan lists, or only those with a producer?                                                                                                 | **Only the five with a producer.**                                                                                                      | Ten registry entries with no caller, no test and no copy are speculative surface. The registry is designed so adding one later is one entry plus two keys — the plan says so itself. Recorded here so a reviewer who wants the full set can say so. |
| Q3  | `workspace_id` (the plan) or `organization_id` (the schema)?                                                                                                              | **`organization_id`**, via the `organizationId()` helper.                                                                               | 74 occurrences to zero. _Workspace_ is the prose word (`CONTEXT.md`); `organization` is the row.                                                                                                                                                    |
| Q4  | How does `notify` "enqueue an email" when the queue kind is `21-S2`'s?                                                                                                    | **A named seam** (`NOOP_EMAIL_ENQUEUER` + installer + `is*Installed()`), identical in shape to the three it sits beside.                | Lowest blast radius, greppable, tested, and it is precisely the socket #210 plugs into.                                                                                                                                                             |
| Q5  | How does `notify` "mark for the digest"?                                                                                                                                  | **No new state.** A digestible notification is its in-app row; `21-S2` selects on kind, `read_at` and `created_at`.                     | A `digest_pending` flag is a second record of the same fact, and it drifts the first time a row is read between the write and the sweep.                                                                                                            |
| Q6  | Are preference rows seeded for existing members?                                                                                                                          | **No — lazily created; absence means defaults.**                                                                                        | A backfill of 3 × kinds × members restates the defaults and freezes today's values into every existing household.                                                                                                                                   |
| Q7  | Do the server functions ship here or with `21-S3`'s UI?                                                                                                                   | **Here.**                                                                                                                               | The plan's Owned paths put `src/server/fns/notifications.ts` in `21-S1`, and a server function with a unit test is a smaller review unit than one bundled with a screen.                                                                            |
| Q8  | Who receives a notification when the cron scope's principal is the workspace owner?                                                                                       | **Fan out to every member** of `scope.ctx.organizationId`, one `notify` call each.                                                      | `listCronScopes` documents the owner as the acting principal, not the audience; the plan requires per-member read state and preferences. Notifying only the owner would lose half a household silently.                                             |
| Q9  | `notify` never throws, but `sweepBudgetThresholds` needs a failure to stop the marker write. Which rule wins?                                                             | **Both.** `notify` returns an outcome and never throws; request-path adapters ignore it, cron adapters throw on `'failed'`.             | The two rules govern different callers. `runBudgetThresholdSweep` already catches per workspace, counts `failures` and logs, so no new machinery is needed.                                                                                         |
| Q10 | Does the recurring series' own `notifyEmail` flag or the per-kind preference decide?                                                                                      | **Both, as an AND.** The series flag says this series wants reminders at all; the preference says this person wants this kind by email. | Neither surface changes, and either one turning it off is a decision somebody made deliberately.                                                                                                                                                    |

None carries `⚠ NEEDS HUMAN CONFIRMATION`: every item above is a code-level choice reversible in a
follow-up, and none weakens tenant scoping, the money rules or a `BACKWARD_COMPATIBILITY.md` surface.
The one decision that would have — the additive migration — was taken by the maintainer on #210
before this spec was written.

## 📋 Phasing

Three phases, each independently shippable and each leaving the gate green. At most one migration per
phase (`docs/SPEC.md` §8).

- **Phase 1 — The store.** Registry, migration, repository, tenant-isolation cases. Nothing dispatches
  yet; the three seams stay no-ops and the crons keep reporting `dispatcherInstalled: false`.
- **Phase 2 — The dispatcher.** `notify()`, the email seam, the copy, the money-invariant cases. Still
  nothing installed: `notify` is exported, tested and unused in production.
- **Phase 3 — Installation and the reader's door.** The three adapters, `install.ts`, the Worker
  import, the server functions, and the plan-document corrections. This is the phase that flips
  `dispatcherInstalled` to `true`.

Phase 1 alone is a coherent release; so is Phase 1 + 2. The behaviour change lands entirely in
Phase 3, which is where a reviewer should spend their attention.

## 📋 Implementation Plan

### Phase 1 — The store

1. **Write the registry.** `src/server/notify/kinds.ts`: five entries, each with `id` (imported from
   the producer's `*_EVENT` constant, never re-declared), a Zod `payload` schema, `defaults`,
   `titleKey`, `bodyKey`, `deepLink` and `digestible`. Export `NOTIFICATION_KINDS`, the
   `NotificationKind` key type and a `NotificationPayload<K>` helper.
   _Verify:_ `kinds.test.ts` asserts each `id` is `toBe`-identical to the producing module's exported
   constant, and that every entry's `titleKey`/`bodyKey` exists in the EN catalogue.
2. **Add the two tables** to `src/server/db/schema.ts` in the sibling style, with the unique indexes
   and the `enumCheck` over the registry ids, then run `pnpm db:generate`.
   _Verify:_ `pnpm db:generate < /dev/null && git diff --exit-code -- drizzle/` is clean on a second
   run; `drizzle/` is not hand-edited.
3. **Write the repository.** `src/server/repos/notifications.ts`, `TenantScope` first, inputs
   Zod-parsed a second time. Reads (`list`, `countUnread`, `markRead`, `getPref`, `upsertPref`) are
   exported; the row insert is exported only for the dispatcher's use and documented as such.
   _Tenant-isolation case:_ A's member cannot list, read or mark B's notifications; the scoped unique
   index lets two workspaces hold the same `dedupe_key`. Both go in
   `src/server/repos/__tests__/tenant-isolation.test.ts`.

### Phase 2 — The dispatcher

4. **Write the email seam.** `src/server/notify/email.ts` — the type, `NOOP_EMAIL_ENQUEUER`,
   `setNotificationEmailEnqueuer`, `isNotificationEmailEnqueuerInstalled`.
   _Verify:_ the default is the no-op; `null` restores it; an installed enqueuer receives what
   `notify` hands it.
5. **Write `notify()`.** `src/server/notify/dispatch.ts`, in the order given under **API Contracts**.
   The unique-violation path is caught by constraint, returns `'deduped'`, and is not logged as an
   error.
   _Verify:_ `dispatch.test.ts` — the dedupe case fires one alert 100 times and asserts one row; the
   non-member case writes nothing and logs; preference resolution with and without a stored row; the
   failure-isolation case (a throwing email seam still leaves the in-app row written and returns
   `'written'`).
   _Tenant-isolation case:_ `notify` with a `userId` who is not a member of the scope's workspace
   writes nothing.
6. **Add the ten copy keys** to `en.ts` and `pl.ts` in the same commit (skill `i18n-messages`).
   _Verify:_ the catalogue parity test; every registry `titleKey`/`bodyKey` resolves in both locales.
7. **Money invariants.** _Cases in `dispatch.test.ts`, with the write-path case in
   `src/server/repos/__tests__/money-invariants.test.ts`:_ `payload_json` stores `amountMinor` and a
   currency **code**, never a formatted string; `budget.exceeded` carries `overspentByMinor` as a
   positive magnitude, asserted against `12-S3`'s own fixture; rendering one row in `en` and in `pl`
   produces different strings from identical integers; a zero-decimal currency's body carries no
   decimal separator, at `currencies.digits` scale and never a hard-coded 2 (`docs/MONEY.md`).

### Phase 3 — Installation and the reader's door

8. **Write the adapters.** `src/server/notify/adapters.ts`: one function per seam, each fanning out
   over the workspace's members, each reusing the producer's dedupe key. The recurring adapter ANDs
   the series' own `notifyEmail` flag with the per-kind email preference.
   _Verify:_ `adapters.test.ts` — a two-member household gets two rows for one crossing; a cron
   adapter throws when a recipient comes back `'failed'`; the goals adapter does not.
9. **Install.** `src/server/notify/install.ts` (side-effect only, in the style of
   `src/server/billing/install.ts`) plus one `import './notify/install'` in `src/server/worker.ts`
   beside `./ledger` and `./billing/install`.
   _Verify:_ the three `is*Installed()` predicates return `true` after the import; the existing
   `dispatcherInstalled: false` assertions in `src/server/cron/__tests__/recurring.test.ts` and the
   budget suite are updated to `true` — the fact under test unchanged, its value flipped. The
   `NOOP_*` default assertions are left untouched.
10. **Write the server functions.** `src/server/fns/notifications.ts` per the table under **API
    Contracts**: `requireOrg()` inside every handler, Zod on every input, reads `GET`, writes `POST`.
    _Verify:_ `fns/__tests__/notifications.test.ts` — an unauthenticated call is refused; `markRead`
    rejects 101 ids; `getPrefs` returns defaults for a kind with no stored row and the stored values
    for one that has.
11. **Correct the plan.** `docs/plans/21-notifications.md`: replace the `notifyNoop` references in the
    Area brief and in `21-S1`'s Verification with the three real `NOOP_*` constants; correct the
    registry kind names to the exported constants; correct `workspace_id` to `organization_id` in
    `21-S1`'s **Data and migration**; note that the digest needs no marker column.
    _Verify:_ `rg 'notifyNoop' docs/ src/` returns nothing.
12. **Run the full gate** (`AGENTS.md` → Validation Commands), including
    `pnpm generate-spec-index && git diff --exit-code -- .ai/specs/README.md` after this spec's
    `Status` and `Implementation` fields are updated.
