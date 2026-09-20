# Execution plan — 21-S2 Phase 1: transport, render, templates, auth migration

Source doc: `.ai/specs/2026-09-19-transactional-email-resend.md`
Issue: #210 (`Implement: 21-S2 — transactional email on Resend with React Email templates, digest and unsubscribe`)
Spec PR: #344 (merged 2026-09-19)

## Goal

Give the tree one way to render email — a Resend transport, a React Email render pair and a shared
layout — and move the three auth emails onto it so the string-concatenated English HTML in
`src/server/auth/email.ts` stops being a second rendering path.

## Scope

This run implements **Phase 1 of five**, and only Phase 1. The spec's own Phasing section and
`.ai/skills/om-spec-writing` → Phasing both say a Phase is the size of one autonomous run, so each
phase ships on its own PR and the spec stays at the `.ai/specs` root with `Status: in-progress`
until the last one lands.

Phase 1 is the one phase that ships **no schema and no new public surface**. The only mail it sends
is the three auth emails that are already sent today, now rendered with React Email in the request's
negotiated locale.

### Non-goals (later phases, explicitly not touched here)

- `email_deliveries` / `email_suppressions`, the migration, and the two repositories (Phase 2).
- The `notify.email` queue message, its handler and the notification template (Phase 2).
- The unsubscribe token, both unsubscribe routes, the page and the Resend webhook (Phase 3).
- `List-Unsubscribe` headers, the daily cap, the recovery sweep and installing the enqueuer
  (Phase 4). **Nothing is emailed about a notification in this phase.**
- The nightly digest (Phase 5).
- `src/server/notify/email.ts` keeps `NOOP_EMAIL_ENQUEUER`. This run does not install anything into
  that seam.

## Implementation Plan

### Phase 1: Reconcile the design documents

`docs/plans/21-notifications.md` → 21-S2 was written before React Email was pinned: it names
`src/server/notify/email/` as the owned directory and "functions of typed data" as the template
technology, and its Data section lists a narrower `email_deliveries` than the spec's. Maintainer
decision 4 on #210 settled the directory, and assumptions A3–A6 and A12 settled the rest. The doc
is corrected before any code leans on it, so the two never disagree on `develop`.

The spec's module table names `renderCopyParams(locale, params, digitsOf)`, but there is no second
currency catalogue to inject: `src/server/catalog` has no `digits`, and `formatMoney` already
resolves the scale through `minorUnitDigits` in `src/lib/money/currencies.ts` (`docs/MONEY.md`
§1.2). Dropping the unused third parameter is a divergence from the design, so it is recorded as an
`## Amendment` in the spec rather than made silently.

### Phase 2: The transport

`src/server/email/send.ts` — one `sendEmail` for every message family, test-first. It never throws,
injects `fetch`, classifies the provider's answer into `sent` / `rejected` / `retryable` /
`no-provider`, and forwards `Idempotency-Key` and Resend tags. The masking rule and the
"no URL, no body in a log line" rule are lifted from `createAuthEmailer`, which is the module this
one replaces the transport half of.

Phases 2 and 4 of the spec are the only callers that pass an idempotency key or tags; the parameters
exist here because the classification and the header-forwarding are what the tests pin, and adding
them later would mean rewriting those tests.

### Phase 3: Render, and the shared layout, inside workerd

`render.ts` calls `@react-email/render`'s `render()` twice on one element — once for HTML, once with
`{ plainText: true }` — so both parts come from the same typed data by construction.
`templates/layout.tsx` is the shared frame no template can leave out.

`@react-email/render@2.0.6` declares a `workerd` export condition, so the runtime is expected to
work; expected is not verified, and this is the step the spec says stops the phase if it fails. The
proof is a `*.workerd.test.ts` (ADR 0015) running inside the real runtime plus a green `pnpm build`.

### Phase 4: Copy parameters into display strings

`src/lib/notifications/render-copy.ts` turns 21-S1's `CopyParam`s into strings a template can print:
`MoneyParam` through `formatMoney` at the currency's own `digits`, an ISO date through
`formatCalendarDate`, numbers and strings through unchanged. It is pure and imports nothing from
`server/`, so `21-S3`'s in-app `notification-item` renders the same payload through the same
function — one payload, two surfaces, one number.

Phase 1 has no notification email to use it, but it is the money seam the notification template in
Phase 2 is built on, and the spec puts it here so the money invariants are pinned before a template
depends on them.

### Phase 5: The auth templates and the migration onto them

`templates/auth.tsx` renders the three auth kinds through the shared layout.
`createAuthEmailer` keeps its signature, its three guarantees and its existing tests, and gains a
`locale`: the request's negotiated locale, read through `negotiateLocaleFrom` at the two call sites
(`src/server/auth/config.ts` and `src/server/fns/members.ts`). English copy leaves the module for
the EN + PL catalogue.

A render error is caught inside the send path, because these calls sit inside Better Auth request
handlers and a template bug must return `'failed'` rather than turn a completed sign-up into a 500.

## Risks

- **React Email inside workerd.** Mitigated by proving it in Phase 3 before anything builds on it;
  a failure stops the phase and reports rather than reaching for a workaround.
- **The auth path is live.** `createAuthEmailer`'s three guarantees (never throws, an absent
  provider is a loud `'skipped-no-provider'`, no token in a log) are non-negotiable and carry over
  verbatim. `src/server/auth/__tests__/email.test.ts` is extended, never narrowed.
- **Locale for the invitation.** `organization-invitation` goes to somebody who has no account, so
  the request's locale is the inviter's. That is the closest signal available and the spec accepts
  it (A1).
- **Dependency freeze.** `@react-email/components@^1.0.12` is already pinned and installed
  (`docs/SPEC.md` §3). This run installs nothing; a need for a new package stops it and reports.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Reconcile the design documents

- [x] 1.1 Correct `docs/plans/21-notifications.md` → 21-S2 and record the `renderCopyParams` amendment in the spec — 86494bb

### Phase 2: The transport

- [x] 2.1 `src/server/email/send.ts` and its test — 2f0f42f

### Phase 3: Render, and the shared layout, inside workerd

- [x] 3.1 `src/server/email/render.ts`, `templates/layout.tsx`, the workerd test and `pnpm build` — cacceb6

### Phase 4: Copy parameters into display strings

- [x] 4.1 `src/lib/notifications/render-copy.ts` and its money-invariant cases — 43971ae

### Phase 5: The auth templates and the migration onto them

- [x] 5.1 `templates/auth.tsx` and the `email.auth.*` catalogue keys in EN + PL — 4bce113
- [x] 5.2 Re-point `createAuthEmailer` at the templates and pass the request's locale in — 2c36bc0
