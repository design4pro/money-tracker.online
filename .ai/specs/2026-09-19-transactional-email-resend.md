# Transactional email on Resend: React Email templates, the digest and unsubscribe

| Field              | Value |
| ------------------ | ----- |
| **Status**         | draft |
| **Issue**          | #210  |
| **Spec PR**        | #344  |
| **Implementation** | none  |

## 📝 TLDR

`21-S1` (#219, PR #224) left the email leg of `notify()` as a named seam,
`NOOP_EMAIL_ENQUEUER` in `src/server/notify/email.ts`, and nothing fills it. This spec designs
`21-S2` from `docs/plans/21-notifications.md`: a Resend REST transport, React Email templates
that render an HTML part and a plain-text part in a resolved locale, the `notify.email` queue
handler, the nightly digest, a signed unsubscribe link that needs no session, and Resend bounce and
complaint handling. The three auth emails in `src/server/auth/email.ts` move onto the same
templates, so the tree ends up with one way to render email. **One capability: the product can send
email that is correct, localised, deduplicated and easy to stop.** It ships in five phases. The
first ships no schema and no new public surface. Nothing is emailed about a notification until
Phase 4, which installs the enqueuer only once unsubscribe, bounce suppression, the daily cap and the
recovery sweep are already on `develop`.

## 📝 Problem Statement

- `src/server/email/` is empty. `@react-email/components@^1.0.12` and `react-email@^6.9.2` are
  pinned (`docs/SPEC.md` §3) and installed, and nothing in `src/` imports them.
- `src/server/notify/email.ts` exports `NOOP_EMAIL_ENQUEUER` and
  `isNotificationEmailEnqueuerInstalled()`, which returns `false` in every deployment. `notify()`
  writes the row and then hands the email to a no-op, so a member whose budget is spent
  (`budget.exceeded`, immediate by default) or whose bill is late (`recurring.overdue`) gets an
  in-app row that nobody can read yet (`21-S3` has not shipped) and no email.
- The three auth emails (`verify-email`, `reset-password`, `organization-invitation`) are string
  HTML in English whatever the reader's language. The module says it is temporary: _"`docs/plans/21-*`
  owns the real templates"_.
- `docs/plans/21-notifications.md` → 21-S2 was written before React Email was pinned. It says
  templates are "functions of typed data", and its **Owned paths** list `src/server/notify/email/`,
  while the directory the tree reserves is `src/server/email/`. The maintainer settled both on #210
  (decision 4): the directory is `src/server/email/`, and the plan is corrected in the same change.

## 📝 Proposed Solution

Build 21-S2 as the plan describes, with five changes the tree forces. Each is recorded under
**Resolved assumptions** or in the maintainer decisions on #210:

1. **React Email is the template technology.** Templates are `.tsx` components. `render()` runs
   twice on the same element: once for HTML and once with `{ plainText: true }`. Both parts come
   from the same typed data by construction, which is the plan's rule.
2. **`src/server/email/` owns the module**, not `src/server/notify/email/`. `src/server/notify/email.ts`
   stays where it is as the seam, and `21-S2` installs into it.
3. **The auth emails migrate** (maintainer decision 2) onto the shared layout. `createAuthEmailer`
   keeps its signature and its three guarantees.
4. **Delivery is at-least-once to the transport and deduplicated at the provider.** The plan says
   "at-most-once via a conditional update" and also "a 5xx retries". Both cannot hold if a crash
   happens between the claim and the status update. The conditional update `queued → sending`
   claims the row, so a concurrent redelivery never sends. A **recovery sweep** on the quarter-hourly
   cron re-enqueues rows left in `sending` or `queued` for more than 15 minutes, and each resend
   carries Resend's `Idempotency-Key` (the delivery id). The provider therefore accepts a resend
   after a crash without delivering a second copy. Rows older than 23 hours are marked `failed`
   (`expired`) rather than resent, because Resend's idempotency window is 24 hours.
5. **The recipient's locale has no stored source yet.** `user_preferences` (plan 23) and
   `organization_settings` (plan 02) do not exist. The language picker writes a cookie
   (`src/components/app/shell/locale-cookie.ts`) that no queue handler or cron can read. The
   resolver follows `negotiate()`'s chain and reads stored values through one seam, which falls back
   to `en` for notification email until one of those tables exists. Auth emails run inside a request
   and use the request's negotiated locale. For `verify-email` and `reset-password` that is the
   recipient's own request. For `organization-invitation` it is the inviter's, which is the closest
   signal available for someone who has no account yet. **This changes the expected outcome on #210 (accepted by the maintainer, A1): a
   Polish-preferring member gets English notification email until `user_preferences.locale`
   exists.** See A1.

**Alternatives considered and rejected.**

- _The Resend SDK._ BND-23 (a hand-rolled REST client, like Polar) and the dependency freeze in
  `docs/SPEC.md` §3.1 both rule it out.
- _Resend-hosted templates._ Copy would live outside the EN + PL catalogue, and `AGENTS.md` requires
  all copy in the catalogue.
- _Adding `user_preferences` here so the locale is right on day one._ Plan 23 owns that table.
  `src/server/db/schema.ts` says a table sketched by the wrong owner "generates a migration that has
  to be reverted".
- _Storing the recipient address on `email_deliveries`._ The plan requires a salted hash.

**Research (open-source comparators).** Firefly III, Actual Budget and Maybe were the benchmarks.
Firefly III sends notification mail through Laravel templates with per-user locale and per-kind
toggles. Its unsubscribe path requires signing in, which is the mistake the plan calls out
("an unsubscribe link that demands a login is a spam complaint"). Maybe and Actual Budget send only
account-level mail and have no digest. What all three skip, and this spec keeps: the plain-text
part, `List-Unsubscribe-Post` one-click (RFC 8058, which the major mailbox providers require from
bulk senders), and provider-side idempotency.

## 📝 Architecture

```
notify()  ──(immediate kind, email on)──▶ enqueueNotificationEmail (seam, 21-S1)
                                              │ installed by src/server/email/install.ts
                                              ▼
                     createNotificationEmailEnqueuer
                       ├─ daily cap reached? → email_deliveries(status='deferred')   (digest picks it up)
                       └─ else → email_deliveries(status='queued') + TASKS.send({kind:'notify.email', …})
                                              │
queue() ──▶ handleNotifyEmail ────────────────┘
              1. load delivery (scoped) + its notification; ids must agree, otherwise the handler throws and the message goes to the DLQ
              3. claim: queued → sending (conditional update; 0 rows → already handled, ack)
              4. read address, set to_hash from it, check suppression; resolve locale, render, sign token
              5. sendEmail(…, Idempotency-Key = delivery id)
                   2xx → 'sent' + provider_message_id · 4xx → 'failed' + code (ack) · 5xx/network → back to 'queued', retry

scheduled('*/15 * * * *') ──▶ runEmailRecovery
              'sending' or 'queued' older than 15 min and younger than 23 h → back to 'queued' + TASKS.send
              older than 23 h → 'failed' (error_code 'expired')

scheduled('0 3 * * *') ──▶ runDigest   (sends in production; dry run with logged counts elsewhere)
              per workspace × member: digestible unread rows of the last 24 h with digest pref on
              + rows whose delivery was 'deferred' by the cap → one email_deliveries row
              (dedupe_key 'digest:YYYY-MM-DD') → same notify.email path; deferred rows → 'digested' once sent

POST /api/webhooks/resend ──▶ verifyWebhook (22-S1's verifier, svix-* headers) → update delivery by tags
              email.bounced (permanent) / email.complained → email_suppressions + delivery status
GET /unsubscribe?t=…  (page, no session)      ─┐
POST /api/unsubscribe?t=… (RFC 8058 one-click) ─┴─▶ applyUnsubscribe(token) → notification_prefs
```

### Modules and owners (`docs/SPEC.md` §8)

| Path                                                          | Owns                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/email/send.ts`                                    | `sendEmail({ to, subject, html, text, headers, idempotencyKey, tags })` → `{ ok: true, providerMessageId } \| { ok: false, kind: 'rejected' \| 'retryable' \| 'no-provider', status? }`. It never throws, and injects `fetch`. Masking and "no URL in logs" are lifted from `createAuthEmailer` |
| `src/server/email/render.ts`                                  | `renderEmail(element)` → `{ html, text }` via `render()` twice, from `@react-email/components`                                                                                                                                                                                                  |
| `src/server/email/templates/layout.tsx`                       | The shared layout: header, footer, optional unsubscribe link. No template can leave out the footer                                                                                                                                                                                              |
| `src/server/email/templates/{notification,digest,auth}.tsx`   | One component per message family                                                                                                                                                                                                                                                                |
| `src/lib/notifications/render-copy.ts`                        | `renderCopyParams(locale, params, digitsOf)`: turns 21-S1's `CopyParam`s (money, ISO date, number, string) into display strings. Pure, and has no server imports, so `21-S3`'s `notification-item` reuses it. That is its money invariant ("one payload, two surfaces, one number")             |
| `src/server/email/locale.ts`                                  | `resolveRecipientLocale(scope, userId)`: `negotiate({ user, workspace, acceptLanguage: null })` over a stored-locale seam that returns `null` today (A1)                                                                                                                                        |
| `src/server/email/unsubscribe-token.ts`                       | Signing and verifying the versioned token (API Contracts)                                                                                                                                                                                                                                       |
| `src/server/email/recipient-hash.ts`                          | `hashRecipient(address, salt)`: HMAC-SHA-256 keyed by the salt over `lowercase(trim(address))`, hex                                                                                                                                                                                             |
| `src/server/email/enqueue.ts` + `install.ts`                  | The real `NotificationEmailEnqueuer` and the side-effect module that installs it, imported by the Worker entry beside `#/server/notify/install`                                                                                                                                                 |
| `src/server/queue/handlers/notify-email.ts`                   | The handler above                                                                                                                                                                                                                                                                               |
| `src/server/cron/digest.ts`                                   | `runDigest(args)` on the nightly branch                                                                                                                                                                                                                                                         |
| `src/server/cron/email-recovery.ts`                           | `runEmailRecovery(args)` on the quarter-hourly branch: requeues stale `sending`/`queued` rows and expires ones older than 23 h                                                                                                                                                                  |
| `src/server/repos/email-deliveries.ts`                        | Tenant-scoped through `scope.ts`, Zod-parsed a second time                                                                                                                                                                                                                                      |
| `src/server/repos/email-suppressions.ts`                      | **Platform data** (A2), the same carve-out shape as `src/server/repos/billing-events.ts`                                                                                                                                                                                                        |
| `src/routes/api/webhooks/resend.ts`                           | Webhook endpoint                                                                                                                                                                                                                                                                                |
| `src/routes/api/unsubscribe.ts`, `src/routes/unsubscribe.tsx` | One-click endpoint and confirmation page                                                                                                                                                                                                                                                        |

**What is reused, not rebuilt:** `verifyWebhook` from `src/server/billing/webhook-verify.ts` (not a
second verifier). The raw-body-first ordering from `src/routes/api/webhooks/polar.ts`. `negotiate()`
and `createTranslator` from `src/lib/i18n`. `formatMoney` from `src/lib/money/format.ts` with
`currencies.digits` from `src/server/catalog` (`docs/MONEY.md` §1.2, §7.2). 21-S1's
`notificationCopy()`, `NOTIFICATION_KINDS` (`titleKey`, `bodyKey`, `deepLink`, `digestible`) and
`resolvePrefs`.

**Import direction.** `src/server/email/**` imports from `#/server/notify` (the registry and the
seam) and never the other way round. `install.ts` is the only place the two meet, following
21-S1's `install.ts`.

## 📝 Data Model

One additive migration (Phase 2), approved on #210 (maintainer decision 3). Generated with
`pnpm db:generate`, never hand-edited.

**`email_deliveries`**: tenant table, `organization_id` leading every composite index
(`docs/SPEC.md` §6.1).

| Column                  | Type                                                      | Notes                                                                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | `id()`                                                    | Also the `Idempotency-Key` and a Resend tag                                                                                                                                                                                                                                        |
| `organization_id`       | `organizationId()`                                        |                                                                                                                                                                                                                                                                                    |
| `user_id`               | text → `user.id` cascade                                  |                                                                                                                                                                                                                                                                                    |
| `kind`                  | text, `CHECK`                                             | A notification kind id, or `digest`                                                                                                                                                                                                                                                |
| `notification_id`       | text → `notifications.id`, nullable, `ON DELETE SET NULL` | Set for an immediate email; null for a digest. **Widens the plan's column list** (A5)                                                                                                                                                                                              |
| `dedupe_key`            | text not null                                             | `notification:{id}` or `digest:{YYYY-MM-DD}`. **Widens the plan** (A5)                                                                                                                                                                                                             |
| `to_hash`               | text nullable                                             | `hashRecipient` of the address actually used, written by the handler at send time, so a changed address is checked under its new hash. Never the address                                                                                                                           |
| `provider_message_id`   | text nullable                                             | Resend's `id`                                                                                                                                                                                                                                                                      |
| `status`                | text, `CHECK`                                             | `queued \| sending \| sent \| failed \| deferred \| digested \| suppressed \| bounced \| complained`. The plan's five, plus `failed` (which the plan uses without listing), `sending` (the claim), `deferred` (the cap) and `digested` (a deferred row a digest has since carried) |
| `error_code`            | text nullable                                             | Provider HTTP status or error `name`. Never a message body                                                                                                                                                                                                                         |
| `created_at`, `sent_at` | timestamps                                                |                                                                                                                                                                                                                                                                                    |

Indexes: unique `(organization_id, user_id, dedupe_key)`, so a second enqueue of one notification or
a second digest on the same day conflicts and is dropped. Also `(organization_id, created_at)` for
the daily cap count.

**`email_suppressions`**: platform table (A2).

| Column       | Type          | Notes                               |
| ------------ | ------------- | ----------------------------------- |
| `email_hash` | text PK       | Same function and salt as `to_hash` |
| `reason`     | text, `CHECK` | `bounced \| complained`             |
| `created_at` | timestamp     |                                     |

**Sensitive data.** No address is stored anywhere new. `to_hash` uses a per-environment salt
(`EMAIL_HASH_SALT`, a secret that is never rotated, because rotating it breaks bounce correlation).
`docs/SECURITY.md` §4 gets the line the plan asks for. The address is read from Better Auth's `user`
row at send time through the members repository.

**Rollback.** Both tables are new, and nothing reads them if the code is reverted. A rollback leaves
unused tables and no broken reader.

## 📝 API Contracts

### Queue message (additive to `taskMessageSchema`)

```ts
z.strictObject({
  kind: z.literal('notify.email'),
  organizationId: z.string().min(1).max(64),
  deliveryId: z.string().min(1).max(64),
})
```

The message carries ids only, following the `billing.event` precedent: the delivery row is the
record, and a copy in the message could disagree with it. Deploy the consumer before the enqueuer is
installed. Phase 2 adds the consumer and Phase 4 installs the enqueuer, so the phases enforce the
order (`BACKWARD_COMPATIBILITY.md` → Queue messages).

### Transport

`POST {EMAIL_API_URL}` (Resend `/emails`) with `from`, `to`, `subject`, `html`, `text`, `headers`,
`tags: [{ name: 'delivery', value: id }, { name: 'org', value: organizationId }]` and the
`Idempotency-Key: {deliveryId}` request header. How responses are classified: `2xx` → sent. `429`
and `5xx` and network errors → retryable. Any other `4xx` → rejected, which is terminal.
`EMAIL_API_KEY` unset → `no-provider`, handled as the auth emailer handles it today: a loud `warn`,
and the row goes back to `queued`. The recovery sweep re-enqueues it only when a provider is
configured, so a key enabled within 23 hours delivers the backlog, and anything older expires to
`failed` instead of arriving a day late.

### Unsubscribe token (permanent public contract)

`v1.{base64url(json)}.{base64url(hmacSha256(key, 'v1.' + base64url(json)))}` where `json` is
`{ "u": userId, "o": organizationId, "s": kindId | "digest", "e": expiryEpochSeconds }`. Tokens
are signed with `UNSUBSCRIBE_TOKEN_SECRET`. The verifier also accepts
`UNSUBSCRIBE_TOKEN_SECRET_PREVIOUS` when it is set, so the key can be rotated (for example after a
leak) without a `v2` and without breaking links still in inboxes. The token expires 180 days after it is signed. It is compared in constant
time. Verification checks the version, the signature and the expiry, **and** checks that `u` is
still a member of `o`, then acts only on `(o, u, s)`. A token for workspace B cannot change anything
in A (tenant isolation case). **The `v1` prefix is permanent.** If the shape ever changes, it becomes
`v2` and the verifier keeps accepting `v1` until the last `v1` link has expired
(`BACKWARD_COMPATIBILITY.md` → Public URLs). The token sits in a query string, so it reaches
Cloudflare's request logs. That is accepted: it can do nothing except turn one kind of email off for
the person it names. Our own logger never records the query string of either unsubscribe route.

Effect: `s = kind` sets `email = false` for that kind. `s = digest` sets `digest = false` for every
digestible kind. `in_app` is never touched. The write is an upsert through the notifications
repository's preference writer. Applying it twice gives the same result.

### Routes

| Route                                           | Auth                        | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /unsubscribe?t=`                           | none                        | Renders **confirm** (what will stop, with one button), **done** or **invalid**. **A GET never changes anything**, because mail scanners prefetch links and a GET that unsubscribes would turn every security gateway into an unsubscribe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `POST /unsubscribe` (form action via server fn) | none                        | Validates `t` with Zod, applies it, re-renders **done**. An invalid or expired token renders **invalid** (200, no detail)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /api/unsubscribe?t=`                      | none                        | RFC 8058 one-click (`List-Unsubscribe=One-Click` body). `200` on success, `400` with no body on an invalid token. Never redirects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /api/webhooks/resend`                     | Standard Webhooks signature | Raw body read first. Headers `svix-id`/`svix-timestamp`/`svix-signature` are mapped onto `WebhookHeaders` inside the route (the verifier and `webhookHeadersOf` stay unchanged). `401` with no body on a bad signature. `email.bounced` with `bounce.type = 'Permanent'` and `email.complained` do two independent writes. (1) The suppression, keyed by the hash of the payload's `to` address, is always inserted, because the signed payload is the authority on what happened to an address. (2) The delivery status is updated only when the `org` tag, the `delivery` tag **and** `provider_message_id` all match one row, and nothing is updated otherwise. Any other type is acknowledged `200` and ignored. The handler is idempotent and inline (A6) |

Headers on every notification and digest email: `List-Unsubscribe: <{APP_URL}/api/unsubscribe?t=…>`
and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The footer links to `/unsubscribe?t=…`.
**Auth emails carry neither header.** A password reset is not something a person can opt out of
(A4).

### Configuration

New names in `.dev.vars.example` and `worker-configuration.d.ts`, following the secret-vs-var split
in the file's header: secrets `RESEND_WEBHOOK_SECRET`, `UNSUBSCRIBE_TOKEN_SECRET`,
`UNSUBSCRIBE_TOKEN_SECRET_PREVIOUS` and `EMAIL_HASH_SALT`, all optional. A missing secret makes its feature a loud no-op, never a crash: the
webhook answers `503`, and the enqueuer is not installed and logs why. No var is added.
`EMAIL_API_URL` and `EMAIL_FROM` already exist.

## 📝 UI/UX

**Email.** The shared layout has a single column, up to 600 px wide, and uses the system font stack.
It declares `color-scheme: light dark` and has a `prefers-color-scheme: dark` block, because dark
rendering is the regression the plan names. It has a visible text wordmark and no image logo
(blocked images are common). The CTA link is at least 44 px high. Every image and link has
meaningful text. Notification email: title (the kind's `titleKey`), body (`bodyKey`), one CTA to
`APP_URL + deepLink(payload)`, then the footer (why you got this, and unsubscribe). Digest: heading,
intro, one list item per notification (title, body, link), grouped by kind, then the footer. The
digest shows **no summed totals** (A3). The plain-text part has the same content in the same order,
with URLs written out.

**`/unsubscribe` page.** A public route outside `_app`, like `invite.$invitationId.tsx`. It has the
marketing shell's tokens and no app navigation. There are three states: confirm (heading, a
sentence naming the topic and the workspace, one primary button), done (heading, sentence, a note
that in-app notifications are unaffected) and invalid (heading, sentence, a "Sign in" link). Focus
goes to the `h1` after the POST. The result is announced by a `role="status"` region. The button
and the link are reachable by keyboard and at least 44 px. The page has both themes and passes axe
with no `serious` or `critical` findings at 360 / 1280 / 2560 px. AA is the gate
(`docs/ACCESSIBILITY.md`, `docs/SPEC.md` §10), and this spec claims nothing beyond it. The link to
full preferences is left out until `/settings/notifications` (`21-S3`) exists (A7).

Mockups (illustrative, static): `assets/transactional-email-resend/mockup-01-unsubscribe.html` and
`assets/transactional-email-resend/mockup-02-notification-email.html`.

## 📝 Visual change expected

- **New route `/unsubscribe`**, states confirm / done / invalid, **light and dark**, **360 / 1280 /
  2560 px**, plus the focused button in confirm. Evidence goes to `.ai/qa/artifacts_*/`, never the
  repository.
- **Email HTML** (not a route): the `budget.exceeded` notification email, the digest with three
  items, and `reset-password`, each captured at 360 and 1280 px in a light and a dark client
  (`prefers-color-scheme` emulated), from `renderEmail` output written to a scratchpad.
- No existing screen changes.

## 📝 Copy

Every string is new. The implementation adds each key to `src/lib/i18n/messages/en.ts` **and**
`pl.ts` in the same change (skill `i18n-messages`). Plurals use the plural machinery. `{app}` is
filled from `app.name`.

| Key (`en`)                                        | English text                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `email.layout.footer.reason`                      | You are getting this because you are a member of {workspace} on {app}.                                                          |
| `email.layout.footer.reasonAccount`               | You are getting this because of activity on your {app} account.                                                                 |
| `email.layout.footer.unsubscribe`                 | Stop these emails                                                                                                               |
| `email.notification.action`                       | Open in {app}                                                                                                                   |
| `email.digest.subject`                            | `{ one: '{count} update from {workspace}', other: '{count} updates from {workspace}' }`                                         |
| `email.digest.heading`                            | Your daily summary                                                                                                              |
| `email.digest.intro`                              | Here is what happened in {workspace} in the last day.                                                                           |
| `email.auth.greeting`                             | Hi {name},                                                                                                                      |
| `email.auth.singleUse`                            | This link works once and expires soon.                                                                                          |
| `email.auth.verifyEmail.subject`                  | Confirm your {app} address                                                                                                      |
| `email.auth.verifyEmail.lead`                     | Confirm this address to finish setting up your {app} account.                                                                   |
| `email.auth.verifyEmail.action`                   | Confirm address                                                                                                                 |
| `email.auth.resetPassword.subject`                | Reset your {app} password                                                                                                       |
| `email.auth.resetPassword.lead`                   | Use the button below to choose a new password. If you did not ask for this, ignore this email and your password stays as it is. |
| `email.auth.resetPassword.action`                 | Choose a new password                                                                                                           |
| `email.auth.invitation.subject`                   | You are invited to {workspace} on {app}                                                                                         |
| `email.auth.invitation.lead`                      | {workspace} has invited you to join them on {app}.                                                                              |
| `email.auth.invitation.action`                    | Accept invitation                                                                                                               |
| `notifications.kind.budgetThresholdCrossed.label` | Budget thresholds                                                                                                               |
| `notifications.kind.budgetExceeded.label`         | Spent budgets                                                                                                                   |
| `notifications.kind.recurringDueSoon.label`       | Upcoming bills                                                                                                                  |
| `notifications.kind.recurringOverdue.label`       | Overdue bills                                                                                                                   |
| `notifications.kind.goalReached.label`            | Reached goals                                                                                                                   |
| `unsubscribe.meta.title`                          | Unsubscribe                                                                                                                     |
| `unsubscribe.topic.digest`                        | the daily summary                                                                                                               |
| `unsubscribe.confirm.title`                       | Stop these emails?                                                                                                              |
| `unsubscribe.confirm.body`                        | You will stop getting emails about {topic} from {workspace}.                                                                    |
| `unsubscribe.confirm.action`                      | Unsubscribe                                                                                                                     |
| `unsubscribe.done.title`                          | You are unsubscribed                                                                                                            |
| `unsubscribe.done.body`                           | You will no longer get emails about {topic} from {workspace}. Notifications inside the app are not affected.                    |
| `unsubscribe.invalid.title`                       | This link does not work                                                                                                         |
| `unsubscribe.invalid.body`                        | It may have expired or been copied incompletely. Sign in to change which emails you get.                                        |
| `unsubscribe.invalid.signIn`                      | Sign in                                                                                                                         |

The five `.label` keys name a kind as a topic. `21-S3`'s preference matrix will reuse them as row
headers, so they are not unsubscribe-specific. Notification subjects reuse the existing
`notifications.kind.*.title` keys, so no subject key is added per kind. The English strings from
`src/server/auth/email.ts` are replaced, not copied, and that file keeps no English copy.

## 📝 Edge Cases & Failure Scenarios

| Scenario                                              | Behaviour                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queue redelivers a message                            | The claim `queued → sending` affects 0 rows, so the message is acknowledged and nothing is sent                                                                                                                                                                                                                                                                   |
| Worker dies between the claim and `sent`              | The row stays in `sending`, and a redelivered message fails the claim and is acknowledged. After 15 minutes the recovery sweep puts it back to `queued` and enqueues it again. The resend carries the same `Idempotency-Key`, so if Resend had already accepted it, no second copy is delivered. **At most one email is delivered, and a crash does not lose it** |
| Resend 5xx / 429 / network                            | Row back to `queued`, `message.retry()`. After `max_retries` the message goes to the DLQ, the row stays `queued`, and the recovery sweep picks it up again until it is 23 hours old                                                                                                                                                                               |
| Resend 4xx (bad address, domain unverified)           | `failed` + `error_code`, message acknowledged. It is never retried                                                                                                                                                                                                                                                                                                |
| Address suppressed                                    | `suppressed`, no provider call. The in-app row already exists, because `notify` wrote it first                                                                                                                                                                                                                                                                    |
| Member left the workspace before the handler runs     | The membership check fails, so the row is marked `failed` with `error_code = 'not-member'` and the message is acknowledged                                                                                                                                                                                                                                        |
| Message's `organizationId` disagrees with the row     | The handler throws, so the message retries and then goes to the DLQ (the plan's tenant rule). It is logged with both ids and no address                                                                                                                                                                                                                           |
| Notification deleted before send                      | `notification_id` is null, so the row is marked `failed` with `error_code = 'gone'` and acknowledged                                                                                                                                                                                                                                                              |
| `EMAIL_API_KEY` unset                                 | `warn` once per message and the row stays `queued`. The recovery sweep does not re-enqueue while no provider is configured. Rows older than 23 hours expire to `failed` with `error_code = 'expired'`                                                                                                                                                             |
| Daily cap reached (`WORKSPACE_DAILY_EMAIL_CAP = 200`) | `error`-level log once per workspace per day. Later immediates are written as `deferred`. The next digest carries them whatever the person's `digest` preference is, because they asked for these by email, and marks them `digested`                                                                                                                             |
| Digest with nothing to send                           | No row and no email                                                                                                                                                                                                                                                                                                                                               |
| Digest runs twice on a day                            | The unique `digest:{date}` makes the second run a no-op                                                                                                                                                                                                                                                                                                           |
| Token expired, tampered or wrong version              | The **invalid** state, which does not say which check failed                                                                                                                                                                                                                                                                                                      |
| Token for a workspace the person left                 | Invalid                                                                                                                                                                                                                                                                                                                                                           |
| Webhook whose tags match no delivery                  | `200`. The suppression is still inserted (keyed by the hash of the signed payload's `to`), and no delivery row is touched                                                                                                                                                                                                                                         |
| Row older than 23 hours still `queued` or `sending`   | The sweep marks it `failed` with `error_code = 'expired'`. It is never sent a day late, and never outside Resend's idempotency window                                                                                                                                                                                                                             |
| A permanent bounce that was a provider mistake        | The address stays suppressed. There is no self-service or admin path to remove a suppression in this stage (A12)                                                                                                                                                                                                                                                  |
| Auth email while Resend is down                       | `'failed'` returned, logged, never thrown (the existing guarantee)                                                                                                                                                                                                                                                                                                |
| Payee or budget name with `<script>`                  | React escapes it in HTML. The text part has no markup                                                                                                                                                                                                                                                                                                             |
| Zero-decimal currency (JPY)                           | `formatMoney` at `digits = 0` gives no separator (`docs/MONEY.md` §1.2)                                                                                                                                                                                                                                                                                           |

## 📝 Risks & Impact Review

- **Blast radius.** A new outbound channel to real inboxes, which is `risk-high` on #210 for good
  reason. The main safety: the enqueuer is installed only in Phase 4, after unsubscribe and bounce
  suppression are already on `develop` and together with the per-workspace cap and the recovery
  sweep. The digest sends only where `ENVIRONMENT === 'production'`, because staging registers
  `0 3 * * *` (`wrangler.jsonc`) and would otherwise email from a database full of fixtures. Elsewhere
  it runs as a dry run and logs its counts (A8).
- **Auth path.** `createAuthEmailer` is re-pointed at `sendEmail` + templates. Its three guarantees
  and `src/server/auth/__tests__/email.test.ts` stay. Tests are extended, never narrowed. Render
  errors are caught inside `send`, so a template bug returns `'failed'` and never throws inside
  Better Auth.
- **workerd.** React Email in workerd has been verified from package metadata (#210's analysis: the
  `workerd` export condition of `@react-email/render@2.0.6`). Phase 1 step 1.3 proves it with a
  workerd-project test and `pnpm build` before anything builds on it. If it fails, the phase stops
  and reports, and does not reach for a workaround.
- **Compatibility surfaces** (`BACKWARD_COMPATIBILITY.md`): the queue message is additive, and the
  consumer already acknowledges unknown kinds. There are two new public URLs, `/unsubscribe` and
  `/api/unsubscribe`, whose token is versioned. The new webhook endpoint is new surface. The
  migration is additive.
- **Rollback.** Revert the phase. Before reverting Phase 4, run `setNotificationEmailEnqueuer(null)`
  (or a revert of `install.ts`), which stops sending without touching the data. `deferred` or
  `queued` rows left behind are ignored by older code.
- **OPEN-8.** `docs/SECURITY.md:172` already lists Resend as a sub-processor. Confirming that this
  satisfies OPEN-8 is a human call, and it blocks launch, not the build (the plan's own wording).

## 📝 Resolved assumptions (autonomous defaults)

| #   | Question                                                                                                                                  | Applied default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Why                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Where does the recipient's locale come from, when `user_preferences` and `organization_settings` do not exist and the picker is a cookie? | `resolveRecipientLocale` runs `negotiate()` over a stored-locale seam that returns `null` today, so notification and digest email is `en` until plan 23 (`user_preferences.locale`) or plan 02 (`organization_settings.locale`) lands, and wiring it is then one line. Auth emails use the request's negotiated locale (cookie + `Accept-Language`). **Confirmed by the maintainer on PR #344 (2026-09-19)**: this falls short of #210's expected outcome for Polish members until then, and that is accepted. The alternative is to pull `user_preferences` forward into this stage, which is a schema that plan 23 owns | The most reversible option that does not create another plan's table. The render path is fully locale-aware and tested in both locales, so only the stored input is missing                        |
| A2  | `email_suppressions` has no `organization_id`: is a platform-data table outside the tenant base acceptable?                               | Yes. It is modelled on `billing-events.ts`'s documented carve-out: bare `Database` writes reachable only from the webhook, and a read-by-hash reachable only from the queue handler. The plan already defines it without a tenant column. **Confirmed by the maintainer on PR #344 (2026-09-19)**, which clears the tenant-scoping Ask First for this table                                                                                                                                                                                                                                                               | Hard bounces and complaints are facts about an address, not a workspace. Per-workspace suppression would keep emailing a complained address from a second workspace, which hurts sender reputation |
| A3  | The plan's money case "the digest's per-kind totals equal the sum of the amounts": what does the digest sum?                              | Nothing. The digest lists each notification with its own amount. The invariant becomes "each digest line's amount string equals the same notification rendered alone"                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Summing the spend of different budgets, or amounts in different currencies, is not a meaningful quantity, and mixing currencies without FX breaks `docs/MONEY.md` §2                               |
| A4  | "Every email carries `List-Unsubscribe`": the auth emails too?                                                                            | No. Only notification and digest emails. Auth emails get the account footer line and no unsubscribe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | A person cannot opt out of a password reset, and a header that pretends they can is misleading                                                                                                     |
| A5  | May `email_deliveries` widen the plan's column list with `notification_id`, `dedupe_key` and the extra statuses?                          | Yes. The plan is updated in Phase 1 step 1.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The tenant check, the digest dedupe and the cap cannot work without them. The migration is still additive and is the same migration                                                                |
| A6  | The Resend webhook: store-then-enqueue like Polar, or inline?                                                                             | Inline, keeping Polar's raw-body → verify ordering. Processing is two idempotent indexed writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Polar enqueues because applying a billing event is slow and not idempotent. Neither is true here, and a third table plus a queue kind would be surface without a reason                            |
| A7  | The confirmation page's link to full preferences                                                                                          | Left out until `21-S3` ships `/settings/notifications`. The invalid state links to sign-in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A link to a route that does not exist is a 404 the person walks into                                                                                                                               |
| A8  | The digest on staging                                                                                                                     | It sends only when `ENVIRONMENT === 'production'`. Anywhere else it runs in full as a dry run: it selects and renders, logs per-workspace counts, and neither writes a row nor enqueues                                                                                                                                                                                                                                                                                                                                                                                                                                   | `worker.ts` already notes that staging registers only the nightly slot so that fixture data does not send real email. A dry run still exercises the query and the render path there                |
| A9  | The digest window and timezone                                                                                                            | The 24 h before the cron's `scheduledTime`, in UTC                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | No per-user timezone is stored (plan 23). A rolling window never drops or doubles a row across days                                                                                                |
| A10 | Unsubscribe token lifetime                                                                                                                | 180 days                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | The plan asks for an expiring token. 180 days covers an email read months later, and the invalid state gives a way forward                                                                         |
| A11 | Split the spec in two, with Phase 1 (rendering + auth migration) separate from notification delivery, as the scope review recommended?    | Kept as one spec. Phase 1 is independently shippable anyway and can merge on its own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Maintainer decision 2 on #210 puts the auth migration in `21-S2`, and #210 is the one ticket that schedules it. Splitting would need a second issue for the same stage                             |
| A12 | A way to remove a suppression                                                                                                             | None in this stage. It is a known limitation, recorded in the plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Removing a suppression is an operator action with abuse potential, and it belongs with the admin console (plan 25), not with a public route                                                        |

## 📋 Phasing

Each phase is one autonomous run with at most one migration (`.ai/skills/om-spec-writing` →
Phasing), and each leaves `develop` releasable. **Nothing is emailed about a notification before
Phase 4**, and when that phase installs the enqueuer, unsubscribe and bounce suppression are already
in place and the cap and recovery sweep arrive with it.

1. **Transport, render, templates, auth migration.** No schema and no new public surface. Sends
   only the three auth emails that are sent today, now rendered with React Email in the request's
   locale.
2. **Store and handler.** The migration, the two repositories, `notify.email` and its handler, and
   the notification template. Not installed.
3. **Unsubscribe and bounces.** The token, both unsubscribe routes, the page, the Resend webhook and
   suppression. These are all public surface and have nothing to act on yet.
4. **Go-live.** Headers and footer link, the daily cap, the recovery sweep, and the enqueuer
   installed.
5. **Digest.** The nightly digest, including deferred rows.

## 📋 Implementation Plan

### Phase 1: Transport, render, templates, auth migration

1. **Reconcile the plan.** Edit `docs/plans/21-notifications.md` → 21-S2: set **Owned paths** to
   the paths in this spec's module table, change **Server → Templates** to React Email, and record
   A3–A6, A12 and the recovery sweep in its Server, Data and Money invariant sections. _Check:_ the
   doc diff only. The gate is still green.
2. **`src/server/email/send.ts`**, test first: 2xx / 4xx / 429 / 5xx / network / no-provider
   classification, `Idempotency-Key` and tags forwarded, recipient masked in every log line, no URL
   or body logged, never throws. _Check:_ `src/server/email/__tests__/send.test.ts`.
3. **`render.ts` + `layout.tsx` in workerd.** A workerd-project test (ADR 0015) renders the layout
   and asserts that the HTML contains the footer and that the text part contains no `<`. `pnpm
build` passes. **Stop the phase if either fails.** _Check:_ `render.test.ts` in the workerd
   project.
4. **`src/lib/notifications/render-copy.ts`**: formats `MoneyParam` with `formatMoney` at the
   currency's `digits`, ISO dates with `formatCalendarDate`, and passes numbers and strings through.
   _Money-invariant cases:_ `en` and `pl` give different strings from identical integers, and
   zero-decimal JPY has no separator. _Check:_ unit test.
5. **Auth templates and migration.** `templates/auth.tsx` for the three kinds, and
   `createAuthEmailer` re-pointed at `renderEmail` + `sendEmail` with a `locale` argument taken from
   the request (`negotiateLocaleFrom`, reading the cookie and `Accept-Language`) in `config.ts` and
   `fns/members.ts`. Keys: the `email.auth.*` keys and `email.layout.footer.reasonAccount`, EN + PL.
   _Check:_ `src/server/auth/__tests__/email.test.ts` extended (both locales, `<script>` in a name,
   no token in logs, `'skipped-no-provider'`, never throws on a render error). The i18n parity test
   passes. **Screens changed:** the three auth email HTMLs (evidence at 360/1280, light/dark).

### Phase 2: Store and handler (not installed)

1. **Migration.** `email_deliveries` and `email_suppressions` in `src/server/db/schema.ts`,
   followed by `pnpm db:generate`. _Check:_ exactly one new file under `drizzle/`, and the gate's
   diff check is clean.
2. **`repos/email-deliveries.ts`**: `insertDelivery` (conflict → `null`), `claimDelivery`
   (conditional `queued → sending`), `markDelivery` (sets status, `to_hash`, provider id,
   `error_code`), `countSince(scope, since)`, `listStale(scope, olderThan, notOlderThan)` and
   `listDeferredSince`. _Tenant-isolation case:_ A cannot read, claim, mark or list B's deliveries,
   and the unique key is scoped so that both workspaces may hold `digest:2026-09-20`.
3. **`repos/email-suppressions.ts`**: `isSuppressed(db, hash)` and `suppress(db, hash, reason)`,
   with the carve-out header. _Tenant-isolation case:_ none applies (platform data). The file header
   says so and says why, and a test asserts the module exports no scoped reader.
4. **`recipient-hash.ts`** (HMAC-SHA-256, salt as key). _Check:_ a known vector, and case and
   whitespace folding.
5. **`notification.tsx` template.** Subject = the kind's `titleKey`, body = `bodyKey`, CTA =
   `deepLink`. Keys: `email.notification.action`, `email.layout.footer.reason` and
   `email.layout.footer.unsubscribe`, EN + PL. _Money-invariant cases_ in `render.test.ts` and
   `money-invariants.test.ts`: the HTML and text parts carry byte-identical amount strings; an `en`
   and a `pl` recipient of the same `budget.exceeded` payload get locale-correct amounts; no raw
   `amountMinor` integer appears in either part; `<script>` in `budgetName` is escaped.
6. **`notify.email` message and `handleNotifyEmail`**, registered in `worker.ts` beside
   `handleBillingEvent`. _Check:_ `notify-email.test.ts`: redelivery gives one send; 5xx means
   requeue + retry; 4xx is terminal; suppressed means no provider call and the in-app row is intact;
   `to_hash` is written from the address actually used; an org mismatch throws; a non-member is
   marked `failed`. _Tenant-isolation case:_ a message naming org B with A's delivery id loads
   nothing.

### Phase 3: Unsubscribe and bounces (no sending yet)

1. **`unsubscribe-token.ts`**: sign and verify as in API Contracts, including the
   `_PREVIOUS` rotation key. _Check:_ round trip, tampering, expiry, version, constant-time compare,
   a token signed with the previous key still verifying. _Tenant-isolation case:_ a token for B
   cannot change A's preferences, including for a person who is a member of both.
2. **`POST /api/unsubscribe`** (RFC 8058). _Check:_ a route test for 200 / 400 and idempotency, and
   that the logger never records the query string.
3. **`/unsubscribe` page** with the confirm / done / invalid states and a GET that never changes
   anything. Keys: `unsubscribe.*` and the five `notifications.kind.*.label` keys, EN + PL.
   _Check:_ `e2e/unsubscribe.spec.ts` (keyboard path, focus on `h1` after submit, axe with no
   `serious` or `critical` findings at 360/1280/2560, both themes, console silent). **Screens
   changed:** `/unsubscribe` (new).
4. **`POST /api/webhooks/resend`**: raw body, svix headers mapped onto `WebhookHeaders`,
   `verifyWebhook` with `RESEND_WEBHOOK_SECRET`, and the two independent writes from API Contracts.
   Before anything else, confirm Resend's current header names, tag echo and `bounce.type` values
   against its documentation, and record the source in the route's docblock. _Check:_ route tests
   for a bad signature giving 401, a permanent bounce giving a suppression and `bounced`, a
   complaint giving a suppression and `complained`, a transient bounce being ignored, a redelivery
   being a no-op, and mismatched tags or `provider_message_id` leaving every delivery unchanged
   while the suppression still lands.
5. **Docs.** `docs/SECURITY.md` §4: the `to_hash` line, the new secrets and the query-string
   token note. `docs/DEPLOY.md`: the webhook URL and the secret setup.

### Phase 4: Go-live

1. **Headers and footer link** from the notification template. _Check:_ render test asserts
   `List-Unsubscribe`, `List-Unsubscribe-Post` and a footer link whose token verifies.
2. **Daily cap** (`WORKSPACE_DAILY_EMAIL_CAP`) in the enqueuer: over the cap means `deferred` and one
   `error` log per workspace per day. _Check:_ enqueuer test.
3. **`runEmailRecovery`**, wired into the `*/15 * * * *` branch over the same scopes as the two
   sweeps already there: stale `sending` and `queued` rows between 15 minutes and 23 hours are
   requeued (only with a provider configured), and older ones expire. _Check:_
   `src/server/cron/__tests__/email-recovery.test.ts`: a crash after the claim is resent once with
   the same `Idempotency-Key`; no provider means no requeue; a 24-hour-old row expires.
4. **Install the enqueuer** (`src/server/email/install.ts`, imported by the Worker entry). Skip
   installation, and log why, when `UNSUBSCRIBE_TOKEN_SECRET` or `EMAIL_HASH_SALT` is unset.
   _Check:_ an install test in 21-S1's style: in a module graph rebuilt with `vi.resetModules()`,
   `isNotificationEmailEnqueuerInstalled()` flips from `false` to `true`. An enqueuer test checks
   that the row and the message agree.

### Phase 5: Digest

1. **`digest.tsx`**. Keys: `email.digest.*`, EN + PL (plural). _Money-invariant case (A3):_ each
   digest line's amount equals the same notification's standalone rendering.
2. **`runDigest`**, wired into the `0 3 * * *` branch. That slot's `CRON_WORK` text keeps naming the
   nightly work that is still owed, so the warning stays honest. It sends in production and runs as
   a dry run elsewhere (A8). _Check:_ `src/server/cron/__tests__/digest.test.ts`: a user with three
   digestible notifications and one immediate one gets one digest with three items; no rows means no
   email; a second run on the same day is a no-op; the `digest` preference is respected; a read row
   is excluded; `deferred` rows are included whatever the preference is and become `digested`; the
   dry run writes nothing.
