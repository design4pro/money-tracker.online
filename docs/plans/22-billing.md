# 22 — Billing

## Area brief

Subscriptions through **Polar** (`docs/adr/0012-polar-for-subscription-billing.md`), integrated with a
**hand-rolled REST client** — no SDK (BND-23). The reasons are recorded in the ADR and hold: a
`fetch` wrapper against four endpoints is smaller than the SDK's dependency tree, it runs in workerd
without shims, and it cannot surprise us with a transitive update.

Money leaves this product's hands at exactly one place — the hosted checkout — and comes back as
**webhooks**. Everything downstream of that is our own state, and the invariant that governs the
area is:

> **Entitlement is derived from stored subscription state, never from a UI claim and never from a
> checkout redirect.** A person landing on `/billing/success` is not entitled; a person whose
> `subscriptions` row says `active` is.

`resolveLimits()` already exists from `00-S15` and is consumed by every `assertWithinLimit` call in
the product. This plan makes it read real subscription rows instead of the free-tier default, which
means **every quota in the system starts working on the day `22-S2` lands** — and that is exactly why
the tenant isolation and money tests here are as heavy as they are.

---

## Stage 22-S1 — The Polar client and webhook ingestion

### Stage id

`22-S1` · Wave 5 · effort **L**.

### Reference rows

`BILL-01 missing → done` — the Polar REST client with typed responses and retries.
`BILL-02 missing → done` — the webhook endpoint with Standard Webhooks signature verification and
idempotent event storage.

### Owned paths

- `src/server/billing/polar-client.ts` — new
- `src/server/billing/polar-types.ts` — new
- `src/server/billing/webhook-verify.ts` — new
- `src/server/billing/__tests__/webhook-verify.test.ts` — new
- `src/server/billing/__tests__/polar-client.test.ts` — new
- `src/routes/api/webhooks.polar.ts` — new
- `src/server/repos/billing-events.ts` — new
- `src/server/repos/__tests__/billing-events.test.ts` — new

### Data and migration

Requisitions into `00-S14`: `billing_events` (`id` — the provider's event id as the primary key,
which is what makes replay a no-op; `type`, `workspace_id` nullable, `payload_json`, `signature_ts`,
`received_at`, `processed_at`, `status` in `received|processed|ignored|failed`, `error_code`).

The provider's event id as the **primary key** is the whole idempotency strategy: a duplicate webhook
is an insert conflict, handled and acknowledged 200, not a second application of the same state
change. Providers redeliver, and a subscription upgraded twice from one event is a support incident.

### Server (repo, server function, Zod)

- **`polar-client.ts`** — `createCheckout`, `getSubscription`, `cancelSubscription`,
  `createCustomerPortalSession`, `listProducts`. Each is a typed `fetch` with a bearer token from a
  secret binding, a 10-second timeout via `AbortSignal.timeout`, and retries on 429/5xx with
  exponential backoff and a cap. Responses are parsed through Zod (`polar-types.ts`) — an upstream
  shape change becomes a typed error with the failing path, not an undefined read three files later.
- **`webhook-verify.ts`** — Standard Webhooks HMAC-SHA256 over `${id}.${timestamp}.${body}` using
  `crypto.subtle`, compared with a **timing-safe** comparison, with a **5-minute timestamp
  tolerance** rejecting replays. It verifies against the **raw body bytes**, read before any JSON
  parse — parsing then re-serialising changes bytes and breaks every signature, and that mistake is
  common enough to be called out in the file's header comment.
- **The endpoint** verifies, inserts the event (conflict → 200 and stop), enqueues
  `billing.event` for processing, and returns 200 within its budget. **Processing is not done in the
  request**: a slow processor causes provider retries, and a provider that retries into an
  unprotected handler is how double-application happens. `22-S2` owns the handler.
- **Unknown event types** are stored with `status = 'ignored'` and acknowledged. Rejecting an unknown
  type with a 4xx makes the provider retry forever and eventually disable the endpoint.

### UI (route, components)

None.

### Quota

No countable row.

### Tenant isolation test

`billing_events` is **platform data, not tenant data** — it arrives before we know which workspace it
belongs to. In `tenant-isolation.test.ts`: the table is on the same explicitly-named allow-list as
`src/server/catalog` and `20-S3`'s backup path, asserted by the same lint-shaped guard; no
workspace-facing route reads it; and the webhook endpoint is **outside** the session middleware, with
a test asserting it requires no cookie and is unaffected by one.

### Money invariant

_Money amounts from the provider are stored as the provider's integer minor units and its currency
code, unconverted._ Cases in `polar-client.test.ts`:

- _`amount` fields parse as integers through `z.number().int()`_ and are branded `Minor`; a fractional
  value from the provider is a parse error, not a rounded read.
- _the provider's currency code is stored verbatim_ and never coerced to the workspace's base — a
  subscription billed in USD is a USD fact, and displaying it converted would be a fabricated number.
- _no billing amount is ever passed through `formatAmount` with the workspace's `digits`_ — it uses
  the **billing currency's** digits, asserted with a JPY fixture.
- _the client never computes a price_; prices come from the provider and from `plans.ts`'s display
  copy, and the test asserts no arithmetic on amounts exists in the module.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `webhook-verify.test.ts`: a valid signature; a tampered body; a wrong secret; a timestamp 6 minutes
  old (rejected); a timestamp 4 minutes old (accepted); a body containing multi-byte UTF-8 verified
  against raw bytes; and an assertion that the verifier reads the body **before** any parse.
- `polar-client.test.ts`: the four money cases; a 429 retried and succeeding; a 500 exhausting retries
  into a typed error; a timeout; a schema-mismatch error naming the failing path.
- `billing-events.test.ts`: duplicate event id → one row and a 200; unknown type → `ignored`.
- No browser evidence.

### Definition of done

All seven §7 items; §2's visual clauses are carried by `22-S3`, stated explicitly.

### Blockers

None. Sandbox credentials are in `.dev.vars` per `docs/DEPLOY.md`; production keys are a deploy-time
secret, not a code dependency.

---

## Stage 22-S2 — Subscription state and effective limits

### Stage id

`22-S2` · Wave 5 · effort **L**. **The stage that turns every quota in the product on.**

### Reference rows

`BILL-03 missing → done` — the subscription store and the event processor.
`BILL-04 missing → done` — `resolveLimits()` reading real subscription state, with the documented
precedence.
`BILL-05 missing → done` — downgrade handling and the over-limit grace state.

### Owned paths

- `src/server/repos/subscriptions.ts` — new
- `src/server/repos/__tests__/subscriptions.test.ts` — new
- `src/server/queue/handlers/billing-event.ts` — new
- `src/server/queue/handlers/__tests__/billing-event.test.ts` — new
- `src/server/billing/resolve-limits.ts` — edit
- `src/server/billing/__tests__/resolve-limits.test.ts` — new

### Data and migration

Requisitions into `00-S14`: `subscriptions` (`id`, `workspace_id` unique, `polar_customer_id`,
`polar_subscription_id`, `product_id`, `plan_key`, `status` in
`trialing|active|past_due|canceled|unpaid|incomplete`, `current_period_end`, `cancel_at_period_end`,
`seats`, `updated_at`, `raw_json`) and `billing_customers` (`workspace_id`, `polar_customer_id`,
`email_hash`, `created_at`).

`workspace_id` is **unique** on `subscriptions`: one workspace, one subscription. Multiple concurrent
subscriptions per workspace is a support nightmare and the schema forbids it rather than the code
apologising for it later.

### Server (repo, server function, Zod)

- **The processor** handles `subscription.created|updated|active|canceled|revoked`,
  `order.created`, and `checkout.updated`, mapping each to a state write. It resolves the workspace
  from the checkout's `metadata.workspaceId`, which we set at checkout creation — **never** from an
  email match, which would let anyone claim a workspace by using its owner's address.
- **Ordering.** Webhooks arrive out of order. Every write is conditional on the event's
  `modified_at`/`created_at` being **newer than the stored `updated_at`**; an older event is applied
  to nothing and marked `processed`. Without this, a delayed `created` event overwrites a later
  `canceled` and someone keeps a plan they cancelled.
- **`resolveLimits()`** precedence, unchanged from `00-S15`'s contract and now fed real data:
  1. an **entitling status** (`active`, `trialing`) selects the subscription's `plan_key`;
  2. `past_due` keeps the paid plan through a **grace window** (a named constant, 7 days past
     `current_period_end`), then falls back to free;
  3. any other status, or no row, is the free plan;
  4. the **catalogue** (`plans.ts`) supplies the numbers for the resolved key;
  5. **row ceilings win** — a per-workspace override row (set by the console, plan 24) always
     overrides the catalogue, in either direction.
- **`EffectiveLimits`** carries `limits` **and** `metrics` (current counts), so a UI can render "42 of
  50 accounts" from one call rather than a second round of counting, and `assertWithinLimit` compares
  the two without re-querying.
- **Downgrade is never destructive.** Falling to a lower plan while over a limit puts the workspace in
  an **over-limit** state: existing rows remain readable, exportable and deletable; **creating more of
  the exceeded resource is refused** with a typed error naming the resource, the count and the
  ceiling. Deleting someone's transactions because they stopped paying would be indefensible, and
  `subscriptions.test.ts` asserts read and export still work in that state.

### UI (route, components)

None; `22-S3` renders the state.

### Quota

This stage **is** the quota system's data source. `resolve-limits.test.ts` is therefore a
product-wide test, and it enumerates **every** limit key `plans.ts` declares, failing if a key exists
in the catalogue without a case here — that is the mechanism that stops a new quota shipping
unresolved.

### Tenant isolation test

In `tenant-isolation.test.ts`: `resolveLimits(scopeA)` never reads B's subscription, asserted with A
on free and B on paid — and specifically that A does **not** receive B's ceilings; the processor
refuses an event whose `metadata.workspaceId` does not match the customer's stored workspace,
routing it to `failed` with a named code rather than applying it; and no workspace-facing server
function can write `subscriptions` (the repository's writes are exported only to the queue handler,
asserted by an import graph check).

### Money invariant

_Billing state never touches ledger money, and plan numbers are counts, not amounts._ Cases:

- _`resolveLimits` returns integers for counts and never a `Minor`_ — the two are different branded
  types and mixing them does not compile; the test includes a `@ts-expect-error` fixture.
- _no code path lets a subscription state change modify a transaction, a balance or a
  `ref_amount_minor`_, asserted by an import graph check that `subscriptions.ts` and
  `billing-event.ts` import nothing from `repos/transactions` or `repos/balances`.
- _the over-limit state does not alter any stored amount_, asserted by capturing every account balance
  before and after a forced downgrade.
- _the subscription's own price is displayed in the billing currency_, and the test asserts a
  workspace with base `PLN` and a subscription in `USD` renders `USD` with `USD` digits.

### Verification

- Command gate.
- `resolve-limits.test.ts`: the five precedence rules with a case each; the exhaustive key
  enumeration; the grace window at day 6 and day 8; a row ceiling overriding both upward and
  downward.
- `billing-event.test.ts`: out-of-order events; duplicate delivery; a `canceled` followed by a stale
  `active`; the metadata mismatch; the DLQ path.
- `subscriptions.test.ts`: the over-limit state permitting read, export and delete while refusing
  create, with the typed error's fields asserted.
- No browser evidence.

### Definition of done

All seven §7 items; §2 carried by `22-S3`.

### Blockers

`OPEN-1` — which limits distinguish the tiers, and specifically whether multi-currency is a paid
feature. The machinery is complete and indifferent to the numbers; `plans.ts` holds them in one place
and changing them is a one-file edit with no code change. This blocks the pricing page copy
(plan 25), not this stage.

---

## Stage 22-S3 — Checkout, the billing screen and the portal

### Stage id

`22-S3` · Wave 5 · effort **M**.

### Reference rows

`BILL-06 missing → done` — `/settings/billing` with the current plan, usage and history.
`BILL-07 missing → done` — checkout initiation and the return path.
`BILL-08 missing → done` — the customer portal link, cancel and the over-limit banner.

### Owned paths

- `src/routes/_app/settings/billing.tsx` — new
- `src/routes/_app/settings/-ui/plan-card.tsx` — new
- `src/routes/_app/settings/-ui/usage-meter.tsx` — new
- `src/routes/_app/-ui/over-limit-banner.tsx` — new
- `src/routes/api/billing.checkout.ts` — new
- `src/routes/api/billing.return.ts` — new
- `e2e/billing.spec.ts` — new

### Data and migration

None.

### Server (repo, server function, Zod)

- **`/api/billing/checkout`** requires an **owner or admin** (`requirePermission`), creates a Polar
  checkout with `metadata: { workspaceId, userId }` and a return URL, and 302s to the hosted page. It
  writes **nothing** about entitlement.
- **`/api/billing/return`** is a **redirect only**. It reads the checkout id, optionally polls
  `getSubscription` **once** to shorten the common case, and lands on `/settings/billing` with a
  "we're confirming your subscription" state if the webhook has not arrived. It **must never** grant
  entitlement itself — the return URL is attacker-controllable, and this is the single most important
  sentence in the plan.
- **`loadBilling`** returns the resolved plan, `EffectiveLimits` (limits and metrics), the
  subscription's status and period end, and the recent `billing_events` of user-relevant types.

### UI (route, components)

- **Route.** `/settings/billing`.
- **Components.** `plan-card.tsx` (the current plan, the price in the billing currency, the period
  end, and the actions available for the state); `usage-meter.tsx` (a labelled bar per limit —
  "Accounts: 12 of 25" — with the number always in text, never bar-only); `over-limit-banner.tsx` (in
  the app shell, naming the exceeded resources and linking here).
- **States.** Free; trialing (with days remaining); active; **cancel at period end** (with the exact
  date and an undo); past due **in grace** (with the grace end date and a "fix payment" link to the
  portal); past due **out of grace**; canceled; **over limit** (listing each exceeded resource with
  its count and ceiling); and **confirming** (the post-checkout window before the webhook lands, with
  a poll and an honest message).
- **Accessibility.** Each usage meter is a `progressbar` with an accessible name and a text value.
  Destructive actions (cancel) are `AlertDialog`s stating exactly what happens and when. The over-limit
  banner is a `role="status"` region, **not** an `alert` — an assertive interruption on every page
  load is hostile for a state that persists for days. All targets 44px (2.5.5 AAA); no step is
  time-limited (2.2.6 AAA); the flow never asks a person to retype anything (3.3.9 AAA).
- **Honesty.** The screen never claims a feature the plan does not include, and the plan comparison
  links to the pricing page rather than duplicating it — two copies of pricing drift, and drifted
  pricing is a refund.

### Quota

This screen is where quota becomes visible. It reads `EffectiveLimits.metrics`, never its own counts.

### Tenant isolation test

In `tenant-isolation.test.ts` and `e2e/billing.spec.ts`: a non-admin member cannot reach checkout or
cancel (403 from `requirePermission`, and the actions are absent from the UI, not merely disabled);
the checkout metadata carries the **session's** workspace, and a forged `workspaceId` in the request
body is ignored; `/api/billing/return` with a checkout id belonging to B changes nothing in A.

### Money invariant

_The screen states the provider's price and the ledger's counts, and never confuses the two._ Cases in
`money-invariants.test.ts` and `e2e/billing.spec.ts`:

- _the displayed price is the provider's amount and currency_, formatted with the billing currency's
  digits — asserted with a `USD` subscription in a `PLN` workspace and a `JPY` fixture.
- _usage meters display counts, not amounts_, and passing a `Minor` into `usage-meter` does not
  compile.
- _the over-limit banner's counts equal `EffectiveLimits.metrics`_ exactly, recomputed by the test
  against the repositories.
- _no conversion of the subscription price into the base currency appears anywhere_, asserted by
  searching the rendered output for the converted figure and requiring its absence.

### Verification

- Command gate.
- `e2e/billing.spec.ts` against the **Polar sandbox**: initiate checkout and assert the redirect
  carries the metadata; simulate the webhook and assert the screen moves from "confirming" to
  "active"; force a downgrade and assert the over-limit banner and the refused create; cancel and
  assert the period-end state with its undo.
- Browser evidence at the pinned clock: `/settings/billing` in **free**, **active**, **past due in
  grace**, **cancel at period end**, **over limit** and **confirming** states, both themes, at
  **360 / 1280 / 2560 px**, plus the **cancel dialog open** and the **over-limit banner in the shell**.
- axe on `/settings/billing` in both themes with the dialog open: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

`OPEN-1` — the plan names, prices and included limits shown on this screen. The states, the machinery
and the tests are complete; the strings and numbers come from `plans.ts` and the Polar product
catalogue, and both are data.
