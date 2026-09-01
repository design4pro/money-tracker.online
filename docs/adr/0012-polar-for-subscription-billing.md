# 0012. Polar is the billing provider, called through a hand-rolled REST client

Status: accepted
Date: 2026-09-01

## Context

The product sells three plans (`free`, `plus`, `household`) on monthly or yearly intervals, to
customers who are largely EU consumers. Selling to EU consumers means **VAT MOSS**: registering,
determining each customer's location, charging the right rate, and filing. Doing that ourselves is a
tax project, not a feature.

That pushes towards a merchant of record — a provider that sells to the customer and handles the tax
— rather than a payment processor where we remain the merchant. Stripe is the obvious processor;
using it directly leaves the VAT obligation with us. Paddle and Lemon Squeezy are merchants of
record. Polar is a merchant of record built for software products, with a first-class subscription
model, a customer portal, and a webhook implementation following the Standard Webhooks
specification.

A second question: SDK or REST? Polar publishes a TypeScript SDK. It assumes a Node runtime in
places, pulls in a dependency tree we do not otherwise need, and — for a Worker with a cold-start
budget — is a large amount of code to load for what is, in practice, half a dozen endpoints.

## Decision

**Polar** as the billing provider and merchant of record, called through a **hand-rolled REST
client** using `fetch` and WebCrypto — never the SDK.

Client behaviour is fixed rather than incidental:

- `POLAR_MAX_RETRIES = 2`, `POLAR_TIMEOUT_MS = 20_000`.
- Retry on **429 and 5xx only**; a 4xx is a bug in our request and retrying it is noise.
- Honour `retry-after`, capped at 5s.
- `resolvePolarOrigin` has **no default**. `POLAR_SERVER` must be explicitly `sandbox` or
  `production`. Defaulting to production would let a sandbox key touch real money; defaulting to
  sandbox would silently take no payments. Both failures are worse than a startup error.

Webhook handling:

- Standard Webhooks HMAC-SHA256 over `${id}.${timestamp}.${raw}`, 300s tolerance, multiple
  `v1,<sig>` entries tolerated so a secret can be rotated without downtime, with **our own
  constant-time comparison**.
- **Claim-then-handle dedupe** in KV: a 120s claim keyed on the event id, released on throw,
  promoted to a 72h handled marker on success.
- Status codes are a contract: **400** unsigned, **200** accepted / duplicate / deliberately ignored,
  **500** only when a retry could actually succeed.

Product identity:

- **The client never names a product.** It sends `{ planId, interval, seats? }`; the UUID is resolved
  server-side; `external_customer_id` is the workspace id. A crafted request cannot buy a different
  product than the one the pricing page displayed.
- The four product UUIDs arrive as `VITE_POLAR_PRODUCT_*` **static** references so Vite inlines them.

Entitlement:

- `trialing`, `active` and `past_due` all entitle. **`past_due` is dunning, not a lockout** — locking
  a person out of their own financial records because a card expired is hostile and actively harms
  recovery.
- `resolveLimits()` is the single authority and **row ceilings win over catalogue limits**
  (`seat_limit`, `storage_limit_bytes`, `quota_overrides`), so grandfathering an early customer is
  possible without a code change.
- Plan state is cached 60s in KV; **usage is read live**, so nobody outruns a quota inside the cache
  window.

## Consequences

We depend on a smaller, younger vendor than Stripe or Paddle. If Polar changes terms, has an outage,
or ceases operating, we migrate — and a billing migration means re-creating products, re-mapping
customers and reconciling in-flight subscriptions. The mitigation is that the coupling is thin and
deliberate: one client module, one webhook handler, one mirror table, and a plan catalogue
(`src/lib/plans.ts`) that knows nothing about the provider.

Hand-rolling the client means we own the retry semantics, the signature verification and the
timeouts — including the parts that are easy to get subtly wrong, like the constant-time compare and
the rotation-tolerant multi-signature parse. Those are tested directly, because a test of our
handler is the only evidence we can generate without the vendor.

**And that is the honest limit of what we currently know.** `docs/DEPLOY.md` §9.6's eight-row sandbox
acceptance matrix — subscribe, upgrade, downgrade, cancel, resume, failed payment, orders list,
customer portal — is **unwalked**. No credential has been issued to a build round, so the billing
code has never made a live API call or received a live delivery. A green `pnpm test` is evidence
about our handler and never about Polar agreeing, and that matrix is a release gate before anything
takes a card.
