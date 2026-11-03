# 0035. Notification and transactional emails contain no amounts or transaction data

Status: accepted
Date: 2026-11-02

## Context

`21-S1` stores notification payloads as integer minor units, currency codes and entity names so the
in-app centre can render them in the reader's locale (`docs/plans/21-notifications.md`, ADR 0006,
`docs/MONEY.md`). The `21-S2` spec (`.ai/specs/2026-09-19-transactional-email-resend.md`) then
designed the email as a second rendering of the same payload: HTML and text would carry
locale-formatted amounts, digest lines would each show their own amount (A3), and the money
invariant was "an email states the same number the app states."

That puts money and transaction rows on a surface that leaves the platform: a mailbox, a forward, a
provider log. Email is also the channel that is easiest to leak and hardest to retract. Staging had
a second, conflicting cut: A8 dry-ran the digest anywhere except production so fixture data would
not send, which is a stripped path rather than the same delivery pipeline with owner-held secrets.

Owner: Rafał Wolak, 2026-11-02.

## Decision

Notification and other transactional emails **are not a money surface**. A mail informs that an
event happened and links into the app. It does not contain:

- integer minor units
- formatted money (any locale, any currency scale)
- payee, account, category, budget, series or goal amounts
- transaction rows or other payload transaction data

The body is the **event name** (the kind's topic label) plus a **deep link** into the app (and the
existing shared footer / unsubscribe chrome). Auth mail (verify, reset, invitation) still carries
no amounts; this record does not change those three kinds' purpose.

In-app notifications remain a money surface. Stored `payload_json` still holds integers and codes
(`docs/MONEY.md`). `renderCopyParams` still formats for the bell and the notification list. Email
templates must not interpolate those params into HTML or text.

**Staging receives full notification delivery** through the same templates and send path as
production. There is no staging-stripped body and no staging-disabled notification flag. When
provider secrets are unset, the existing no-provider behaviour applies (loud skip / queued, never a
crash). **Secrets (Resend and related) are added by the owner.** They are not committed, not printed
in logs, and not pasted into a pull request.

Tests use **synthetic data only**. A fixture amount that exists on the notification row must be
absent from both rendered parts.

This decision binds remaining `21-S2` tickets #480–#484 (parent #479). It does not close them.

## Consequences

- Spec A3 (digest lists each notification's amount) and A8 (digest sends only in production) are
  superseded. The living defaults are A13 and the amended A3 / A8 in
  `.ai/specs/2026-09-19-transactional-email-resend.md`.
- `docs/plans/21-notifications.md` 21-S2's money invariant becomes "email contains no money"; 21-S3
  no longer requires the email template and `notification-item` to print the same amount.
- #480 cannot ship a notification template that renders `bodyKey` / money params. #484 cannot ship a
  digest that lists amounts or a production-only send path.
- `docs/MONEY.md` §7.5 records that email is outside the formatting boundary.
- A later decision that wants amounts in mail needs a new ADR that supersedes this one; it is not
  revived in a ticket.
