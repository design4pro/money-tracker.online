# 21 — Notifications

## Area brief

One dispatcher, three channels: **in-app**, **email**, and **digest**. Push is dropped
(`99-boundaries-and-blockers.md` BND-13) — a web-push implementation that works across iOS Safari,
Android Chrome and desktop is a multi-week project with a permission prompt that most people decline,
and email plus in-app covers every notification this product actually sends.

Plans 12, 13 and 15 shipped in wave 3 against **named no-op dispatchers** so they could ship their
alert logic without waiting for this plan. There are three, one per producer, and they are named
rather than empty so that "nothing is being sent yet" is greppable: `NOOP_ALERT_DISPATCHER` in
`src/server/budgets/thresholds.ts`, `NOOP_REMINDER_DISPATCHER` in `src/server/recurring/reminders.ts`
and `NOOP_GOAL_REACHED_DISPATCHER` in `src/server/goals/reached.ts`. `21-S1` replaces all three, and
the replacement is a test assertion, not a hope: each module exports an `is*Installed()` predicate,
the two crons report it in their run summaries, and `src/server/notify/__tests__/install.test.ts`
asserts all three flip — because a permanent no-op is a silent feature failure that nobody notices
until a person asks why they never got their budget alert.

Everything user-visible here is **workspace-scoped and per-user**: a notification belongs to a person
in a workspace, and two members of a household get their own read state and their own preferences.

---

## Stage 21-S1 — The dispatcher, the store and preferences

### Stage id

`21-S1` · Wave 5 · effort **L**.

### Reference rows

`NOTIF-01 missing → done` — the notification store and the scoped repository.
`NOTIF-02 missing → done` — the dispatcher replacing the three `NOOP_*` constants, with per-user
preference resolution and deduplication.

### Owned paths

- `src/server/repos/notifications.ts` — new
- `src/server/notify/dispatch.ts` — new
- `src/server/notify/kinds.ts` — new
- `src/server/notify/adapters.ts` — new
- `src/server/notify/install.ts` — new
- `src/server/notify/copy.ts` — new; the kind → catalogue-key + parameters mapping, which formats
  nothing so that a mixed-locale household renders one stored row two ways
- `src/server/notify/dedupe.ts` — new; the one dedupe key this stage had to invent, the other two
  being reused verbatim from the producers that already build them
- `src/server/notify/email.ts` — new; the seam `21-S2` installs its enqueuer into
- `src/server/notify/__tests__/dispatch.test.ts` — new

`src/server/fns/notifications.ts` moved to `21-S3`: the reader's server functions have no consumer
until the screen that calls them exists, and a stage that ships an unused public surface has nothing
to verify it against.

### Data and migration

Requisitions into `00-S9`: `notifications` (`id`, `organization_id`, `user_id`, `kind`,
`payload_json`, `dedupe_key`, `read_at`, `created_at`), unique on
`(organization_id, user_id, dedupe_key)`, indexed on `(organization_id, user_id, created_at desc)`;
and `notification_prefs` (`id`, `organization_id`, `user_id`, `kind`, `in_app`, `email`, `digest`),
unique on `(organization_id, user_id, kind)`. The tenant column is `organization_id` everywhere in
this tree (ADR 0002); `workspace` is the word the product uses for it, not the column.

**`dedupe_key` is the load-bearing column.** The 15-minute cron re-evaluates every budget threshold
every quarter hour; without a dedupe key a person crossing 80% of their grocery budget receives 96
identical emails a day. The key is built from the kind and the semantic occasion — for a budget
threshold, `budget:{budgetId}:{periodId}:{thresholdPct}` — so the second and subsequent attempts are
a unique-constraint no-op, and the test that proves it fires the same alert 100 times and asserts one
row.

### Server (repo, server function, Zod)

- **`kinds.ts`** is the registry: every notification kind with its `id`, its Zod payload schema, its
  default channel settings, its i18n key for title and body, its deep link, and whether it is
  **digestible** (can be batched into a daily summary) or **immediate**. Adding a notification is one
  entry here plus two translation keys — nothing else in the system enumerates kinds. The initial set
  is the five occasions the tree actually computes, named by the constants the producers already
  export: `budget.threshold_crossed`, `budget.exceeded` (`src/server/budgets/thresholds.ts`),
  `recurring.due_soon`, `recurring.overdue` (`src/server/recurring/reminders.ts`) and `goal.reached`
  (`src/server/goals/reached.ts`). The rest of the list this plan once sketched —
  `import.completed`, `member.joined`, `billing.payment_failed` and the others — each becomes one
  entry plus two catalogue keys on the day something computes it. A kind with no producer is a
  vocabulary entry a SQL `CHECK` accepts and nothing ever writes.
- **`dispatch.ts`** exports `notify(scope, { userId, kind, payload, dedupeKey })`. It resolves the
  person's preferences (row, falling back to the kind's defaults), writes the row, and enqueues an
  email if enabled and the kind is immediate. It is the **only** module that writes `notifications`,
  and the repository's write function is documented as having exactly that one caller.

  **"Marks it for the digest" needs no column.** A digestible notification _is_ its row: `21-S2`'s
  nightly digest selects rows whose kind is digestible, whose `read_at` is null and whose
  `created_at` falls in the window. A `digest_pending` flag would be a second record of the same
  fact, and the two drift the first time a row is read between the write and the sweep.

- **Failure isolation.** A dispatcher throw must never fail the business operation that triggered it.
  `notify` catches, logs with the kind and workspace, and returns — a budget alert that fails to send
  must not roll back the transaction that crossed the threshold. The test asserts a throwing email
  path still leaves the in-app row written and the caller unaffected.
- **Zod.** `notificationPrefSchema` (kind enum, three booleans), `markReadSchema` (ids array, max
  100).

### UI (route, components)

None in this stage.

### Quota

No countable row. Notifications are not a plan-limited resource; the **email** send rate is a cost
control handled in `21-S2` by the digest, not a plan boundary.

### Tenant isolation test

In `tenant-isolation.test.ts`: A's member cannot list, read or mark B's notifications; `notify` with a
`userId` who is not a member of the scope's workspace **writes nothing and logs**, rather than
creating an orphan row addressed to someone who cannot see it; and the dedupe unique index is scoped
so two workspaces can legitimately hold the same `dedupe_key` without colliding.

### Money invariant

_A notification carries a rendered amount, and it must be the amount that caused it._ Cases in
`dispatch.test.ts`:

- _`payload_json` stores `amountMinor` and `currency` as integers and a code_, never a pre-formatted
  string — a stored string cannot be re-rendered in the reader's locale, and a Polish member of an
  English-preferring workspace must see their own formatting.
- _the payload for `budget.exceeded` carries the overspend as a positive magnitude plus a sign-bearing
  field name_, matching `12-S3`'s alert computation exactly, asserted against the same fixture.
- _rendering a notification in `en` and in `pl` produces different strings from identical integers_,
  which is the property that proves no formatting leaked into the store.
- _a zero-decimal currency's notification body carries no decimal separator_.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `install.test.ts`: the **no-op replacement assertion** — in a module graph rebuilt with
  `vi.resetModules()`, all three `is*Installed()` predicates report `false` before the install module
  is imported and `true` after it.
- `dispatch.test.ts`: the dedupe test firing 100 identical alerts and asserting one row; preference
  resolution with and without a stored row.
- `dispatch.test.ts`: the four money cases; the failure-isolation case; the non-member case.
- No browser evidence.

### Definition of done

All seven §7 items; §2's visual clauses are carried by `21-S3`, stated explicitly.

### Blockers

None.

---

## Stage 21-S2 — Email delivery and the daily digest

### Stage id

`21-S2` · Wave 5 · effort **L**.

### Reference rows

`NOTIF-03 missing → done` — the email sender, templates and the queue handler.
`NOTIF-04 missing → done` — the daily digest assembled by the nightly cron.
`NOTIF-05 missing → done` — unsubscribe and bounce handling.

### Owned paths

The directory is `src/server/email/`, not `src/server/notify/email/` — the maintainer settled that
on #210 (decision 4), because `src/server/notify/email.ts` already exists as 21-S1's seam and a
sibling directory of the same name would be two things with one name. `src/server/email/**` imports
from `#/server/notify` and never the other way round; `install.ts` is the only place the two meet.

- `src/server/email/send.ts` — new; `sendEmail({ to, subject, html, text, headers, idempotencyKey, tags })`
- `src/server/email/render.ts` — new; `renderEmail(element)` → `{ html, text }`
- `src/server/email/templates/layout.tsx` — new; the shared frame, footer included
- `src/server/email/templates/{notification,digest,auth}.tsx` — new; one per message family
- `src/server/email/locale.ts` — new; `resolveRecipientLocale`
- `src/server/email/unsubscribe-token.ts` — new; signing and verifying
- `src/server/email/recipient-hash.ts` — new; `hashRecipient`
- `src/server/email/enqueue.ts` + `src/server/email/install.ts` — new; the real enqueuer and its installer
- `src/server/email/__tests__/render.test.ts` — new
- `src/lib/notifications/render-copy.ts` — new; `CopyParam` → display string, pure, reused by 21-S3
- `src/server/repos/email-deliveries.ts`, `src/server/repos/email-suppressions.ts` — new
- `src/server/queue/handlers/notify-email.ts` — new
- `src/server/queue/handlers/__tests__/notify-email.test.ts` — new
- `src/server/cron/digest.ts` — new
- `src/server/cron/email-recovery.ts` — new; the quarter-hourly recovery sweep
- `src/routes/api/unsubscribe.ts`, `src/routes/unsubscribe.tsx` — new
- `src/routes/api/webhooks/resend.ts` — new

### Data and migration

Requisitions into `00-S9`: `email_deliveries` (`id`, `organization_id`, `user_id`, `kind`,
`notification_id`, `dedupe_key`, `to_hash`, `provider_message_id`, `status`, `error_code`,
`created_at`, `sent_at`) and `email_suppressions` (`email_hash`, `reason`, `created_at`).

`notification_id`, `dedupe_key` and the wider status set widen this stage's original column list
(spec A5): the tenant check needs the notification id, the digest and the re-enqueue need the
dedupe key, and the statuses the sweep and the cap write need names. `status` is
`queued | sending | sent | failed | deferred | digested | suppressed | bounced | complained` — the
five above plus `failed` (which this plan already used without listing it), `sending` (the claim),
`deferred` (the cap) and `digested` (a deferred row a digest has since carried). It is still one
additive migration.

Indexes: unique `(organization_id, user_id, dedupe_key)`, so a second enqueue of one notification or
a second digest on the same day conflicts and is dropped, and `(organization_id, created_at)` for
the daily cap count.

**`email_suppressions` has no `organization_id`** (spec A2, confirmed by the maintainer on PR #344).
A hard bounce or a complaint is a fact about an address, not about a workspace, and per-workspace
suppression would keep emailing a complained address from a second workspace. It is platform data,
modelled on `src/server/repos/billing-events.ts`'s documented carve-out.

**`to_hash`, not the address.** The delivery log is queried during support and read in aggregate;
storing an HMAC-SHA-256 of the lowercased address keyed by a per-environment salt gives us bounce
correlation without a second copy of everyone's email. The salt is never rotated, because rotating
it breaks that correlation. `docs/SECURITY.md` §4 records the choice.

### Server (repo, server function, Zod)

- **Sender.** A hand-rolled REST client against the transactional provider — the same posture as the
  Polar client (BND-23): a `fetch` wrapper, typed request and response, explicit retries. No SDK.
  `send.ts` exposes `sendEmail({ to, subject, html, text, headers })` and nothing else.
- **Every email is HTML and plain text.** Text is not a fallback afterthought; it is generated from
  the same template data, and `render.test.ts` asserts both contain the same amounts and the same
  link.
- **Templates** are **React Email components** (`@react-email/components`, pinned in `docs/SPEC.md`
  §3). `render()` runs twice on the same element — once for HTML, once with `{ plainText: true }` —
  so both parts come from the same typed data by construction, which is what this stage originally
  asked "functions of typed data" for. The i18n layer resolves strings in the **recipient's** locale:
  the workspace's locale is a default and the person's preference wins. **Until `user_preferences`
  (plan 23) or `organization_settings` (plan 02) exists there is no stored locale to read**, so
  `resolveRecipientLocale` runs the negotiation chain over a seam that returns `null` and notification
  and digest email goes out in `en` (spec A1, accepted by the maintainer). Auth emails run inside a
  request and use that request's negotiated locale.
- **Queue handler.** `notify.email` messages are **at-least-once to the transport and deduplicated at
  the provider**. A conditional update `queued → sending` claims the row, so a concurrent redelivery
  finds nothing to claim and sends nothing; each send carries Resend's `Idempotency-Key` (the
  delivery id), so a resend after a crash is accepted without a second copy being delivered. This
  replaces the "at-most-once via a conditional update" wording above, which could not hold together
  with "a 5xx retries" once a worker dies between the claim and the status update. A provider 5xx or
  429 retries with backoff; a 4xx is terminal and marks `failed` with the code — retrying a rejected
  address forever is how a sender reputation dies.
- **Recovery sweep.** `runEmailRecovery` on the quarter-hourly cron puts rows left in `sending` or
  `queued` for more than 15 minutes back to `queued` and enqueues them again, only while a provider
  is configured. Rows older than 23 hours are marked `failed` (`expired`) rather than resent, because
  Resend's idempotency window is 24 hours and a message that arrives a day late is worse than one
  that does not arrive. `deferred` rows no digest has carried within 48 hours expire the same way.
- **Digest.** `digest.ts` runs in the nightly cron after the backup step, gathers each user's
  digestible notifications from the last 24 hours, and sends one email per user with a non-zero set.
  **No notifications, no email** — a daily "you have nothing" message trains people to filter the
  sender.
- **Unsubscribe.** Every **notification and digest** email carries `List-Unsubscribe` and
  `List-Unsubscribe-Post` headers plus a visible footer link, where `t` is a **signed, expiring
  token** (180 days) naming the user, workspace and kind. **Auth emails carry neither header** (spec
  A4): nobody can opt out of a password reset, and a header that pretends otherwise is misleading.
  The `POST /api/unsubscribe?t=` endpoint is RFC 8058 one-click; the footer link goes to the
  `/unsubscribe?t=` page, whose `GET` renders a confirmation and **changes nothing**, because mail
  scanners prefetch links and a `GET` that unsubscribes turns every security gateway into an
  unsubscribe. Both require **no session** — an unsubscribe link that demands a login is a spam
  complaint. The page's link back to full preferences is left out until `21-S3` ships
  `/settings/notifications` (spec A7); the invalid state links to sign-in instead.
- **Bounces.** The provider's webhook (verified by signature, the same Standard Webhooks verifier
  `22-S1` owns) is handled **inline** rather than store-then-enqueue like Polar (spec A6): processing
  is two idempotent indexed writes, neither slow nor order-dependent. It marks deliveries and adds
  hard bounces and complaints to `email_suppressions`. A suppressed address is skipped **before** the
  provider call, and the in-app notification is still written — losing the email must not lose the
  notification. **There is no way to remove a suppression in this stage** (spec A12): that is an
  operator action with abuse potential and it belongs with the admin console (plan 25).

### UI (route, components)

Only `/api/unsubscribe`'s confirmation page, which is a minimal server-rendered document using the
marketing shell's tokens. It is still held to the full bar: both themes, keyboard-reachable, and axe
clean.

### Quota

No plan-limited row. A **per-workspace daily email cap** (`WORKSPACE_DAILY_EMAIL_CAP`, generous)
exists purely as an abuse brake; hitting it logs loudly at `error`, once per workspace per day, and
switches the workspace to digest-only for the day rather than dropping notifications silently. Over
the cap the enqueuer writes the row `deferred` and the next digest carries it, whatever the person's
`digest` preference is — they asked for these by email — and marks it `digested`. The digest re-reads
the kind's `email` preference first, so somebody who used the unsubscribe link since does not get
them. The in-app row is written either way, because `notify()` writes it before the email leg runs.

### Tenant isolation test

In `tenant-isolation.test.ts`: the queue handler validates the message's `workspaceId` against the
notification row before rendering, and a mismatched message goes to the DLQ; an unsubscribe token
signed for workspace B cannot flip a preference in A even if the `userId` is a member of both — the
token names both, and both are checked.

### Money invariant

_An email states the same number the app states._ Cases in `render.test.ts`:

- _the HTML and text parts of every template render byte-identical amount strings_ for the same
  payload — two renderings of one number that disagree is the bug this catches.
- _amounts are formatted from the payload's integers in the recipient's locale_, asserted with an
  `en` and a `pl` recipient receiving the same `budget.exceeded` payload.
- _each digest line's amount equals the same notification rendered on its own_. **The digest sums
  nothing** (spec A3): the per-kind totals this plan originally asked for would add the spend of
  different budgets, and amounts in different currencies, which is not a meaningful quantity and
  breaks `docs/MONEY.md` §2 the moment two currencies meet. The digest lists each notification with
  its own amount instead, and the invariant is that the list and the standalone rendering agree.
- _no template interpolates a raw `amountMinor` into user-facing text_ — a test scans the rendered
  output for the integer's raw form and fails on a match, which is how `123456` reaching someone's
  inbox as "123456" gets caught.

The formatting itself lives in `src/lib/notifications/render-copy.ts`, which is pure and imports
nothing from `server/`, so `21-S3`'s in-app notification item renders the same payload through the
same function: one payload, two surfaces, one number.

### Verification

- Command gate.
- `render.test.ts`: the four money cases; both locales; HTML escaping of a payee name containing
  `<script>`; the plain-text part containing no markup.
- `notify-email.test.ts`: the conditional-update no-double-send under redelivery; 5xx retry and 4xx
  terminal paths; the suppression skip still writing the in-app row; the daily cap switching to
  digest.
- Digest: a fixture user with three digestible and one immediate notification receives one digest
  containing three, and the immediate one was sent separately.
- Browser evidence: the **unsubscribe confirmation page**, both themes, at 360 / 1280 / 2560 px.
- Email evidence: rendered HTML captured at 360px and 1280px in a light and a dark client, since
  `prefers-color-scheme` in email is real and a dark-mode-broken template is the most common
  regression here.
- axe on the unsubscribe page: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and the §2 clauses that apply to the unsubscribe page.

### Blockers

`OPEN-8` — the sub-processor statement must name the email provider before launch. The code is
provider-shaped behind `send.ts` and switching is a one-file change, so this blocks the published
policy, not the build.

---

## Stage 21-S3 — The in-app notification centre

### Stage id

`21-S3` · Wave 5 · effort **M**.

### Reference rows

`NOTIF-06 missing → done` — the header bell, the unread count and the panel.
`NOTIF-07 missing → done` — `/notifications` with filtering and bulk mark-read.
`NOTIF-08 missing → done` — `/settings/notifications` preference matrix.

### Owned paths

- `src/routes/_app/-ui/notification-bell.tsx` — new
- `src/routes/_app/notifications/index.tsx` — new
- `src/routes/_app/settings/notifications.tsx` — new
- `src/routes/_app/-ui/notification-item.tsx` — new
- `e2e/notifications.spec.ts` — new

### Data and migration

None.

### Server (repo, server function, Zod)

`loadNotifications` (keyset paginated, `desc(id)`), `markRead(ids)`, `markAllRead()`, and
`loadUnreadCount()`. The unread count is a scoped `COUNT` with the existing index, refreshed on
navigation and on a **60-second poll** — not a websocket (BND-14) and not a 5-second poll, which
would be 17 000 requests per user per day for a number that changes twice.

### UI (route, components)

- **Components.** `notification-bell.tsx` (a `MenuTrigger` in the app shell from `04-S3`, showing the
  ten most recent with a "See all" link); `notification-item.tsx` (icon, title, rendered body,
  relative time with an absolute `title`, and a deep link); `/notifications` (the full list with
  filters by kind and read state, and bulk selection); `/settings/notifications` (a matrix: one row
  per kind, three checkbox columns).
- **States.** Empty ("You're all caught up" — the honest version, since this is the normal state);
  unread; read; loading more; error; and **stale deep link** (the referenced budget or import is
  gone — the item renders with its text and the link disabled with an explanation, never a 404 the
  person walks into).
- **Accessibility.** The bell's accessible name includes the count ("Notifications, 3 unread"), and
  the count is **not** conveyed by a colour dot alone. The panel is a menu with full keyboard
  support and focus return. Marking read announces the result politely; it does **not** move focus or
  reorder the list under the person's cursor, which is the classic notification-centre trap. The
  preference matrix is a real `<table>` with row and column headers so a checkbox's purpose is
  announced as "Budget exceeded, Email"; each checkbox is 44px (2.5.5 AAA). Changes save immediately
  with a status message, and there is no timeout on the interaction (2.2.6 AAA).

### Quota

No countable row.

### Tenant isolation test

Covered by `21-S1`; this stage adds an e2e assertion that switching workspaces switches the bell's
count and the list contents, with no cross-bleed from a cached loader.

### Money invariant

_The in-app rendering and the email rendering of one notification state the same amount._ Case in
`money-invariants.test.ts`: _`notification-item` and the email template produce the same formatted
amount for the same payload and locale_, asserted for `budget.exceeded`, `goal.reached` and
`recurring.recorded`. One payload, two surfaces, one number.

### Verification

- Command gate.
- Unit: the bell's accessible name across counts 0, 1 and 99+; the matrix's header association; the
  stale-deep-link rendering.
- `e2e/notifications.spec.ts`: a budget threshold alert appears in the bell within one poll; marking
  read decrements the count and does not move focus; the preference matrix disables a kind and the
  next alert produces no row for that channel; the workspace-switch assertion.
- Browser evidence at the pinned clock: the **bell panel open**, `/notifications` **with unread and
  read items**, the **empty state**, and `/settings/notifications`, all in both themes at
  **360 / 1280 / 2560 px**, plus a **focused checkbox in the matrix**.
- axe on all three surfaces with the panel open: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.
