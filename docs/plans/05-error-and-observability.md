# 05 — Errors and observability

## Area brief

How a failure becomes something a person can act on and something an operator can find, without
either of them learning anything they should not.

Three pieces: a **classification** layer that turns any thrown value into a typed failure; a
**redaction** middleware that decides what crosses the wire; and the **telemetry** wiring — the
logger, Sentry, and `/api/health`.

The redaction rule is sharper here than in a general SaaS, and it is the reason this plan exists in
wave 1 rather than being folded into `04`: **an amount, a payee name, an account name or a note must
never reach Sentry**. `docs/SECURITY.md` states the policy; this plan implements the scrubber that
makes it true regardless of who writes the next `throw`.

---

## Stage 05-S1 — Failure classification and the public envelope

Delivered: 2026-10-12 - the owned paths listed below exist as built, merged in #653 (the scrubber), #655 (the classifier, the envelope and the `failure.*` keys), #693 (the client reader and the two route readers moved onto it) and #711 (the global middleware and the wire adapter); `pnpm vitest run` on those eight files passes 612 tests (351 `redact`, 93 `classify`, 22 `envelope`, 24 `middleware`, 2 `failure-readers`, 8 `failure`, 15 `public-failure`, 97 `tenant-isolation`, the failure section among them); the API routes, the queue handlers and the Durable Object are not behind the middleware and the framework's outer `catch` is not either (`docs/SECURITY.md` §6.1), and no Sentry client is installed, all `05-S3`'s.

### Stage id

`05-S1` · Wave 1 · effort **M**.

### Reference rows

`OBS-01 missing → done` — `classifyFailure` and the typed failure taxonomy.
`OBS-02 missing → done` — the versioned public-failure envelope.
`OBS-03 missing → done` — `failureRedactionMiddleware` on every server function.

### Owned paths

- `src/server/errors/redact.ts` — new, the scrubber (`redact`, `redactError`)
- `src/server/errors/classify.ts` — new
- `src/server/errors/envelope.ts` — new
- `src/server/errors/middleware.ts` — new
- `src/lib/failure-envelope.ts` — new, the envelope's shape and closed sets, isomorphic
- `src/lib/public-failure.ts` — new, `PublicFailureError` and its serialization adapter
- `src/lib/failure.ts` — new, `readFailure` (the browser reader)
- `src/start.ts` — registers the middleware and the adapter
- `src/lib/i18n/messages/{en,pl}.ts` — the `failure.*` keys
- `src/routes/invite.$invitationId.tsx` and `src/routes/_app/transactions/rules/new.tsx` — the
  readers moved off `error.message`
- `src/server/errors/__tests__/classify.test.ts`, `envelope.test.ts`, `redact.test.ts`,
  `middleware.test.ts` and `failure-readers.test.ts` — new
- `src/lib/__tests__/failure.test.ts` and `public-failure.test.ts` — new
- the failure section of `src/server/repos/__tests__/tenant-isolation.test.ts`

### Data and migration

None.

### Server (repo, server function, Zod)

- **Repository.** None. This layer sits above every repository and below every route.
- `classifyFailure(err)` maps a thrown value to `{ kind, status, retryable }` where `kind` is one of
  `unauthenticated | forbidden | not_found | validation | conflict | quota | feature_locked |
rate_unavailable | rate_limited | upstream | internal` (`unauthenticated` is the 401 for an anonymous
  request, so a screen can say "sign in" where `forbidden` says "refused"). **The default is `internal`**, and an unrecognised throw is
  never optimistically classified as something friendlier.
- **The public envelope is versioned**: `{ v: 1, kind, message, fields?, retryAfter? }`. A version on
  the envelope is what lets the client keep rendering an old shape while a new one rolls out, which
  matters because the Worker and the client bundle deploy together but the _open tab_ does not.
- **`message` is an i18n key plus params, never a sentence.** A server that returns English prose
  cannot be rendered in Polish, and a server that returns a raw error message returns whatever the
  driver said, which is where connection strings leak.
- `failureRedactionMiddleware` is registered globally in `src/start.ts` and wraps every
  `createServerFn`. Inside it: classify, redact, log, set the status, then **throw a replacement
  `PublicFailureError` that carries the envelope** (the framework returns whatever is thrown as data,
  so the value itself has to be replaced). **An unclassified throw becomes `{ kind: 'internal' }`
  with no detail at all** — not a truncated message, not a stack, not the error's `name`. It covers
  server functions only: the API routes, the queue handlers and the Durable Object are `05-S3`'s,
  and a failure before the chain runs is the framework's own outer `catch`
  (`docs/SECURITY.md` §6.1).
- **Ledger batching.** Not applicable, but stated: the middleware is **outside** `runWithLedgerBatch`,
  so a throw still flushes the ledger batch. Rows already committed must still be rebuilt.

### UI (route, components)

- **Route.** None; `ErrorPanel` is `05-S2`.
- **Components.** None.
- **States.** Not applicable.
- **Tokens.** None.
- **Accessibility.** The envelope carries `fields` so a validation failure can be attached to the
  right input with `aria-describedby` rather than dumped into a banner. A form error a screen-reader
  user has to hunt for is a failure of this layer, not of the form.

### Quota

`QuotaExceededError` and `FeatureLockedError` classify to `quota` and `feature_locked` with **status
402**, and their envelopes carry the metric (and no plan, ceiling or count: the error does not know
the plan, and the middleware must not invent one), so the screen names the metric and resolves the
plan itself to render an accurate upgrade prompt rather than a generic one. This stage does not enforce a quota; it defines how one is reported.

### Tenant isolation test

The isolation property this layer owns: **a `NotFoundError` and a cross-tenant read are
indistinguishable in the envelope** — same `kind`, same status, same message key, same absence of
detail. The case in `tenant-isolation.test.ts`: the envelope for "row does not exist" and the
envelope for "row belongs to B" are byte-identical, including any timing-sensitive field. A 403 for
one and a 404 for the other confirms the row exists.

### Money invariant

`redact.ts` is a **money-aware scrubber**, and this is the stage's real content. It strips, from
every value that reaches a log or Sentry: any key matching `amount`, `minor`, `balance`, `limit`,
`rate`, `ref_`, `note`, `payee`, `name`, `description`, `iban`, `account_number`; any string that
matches a currency-amount pattern; and any array of such. What survives is the **shape**: a count, a
type, an id.

Cases in `redact.test.ts`: _an amount never survives redaction_; _a payee name never survives_;
_a nested amount inside a queue envelope never survives_; _redaction is applied before Sentry and
before the logger, not after_ (asserted by spying on both sinks, because "we redact somewhere" is not
a property).

### Verification

- Command gate.
- `classify.test.ts`: each error type maps to its kind and status; an unknown throw is `internal`
  with no detail; a Zod error becomes `validation` with `fields` and no raw issue dump.
- `redact.test.ts`: the money cases above plus a fuzz case over a nested object of depth 5.
- No browser evidence and no axe run: no surface. The rendering of a failure is `05-S2`.

### Definition of done

§7 items 1–3 and 5–7. Item 4 does not apply (no surface).

### Blockers

**`OPEN-8`** — the DPA and the Sentry data policy. The scrubber is written to the strictest reading
(no money, no names, ever) so that whatever `OPEN-8` decides, this stage does not have to be
loosened — only, possibly, documented.

---

## Stage 05-S2 — `ErrorPanel` and the boundaries

Delivered: 2026-10-12 - the failure panel, the page-level failure and the browser evidence exist as built, merged in #684 (`ErrorPanel` options, `FailurePanel` and the reference line), #699 (`RouteError` as the page-level failure, `DefaultRouteError` placing itself) and #712 (the axe gate, the target-size and reflow checks, the frames); `pnpm vitest run` on `error-panel.test.tsx`, `failure-panel.test.tsx`, `route-error.test.tsx`, `default-error.test.tsx`, `not-found.test.tsx` and `error-panel-ownership.test.ts` passes 115 tests (16, 71, 19, 4, 3 and 2), and `e2e/errors.visual.spec.ts` is run by CI, not by the gate. Two halves are open: the offline half of `OBS-06` (the offline-failure surfaces) is deferred to `27-S1` (`PWA-03`), and `FailurePanel` has no producer: the envelope reader and the middleware (`05-S1` Phases 3 and 4, issues #648 and #649) are merged, but no screen renders `FailurePanel` from `readFailure(error)` yet (`grep -rn "<FailurePanel" src` finds no render outside the tests), so only `RouteError` through `DefaultRouteError` is live. The `quota` and `feature_locked` shapes also wait on `22-billing`, which owns the plan they point at, so they are captured through a harness. The guideline is `DESIGN.md` -> Error panel; the sites that still render a thrown message are #718.

### Stage id

`05-S2` · Wave 1 · effort **M**.

### Reference rows

`OBS-04 missing → done` — `ErrorPanel` and its recovery affordances.
`OBS-05 missing → done` — the root and route error boundaries.
`OBS-06 missing → done` — the 404 (the offline-failure surfaces are `27-S1`'s, `PWA-03`).

### Owned paths

- `src/components/app/shell/error-panel.tsx` — the existing panel, gains `tone`, `mode`,
  `headingLevel`, `focusHeading` and `actions`
- `src/components/app/shell/failure-panel.tsx` — new, `FailurePanel` and `RECOVERY_OF`
- `src/components/app/shell/failure-reference.tsx` — new, the reference line and its Copy button
- `src/components/app/shell/use-focus-heading.ts` and `use-is-after-initial-render.ts` — new
- `src/components/app/shell/route-error.tsx` — the page-level failure
- `src/components/app/shell/default-error.tsx` and `dashboard-link.tsx` — new, the router's default
  boundary placing itself, and the way back
- `src/components/app/shell/not-found.tsx` — the 404, mounted by `src/routes/__root.tsx`
- `src/components/app/shell/__tests__/error-panel.test.tsx`, `failure-panel.test.tsx`,
  `route-error.test.tsx` and `not-found.test.tsx` — extended; `default-error.test.tsx` — new
- `e2e/errors.visual.spec.ts` and `e2e/support/failure-harness.tsx` — new
- `DESIGN.md` -> Error panel

### Data and migration

None.

### Server (repo, server function, Zod)

None. `__root.tsx` mounts the i18n provider (`02-S1`'s requirement), the theme, the RAC
`I18nProvider` and the error boundary.

### UI (route, components)

- **Route.** `src/routes/__root.tsx` — the document shell, `<html lang>` and `dir` from the negotiated
  locale, SSR.
- **Components.** `FailurePanel` consumes the `FailureEnvelope` that `readFailure(error)` (`05-S1`
  Phase 3) returns and derives its recovery from `kind`, through `RECOVERY_OF`, which sends
  `not_found` and `forbidden` to the same recovery so the screen never offers a different way out
  for a missing row and a foreign one. It renders `ErrorPanel`, which reuses `Card`, `Button` and
  `Link`. The producer passes only an event id or a request id as the `reference`, never a message
  or a value. `not-found.tsx` is the 404 surface.
- **States.** `FailurePanel` **is** a state, and it has four shapes, each with a different recovery:
  `retryable` (a Retry button that refetches, and does not clear form input), `quota` (a link to
  `/settings/billing` naming the metric; the panel shows no plan or ceiling), `feature_locked` (the
  same link and the sentence, and nothing else), and `internal` (the sentence, the event or request
  id as copyable text, and a link back to `/dashboard` inside the shell). A single generic panel
  with a Reload button is the shape this stage exists to avoid.
- **Tokens.** None new; the panel uses the `negative` and `warning` families already in
  `tokens.css`.
- **Accessibility.** The panel is `role="alert"` when it replaces content after an action, and a
  plain region when it _is_ the page's content — an alert on initial render is announced before the
  person has any context for it. Focus moves to the panel's heading on an action failure, and the
  Retry button is reachable without leaving the panel.

### Quota

No countable row.

### Tenant isolation test

None — the component renders an envelope and reads nothing. Stated rather than skipped: the isolation
property lives in `05-S1`'s envelope equality case, and this component would be unable to distinguish
the two even if it wanted to.

### Money invariant

`FailurePanel` **never renders a value from the envelope's `params` into a currency-shaped string.** The
envelope carries a metric name for quota failures, and no plan and no ceiling — never an amount, never
a balance — because `05-S1`'s scrubber has already removed them and a component that renders "you have spent
€1,234" from an error payload would be rendering something that no longer exists. Held by
`failure-panel.test.tsx` → _names no plan and shows no amount for each failure kind_.

### Verification

- Command gate.
- `failure-panel.test.tsx`: each of the four shapes renders its own recovery; `role="alert"` only in
  the post-action case; focus moves to the heading; no amount is rendered. `error-panel.test.tsx`
  pins the default render the other consumers keep.
- Browser evidence: the `quota` and `feature_locked` shapes are captured through a harness (no
  route can produce them yet), while the 404 and a forced failure are captured in the app, both
  themes, at 360 / 1280 / 2560 px — the failure states **are** the point of the stage, so the
  resting screen is not evidence here.
- `e2e/errors.visual.spec.ts` runs axe on the 404, on one forced failure and on every shape of the
  panel in the harness at the WCAG A/AA bar (`expectNoWcagViolations`).
- Console: the boundary itself must not log. A caught error that also prints to the console is a
  double report and pollutes every other stage's silent-console assertion.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 05-S3 — Logging, Sentry and health

### Stage id

`05-S3` · Wave 1 · effort **M**.

### Reference rows

`OBS-07 missing → done` — the structured logger with `LOG_LEVEL`.
`OBS-08 missing → done` — Sentry for the Worker and the client, with release from
`CF_VERSION_METADATA`.
`OBS-09 missing → done` — `/api/health`.
`OBS-10 missing → done` — Durable Object and queue instrumentation.

### Owned paths

- `src/server/log.ts` — new
- `src/server/sentry.ts` — new
- `src/lib/sentry-client.ts` — new
- `src/routes/api/health.ts` — new
- `src/server/__tests__/log.test.ts` — new
- `src/server/__tests__/health.test.ts` — new

### Data and migration

None.

### Server (repo, server function, Zod)

- `log.ts` emits **structured JSON**, one object per line, with `level`, `msg`, `requestId`,
  `organizationId` and nothing else by default. It runs every payload through `redact.ts` from
  `05-S1` before emitting. `LOG_LEVEL` comes from `wrangler.jsonc` vars (`info` in production,
  `debug` in staging).
- `sentry.ts` configures `@sentry/cloudflare` with `release` from `CF_VERSION_METADATA` and
  `beforeSend` calling the same scrubber. It also routes the API routes, the queue handlers and the
  Durable Object through the same scrubber: `05-S1`'s middleware covers server functions only, and
  until then those three log through the raw logger. **Two sinks, one scrubber** — a second redaction
  implementation is how one of them ends up more permissive.
- `/api/health` returns `200` with `{ ok: true, version }` and performs **one** cheap D1 read to prove
  the binding resolves. It does **not** check the queue, R2 or the FX provider: a health endpoint that
  can fail for a reason unrelated to serving requests will page somebody at 03:00 for a third-party
  outage. Those belong in the nightly cron's own logging.
- DO and queue instrumentation: every `AccountLedger` call and every queue handler wraps in a span
  with the envelope kind and the outcome, so a rebuild storm is visible as a shape rather than
  inferred from a latency graph.
- **Ledger batching.** Not applicable.

### UI (route, components)

- **Route.** `src/routes/api/health.ts`, server-only, no UI.
- **Components.** None.
- **States.** Not applicable.
- **Tokens.** None.
- **Accessibility.** None specific.

### Quota

No countable row. Sentry's own event volume is a cost line in `docs/ARCHITECTURE.md` §7, and the
`head_sampling_rate` in `wrangler.jsonc` is where it is controlled — a change to it is a `00-S2`
requisition, not an edit here.

### Tenant isolation test

`organizationId` is a **log field**, and it is the one identifier that is allowed through the
scrubber. The case: a log line emitted while handling A's request never contains B's organization id,
even when the handler read a global catalogue row. Held in `log.test.ts` rather than the isolation
suite, because there is no repository involved.

### Money invariant

**No amount reaches a log line or a Sentry event, ever**, and this stage is where that is enforced at
the sink rather than hoped for at the call site. `log.test.ts` → _the logger drops a money key even
when the caller passes it explicitly_: `log.info('saved', { amountMinor: 1234 })` emits a line with
no `amountMinor`, and does not throw — dropping is right, because throwing would turn a logging
mistake into an outage.

### Verification

- Command gate.
- `log.test.ts`: level filtering; the redaction case above; JSON shape stability.
- `health.test.ts`: `200` with a resolvable `DB`; **`503`** with an unresolvable one; the response
  body carries no binding names or ids.
- A staging smoke run asserting `/api/health` = 200 and `/api/auth/get-session` = 200, which is the
  exact pair `docs/DEPLOY.md` §8's post-deploy check uses.
- No browser evidence and no axe run: no user-facing surface.

### Definition of done

§7 items 1–3 and 5–7. Item 4 does not apply (no surface).

### Blockers

**`OPEN-8`** — the sub-processor list and whether Sentry is on it. The scrubber makes the answer
low-stakes technically; the disclosure obligation is a legal one and is named in `docs/SECURITY.md`.
