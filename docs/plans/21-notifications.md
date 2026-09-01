# 21 — Notifications

## Area brief

One dispatcher, three channels: **in-app**, **email**, and **digest**. Push is dropped
(`99-boundaries-and-blockers.md` BND-13) — a web-push implementation that works across iOS Safari,
Android Chrome and desktop is a multi-week project with a permission prompt that most people decline,
and email plus in-app covers every notification this product actually sends.

Plans 12, 13 and 15 shipped in wave 3 against a **named no-op dispatcher** (`notifyNoop`) so they
could ship their alert logic without waiting for this plan. `21-S1` replaces it, and the replacement
is a test assertion, not a hope: `notifications.test.ts` asserts the exported `notify` is not
`notifyNoop`, because a permanent no-op is a silent feature failure that nobody notices until a
person asks why they never got their budget alert.

Everything user-visible here is **workspace-scoped and per-user**: a notification belongs to a person
in a workspace, and two members of a household get their own read state and their own preferences.

---

## Stage 21-S1 — The dispatcher, the store and preferences

### Stage id

`21-S1` · Wave 5 · effort **L**.

### Reference rows

`NOTIF-01 missing → done` — the notification store and the scoped repository.
`NOTIF-02 missing → done` — the dispatcher replacing `notifyNoop`, with per-user preference
resolution and deduplication.

### Owned paths

- `src/server/repos/notifications.ts` — new
- `src/server/repos/__tests__/notifications.test.ts` — new
- `src/server/notify/dispatch.ts` — new
- `src/server/notify/kinds.ts` — new
- `src/server/notify/__tests__/dispatch.test.ts` — new
- `src/server/functions/notifications.ts` — new

### Data and migration

Requisitions into `00-S9`: `notifications` (`id`, `workspace_id`, `user_id`, `kind`, `payload_json`,
`dedupe_key`, `read_at`, `created_at`), unique on `(workspace_id, user_id, dedupe_key)`, indexed on
`(workspace_id, user_id, created_at desc)`; and `notification_prefs` (`id`, `workspace_id`,
`user_id`, `kind`, `in_app`, `email`, `digest`), unique on `(workspace_id, user_id, kind)`.

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
  entry here plus two translation keys — nothing else in the system enumerates kinds. Initial set:
  `budget.threshold`, `budget.exceeded`, `recurring.due`, `recurring.recorded`, `recurring.failed`,
  `goal.reached`, `goal.off_track`, `import.completed`, `import.failed`, `export.ready`,
  `rule.paused`, `billing.payment_failed`, `billing.plan_changed`, `member.invited`,
  `member.joined`.
- **`dispatch.ts`** exports `notify(scope, { userId, kind, payload, dedupeKey })`. It resolves the
  person's preferences (row, falling back to the kind's defaults), writes the in-app row if enabled,
  enqueues an email if enabled and the kind is immediate, and marks it for the digest otherwise. It
  is the **only** module that writes `notifications`, and the repository's write methods are not
  exported to callers outside it.
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
- `notifications.test.ts`: the **no-op replacement assertion** (`expect(notify).not.toBe(notifyNoop)`
  and that `notifyNoop` is no longer imported anywhere outside its own deprecation shim); the dedupe
  test firing 100 identical alerts and asserting one row; preference resolution with and without a
  stored row.
- `dispatch.test.ts`: the four money cases; the failure-isolation case; the non-member case.
- No browser evidence.

### Definition of done

All six §7 items; §2's visual clauses are carried by `21-S3`, stated explicitly.

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

- `src/server/notify/email/send.ts` — new
- `src/server/notify/email/render.ts` — new
- `src/server/notify/email/templates.ts` — new
- `src/server/notify/email/__tests__/render.test.ts` — new
- `src/server/queue/handlers/notify-email.ts` — new
- `src/server/queue/handlers/__tests__/notify-email.test.ts` — new
- `src/server/cron/digest.ts` — new
- `src/routes/api/unsubscribe.ts` — new

### Data and migration

Requisitions into `00-S9`: `email_deliveries` (`id`, `workspace_id`, `user_id`, `kind`, `to_hash`,
`provider_message_id`, `status` in `queued|sent|bounced|complained|suppressed`, `error_code`,
`created_at`, `sent_at`) and `email_suppressions` (`email_hash`, `reason`, `created_at`).

**`to_hash`, not the address.** The delivery log is queried during support and read in aggregate;
storing a SHA-256 of the lowercased address with a per-environment salt gives us bounce correlation
without a second copy of everyone's email. `docs/SECURITY.md` §4 records the choice.

### Server (repo, server function, Zod)

- **Sender.** A hand-rolled REST client against the transactional provider — the same posture as the
  Polar client (BND-23): a `fetch` wrapper, typed request and response, explicit retries. No SDK.
  `send.ts` exposes `sendEmail({ to, subject, html, text, headers })` and nothing else.
- **Every email is HTML and plain text.** Text is not a fallback afterthought; it is generated from
  the same template data, and `render.test.ts` asserts both contain the same amounts and the same
  link.
- **Templates** are functions of typed data returning both parts, with the i18n layer (plan 02)
  resolving strings in the **recipient's** locale — the workspace's locale is a default, the person's
  preference wins.
- **Queue handler.** `notify.email` messages are processed with at-most-once semantics enforced by a
  conditional update on `email_deliveries.status` (`queued → sent` only from `queued`), so a
  redelivery cannot double-send. A provider 5xx retries with backoff; a 4xx is terminal and marks
  `failed` with the code — retrying a rejected address forever is how a sender reputation dies.
- **Digest.** `digest.ts` runs in the nightly cron after the backup step, gathers each user's
  digestible notifications from the last 24 hours, and sends one email per user with a non-zero set.
  **No notifications, no email** — a daily "you have nothing" message trains people to filter the
  sender.
- **Unsubscribe.** Every email carries `List-Unsubscribe` and `List-Unsubscribe-Post` headers plus a
  visible footer link to `/api/unsubscribe?t=...`, where `t` is a **signed, expiring token** naming
  the user, workspace and kind. The route flips the matching preference and renders a confirmation
  page with a link back to full preferences. It requires **no session** — an unsubscribe link that
  demands a login is a spam complaint.
- **Bounces.** The provider's webhook (verified by signature, the same Standard Webhooks verifier
  `22-S1` owns) marks deliveries and adds hard bounces and complaints to `email_suppressions`. A
  suppressed address is skipped **before** the provider call, and the in-app notification is still
  written — losing the email must not lose the notification.

### UI (route, components)

Only `/api/unsubscribe`'s confirmation page, which is a minimal server-rendered document using the
marketing shell's tokens. It is still held to the full bar: both themes, keyboard-reachable, and axe
clean.

### Quota

No plan-limited row. A **per-workspace daily email cap** (a named constant, generous) exists purely as
an abuse brake; hitting it logs loudly and switches the workspace to digest-only for the day rather
than dropping notifications silently.

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
- _the digest's per-kind totals equal the sum of the underlying notifications' amounts_, recomputed
  rather than accumulated.
- _no template interpolates a raw `amountMinor` into user-facing text_ — a test scans the rendered
  output for the integer's raw form and fails on a match, which is how `123456` reaching someone's
  inbox as "123456" gets caught.

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

All six §7 items and the §2 clauses that apply to the unsubscribe page.

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

All six §7 items and all ten §2 clauses.

### Blockers

None.
