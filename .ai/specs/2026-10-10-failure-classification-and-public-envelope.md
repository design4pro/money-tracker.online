# Failure classification, the public envelope and the redaction middleware (plan stage 05-S1)

| Field              | Value                                            |
| ------------------ | ------------------------------------------------ |
| **Status**         | ready                                            |
| **Issue**          | none                                             |
| **Spec PR**        | #0                                               |
| **Implementation** | none                                             |
| **Plan**           | 05-S1 (docs/plans/05-error-and-observability.md) |

## 📝 TLDR

Plan stage `05-S1` ("Failure classification and the public envelope", `docs/plans/05-error-and-observability.md`)
exists so that "a diagnostic never reaches the browser, and an amount, a payee name, an account name or a note
never reaches a log or Sentry" is true in **one** place instead of in every `throw`. None of its six owned paths
exists. `src/start.ts` registers no global middleware and says the redaction boundary belongs to this stage;
`docs/SECURITY.md` §6.1, `docs/ARCHITECTURE.md` §10 and §11 and `src/server/repos/errors.ts` already name
`failureRedactionMiddleware` and `classifyFailure` as if they were built.

The stage was written before the code, and the code has moved around it in five ways the spec has to absorb: the
framework serialises a thrown `Error` **with its stack and every own property**, so the thrown value itself has to be
replaced, not only filtered in a log; 63 places in `src/routes` read `error.message` (three of them branch on
it); the stage's taxonomy has no kind for an unauthenticated request; `QuotaExceededError` does not know the plan; and
the logger that exists today writes `errorMessage` and `errorStack`.

This spec turns the stage into five small tickets: the scrubber, the classifier and the envelope with their catalogue
keys, the client reader with the three migrated readers, the middleware registered globally, and the document
reconciliation. It ships no `ErrorPanel` (`05-S2`), no Sentry client and no logger change (`05-S3`).

## 📝 Problem Statement

Verified against the repository at the time of writing (commands in Resolved assumptions row 14).

**What the code already delivers**

- `src/server/repos/errors.ts` is the one family of refusals, each with a stable `code`; its header says the failure
  classifier "has a single thing to switch on". `AuthRequirementError` (`src/server/auth/tenant.ts`) carries `status`
  401 or 403 and a `reason`.
- `src/server/fns/not-found.ts` turns a repository `NOT_FOUND` into the router's `notFound()` sentinel at nine call
  sites, so a missing row and another workspace's row already leave identically (`e2e/not-found.spec.ts`,
  `e2e/tenant-isolation.spec.ts`).
- `src/server/observability/logger.ts` is a structured JSON logger with a sink port; its `error()` writes
  `errorName`, `errorMessage`, a 2000-character `errorStack` and the cause's message.
- `src/server/ledger/batch.ts` flushes the ledger collector in a `finally`, inside the handler body.
- `createStart` accepts `functionMiddleware`; `src/start.ts` passes `{}`.

**What does not hold**

1. **No classifier, no envelope, no scrubber, no middleware.** `src/server/errors/` does not exist.
2. **The framework publishes the raw error.** In `@tanstack/start-server-core` (`server-functions-handler.js`, lines 179 to
   200 of the installed 1.169.31) any thrown value that is not a `Response` or a not-found sentinel is `console.error`ed
   and serialised by seroval, with the status `getResponse().status ?? 500`. A probe with seroval 1.5.6 on an `Error`
   subclass with one own property shows the wire carries `message`, `name`, **`stack`** (absolute file paths) and the own
   property, and the client rebuilds a real `Error` from it. A repository sentence such as `AliasTakenError`'s (it
   interpolates a normalised payee name), `InvitationAddresseeError`'s (an email) or `InvalidAmountError`'s (`Not an
integer minor-unit amount: 12.5`) therefore reaches the browser today, and `console.error` puts the same text in
   Workers logs. A log filter alone cannot fix this: the thrown value has to be replaced.
3. **Client code reads `error.message`, 63 times.** A grep over non-test files in `src/routes` for `error.message`,
   `err.message` and `.message)` finds 63 lines, 46 files containing `error.message`: `detail={error.message}` in route error components, `setFailure(error.message)` in dialogs, and
   `toast.error(error.message)` in the members screen and the invitation route. Three branch on it:
   `rules/new.tsx` tests `message.includes('FEATURE_LOCKED')`, `invite.$invitationId.tsx` tests
   `error.name === 'AuthRequirementError'` or `/sign in to continue/i`, and its accept handler prints
   `toast.error(error.message)`. The first of those is **dead today**: `FeatureLockedError`'s message is `The <module>
module is not included in this plan.` and `FEATURE_LOCKED` is only its `code`, so the locked-plan upgrade card never
   appears. Moving that reader to the envelope makes it start working, which is a behaviour change and gets a test.
4. **The plan's taxonomy is short one kind.** `AuthRequirementError` is 401 for an anonymous request and 403 for six other
   reasons; none of the ten kinds says "sign in", and the invitation loader and `_app.tsx` already treat "not signed in"
   differently from "refused".
5. **`QuotaExceededError` has no plan.** The stage says its envelope carries "the metric and the plan"; the error carries
   `metric`, `limit` and `current`, and `assertWithinLimit` (`src/server/repos/base.ts`) holds a resolver result but no
   plan id. The middleware must not invent one.
6. **`rate_limited` has no thrower of its own.** Better Auth's limit is its own endpoint (`auth.error.rateLimited`).
   `PolarError` carries the provider's HTTP status, so a 429 from the provider is the one real source.
7. **Documents describe the code as built.** `docs/SECURITY.md` §6.1 and `docs/ARCHITECTURE.md` §10 and §11 say
   `failureRedactionMiddleware` scrubs "before an event is constructed"; §6.1 also says "error constructors take structured
   fields rather than template strings", which is not true of `ConflictError` (it takes a sentence) or of
   `AliasTakenError` and `InvitationAddresseeError`.

## 📝 Proposed Solution

Five tickets, each one pull request. No schema change, no queue change, no new dependency.

- **Phase 1 - the scrubber.** `src/server/errors/redact.ts` and `redact.test.ts`: a pure, total, bounded function and the
  error-to-fields reducer.
- **Phase 2 - the classifier, the envelope and the key table.** `classify.ts`, `envelope.ts`, the client-safe schema, the
  `failure.*` keys in EN and PL, `classify.test.ts`, and the tenant-isolation case.
- **Phase 3 - the client reader.** `src/lib/failure.ts` (`readFailure`) and the three `error.message` branches moved onto
  it.
- **Phase 4 - the middleware.** `middleware.ts`, registered in `src/start.ts`; the sink, wire, ledger-flush and
  control-flow tests; one probe of the running app.
- **Phase 5 - make the documents say what the code is.**

### What a failing server function does after this spec

1. The handler (or a per-function middleware, or `authMiddleware`) throws `e`. The global middleware catches it around
   `next()`; global function middleware runs before per-function middleware, so it wraps the auth guards too.
2. `redirect()` objects, `notFound()` sentinels and `Response` throws pass through unchanged: they are control flow.
3. `classifyFailure(e)` returns `{ kind, status, retryable }`. Anything it does not recognise is `internal`, status 500,
   `retryable: false`.
4. `buildEnvelope(e, classification)` returns `{ v: 1, kind, message: { key, params? }, fields?, retryAfter? }`. Every value
   in it is read from a **closed set** (a kind, a key from the key table, a `QuotaMetric`, a Zod field path of identifier
   characters) and never from the thrown value's `message`, `name`, `entity` or `id`.
5. The sinks receive `redactError(e)` plus the kind, run through the scrubber, **before** any sink is called. The log
   port writes those fields only (it is never handed the raw error, because `logger.error(msg, error)` would emit
   `errorMessage` and `errorStack`); the report port is a no-op until `05-S3` installs Sentry (row 9).
6. For `not_found` the middleware throws the router's `notFound()` sentinel, as `rethrowAsNotFound` does today (row 5). For
   every other kind it sets the response status and throws a `PublicFailureError`: an `Error` whose `message` is a fixed
   English fallback per kind, whose `stack` is `''`, with no `cause`, whose `name` is `PublicFailureError`, and whose only
   own data property is `envelope`.
7. The client rebuilds that error from the wire. `readFailure(error)` returns the envelope or `null`.

The middleware is outside `runWithLedgerBatch` by construction: the batch is opened inside handler bodies, so the
`finally` flush has already run when the error reaches the middleware.

**What this does not cover, stated.** The boundary wraps `createServerFn` handlers. The API routes
(`src/routes/api/files/$id.ts`, `src/routes/api/billing/*`, `src/routes/api/webhooks/*`), the queue handlers and the
Durable Object still log through the raw logger until `05-S3` routes it through the same scrubber. That gap is `05-S3`'s
and is named in its Definition of done by Phase 5.

## 📝 Architecture

Owner modules, per `docs/SPEC.md` §8 ("one redaction middleware").

| Concept                               | Owner module                            | Seam this spec touches                                                               |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| What may leave in a payload or a sink | `src/server/errors/redact.ts` (new)     | `redact(value)`, `redactError(error)`; the only deny list in the repository          |
| Which kind a thrown value is          | `src/server/errors/classify.ts` (new)   | `classifyFailure(error)`; the only switch on a `RepositoryError.code`                |
| What the client is told               | `src/server/errors/envelope.ts` (new)   | `buildEnvelope`, `FAILURE_MESSAGE_KEYS`; re-exports the schema                       |
| The envelope's shape, both sides      | `src/lib/failure-envelope.ts` (new)     | `FailureEnvelope` type, `failureEnvelopeSchema`, `FAILURE_KINDS`; isomorphic         |
| The boundary                          | `src/server/errors/middleware.ts` (new) | `failureRedactionMiddleware`, `createFailureMiddleware(ports)`, `PublicFailureError` |
| Reading an envelope in the browser    | `src/lib/failure.ts` (new)              | `readFailure(error)`                                                                 |
| Where the boundary is installed       | `src/start.ts`                          | `functionMiddleware: [failureRedactionMiddleware]`                                   |
| Copy for each key                     | `src/lib/i18n/messages/{en,pl}.ts`      | Namespace `failure.*`                                                                |

Dependency direction: `classify.ts` imports `#/server/repos/errors`, `#/server/auth/tenant`, `#/server/files/upload`,
`#/server/import/map` and `#/server/import/registry` (the three `RepositoryError` subclasses defined outside
`repos/errors.ts`), `#/server/billing/polar-client` (`instanceof` only), `#/lib/plans` (`isQuotaMetric`) and `zod`.
`envelope.ts` imports `classify.ts` types and `#/lib/failure-envelope`; `redact.ts` imports nothing; `middleware.ts`
imports the three and `@tanstack/react-start`. `src/lib/failure.ts` and `src/lib/failure-envelope.ts` import `zod` and
nothing from `server/`, so the browser bundle never reaches the server tree. None of the new server modules imports
`cloudflare:workers`: the default ports are built lazily inside `middleware.ts` and every test passes its own, so the
`server` vitest project runs them in plain Node.

## 📝 Data Model

None. No table, no column, no migration.

## 📝 API Contracts

**Kinds and statuses.** `retryable` is true exactly for `rate_limited` and `upstream`. `internal` is not retryable (a retry
of an unknown failure is a guess).

| Kind               | Status | Thrown values that classify to it                                                                                                                                                                                        |
| ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `unauthenticated`  | 401    | `AuthRequirementError` with `reason === 'unauthenticated'`                                                                                                                                                               |
| `forbidden`        | 403    | `ForbiddenError`; every other `AuthRequirementError`; `InvitationAddresseeError`                                                                                                                                         |
| `not_found`        | 404    | `NotFoundError`; the router's not-found sentinel                                                                                                                                                                         |
| `validation`       | 422    | `ZodError` (with `fields`); `UploadRejectedError`; `UnknownMappingColumnError`; `UnsupportedImportSourceError`                                                                                                           |
| `conflict`         | 409    | `ConflictError` and every subclass; `LastOwnerError`; `InvitationClosedError`                                                                                                                                            |
| `quota`            | 402    | `QuotaExceededError`                                                                                                                                                                                                     |
| `feature_locked`   | 402    | `FeatureLockedError`                                                                                                                                                                                                     |
| `rate_unavailable` | 422    | `RateUnavailableError`; `RateTimelineUnavailableError`                                                                                                                                                                   |
| `rate_limited`     | 429    | `PolarError` whose `status` is 429                                                                                                                                                                                       |
| `upstream`         | 502    | every other `PolarError`                                                                                                                                                                                                 |
| `internal`         | 500    | everything else: `TenantIsolationError`, `MissingTenantContextError`, `UnscopedWriteError`, `BillingConfigError`, every `MoneyError`, D1 errors, an unknown `RepositoryError` code, a plain `Error`, a non-`Error` value |

`unauthenticated` is the one kind this spec adds to the plan's ten (row 1). The default is `internal` and a value the
switch does not name is never classified as something friendlier (row 4 explains `TenantIsolationError` and the
`MoneyError` family: both signal a bug, and a `MoneyError` message embeds the amount). Matching is by `instanceof` or
by `RepositoryError.code`, never by `message` or `name`.

**Envelope** (a public surface; `v` is how the client keeps rendering an old shape while a new one rolls out):

```ts
type FailureEnvelope = {
  v: 1
  kind: FailureKind
  message: { key: FailureMessageKey; params?: { metric?: QuotaMetric } }
  fields?: Array<{ path: string; key: FailureFieldKey }> // validation only, at most 20
  retryAfter?: number // seconds, integer 1..3600; rate_limited and upstream only
}
```

- `message.key` comes from `FAILURE_MESSAGE_KEYS`, a total record from `FailureKind` to a literal `MessageKey`
  (`failure.internal`, `failure.not_found`, ...). A kind added without a key does not compile, and no key is built at
  runtime (`docs/I18N.md` §2.1). Per-kind keys only in this stage; a closed `reason` param can be added later without a
  version bump (row 2).
- `params.metric` is present for `quota` and for `feature_locked` and only when `isQuotaMetric(value)` holds; otherwise
  `params` is omitted. **Nothing else is a param.** `limit`, `current`, `planId`, an amount, a count, a name, an email, an
  entity and an id are not (rows 6 and 7). The plan is not in the envelope because the throw site does not know it; the
  screen already holds the workspace's plan, and `05-S2` resolves the ceiling from `PLANS` by plan and metric.
- `fields[].path` is a Zod issue `path` joined with `.`, kept only when every segment matches `^[A-Za-z0-9_]{1,64}$`, else
  the issue is reported at the form level (no `path`). `key` is a closed map from the Zod issue code (`invalid_type` with
  an undefined input, `too_small`, `too_big`, anything else) to `failure.field.required | tooShort | tooLong | invalid`.
  The issue's `message` and the rejected value are never read.
- The envelope has no `requestId`, no timestamp, no entity and no id: two failures of the same kind are byte-identical.
  `retryAfter` is never present on `not_found`. The Sentry event id `05-S2` shows is added by the report sink, not here.

**`PublicFailureError`.** `class PublicFailureError extends Error { readonly envelope: FailureEnvelope }`, constructed only
by the middleware. `message` is `FALLBACK_MESSAGES[kind]`, a constant English sentence per kind that says nothing about
the cause (`"You need to sign in to continue."` for `unauthenticated`; `"This could not be completed."` for the others),
`stack` is set to `''` after construction and `cause` is never set. A reader that still prints `error.message` shows the
fallback, which is why the unmigrated sites keep working as a generic line until `05-S2` re-points them (row 3).

**`readFailure(error: unknown): FailureEnvelope | null`.** Reads `error.envelope` (duck-typed: `instanceof` does not
survive the wire) and parses it with `failureEnvelopeSchema` (`z.strictObject`, `v: z.literal(1)`); an unknown `v` or
shape is `null`, so an old tab never throws on a newer shape and a newer tab against an older Worker falls back to its
generic panel.

**Middleware.** `createFailureMiddleware(ports)` with
`ports = { log(fields): void; report(fields, kind): void; setStatus(status): void }` returns a
`createMiddleware({ type: 'function' })` whose `.server` wraps `next()` in `try/catch`. `failureRedactionMiddleware` is
`createFailureMiddleware(defaultPorts)`: `defaultPorts.log` writes one `error`-level line through the existing logger
(`loggerFromEnv(env)`) with `redactError` output and the kind as its **only** fields; `report` is a no-op that `05-S3`
replaces; `setStatus` is `setResponseStatus` from `@tanstack/react-start/server`. The middleware calls `log` and `report`
with already-redacted fields only, so a sink cannot be handed a raw error by this module.

**Scrubber** (`redact.ts`), the executable form of the plan's list:

- `redact(value: unknown): unknown` is total: it never throws, caps depth at 8, string length at 512 and keys per object at
  100, breaks cycles, does not run getters that throw, ignores `__proto__`, and reduces a `bigint`, a `symbol`, a function,
  a `Map`, a `Set` and a typed array to a shape marker (`'[Map:3]'`).
- **Keys.** A key is split into lower-case words (`camelCase`, `snake_case`, `kebab-case`), each word loses a trailing `s`,
  and the separator-free key is also tested by substring for the long fragments. The value is **redacted** when any word is
  in the deny set `{ amount, minor, balance, limit, rate, note, payee, name, description, iban, email, filename, memo, alias,
text, title, label, message, body, content, comment, subject, merchant, counterparty, payer, recipient, phone, address,
token, secret, password, cookie, authorization, total, sum, price, cost, fee, value, bic, swift }`, when the **first** word
  is `ref`, when the words include `account` followed by `number`, or when the separator-free key contains `amount`,
  `balance`, `payee`, `description` or `iban`. A redacted value becomes its shape: `'[redacted:string]'`,
  `'[redacted:number]'`, `'[redacted:object]'`, and `'[array:N]'` for an array, so a count survives and the items do not.
- **Allow-list.** The case-sensitive full keys `errorName`, `kind`, `code`, `metric`, `module`, `organizationId`, `userId`,
  `id`, `requestId`, `route`, `queue` keep their value **only when it is a string matching `^[A-Za-z0-9_.:/$-]{1,128}$`**.
  A number or any other string under an allow-listed key is redacted. The list is an exported `ReadonlySet` of full keys,
  not a pattern.
- **Everything else.** Under a key that is neither denied nor allow-listed, a string survives only if it is id-shaped (the
  same charset, at most 64 characters); a number, a boolean and `null` survive as themselves only inside an array's count
  and as a bare `typeof` marker otherwise. This is the plan's "what survives is the shape: a count, a type, an id".
- **Strings, defence in depth.** Any string that survives has substrings shaped like a currency amount replaced by
  `'[amount]'`: an optional sign, an optional currency code or symbol on either side, digits with space, comma, dot or
  apostrophe grouping and an optional fraction of one to four digits. The expression is linear-time (no nested
  quantifier), proven by a test with a 100 000-digit string. It errs towards removal; a false positive on an id-like string
  is accepted.
- `redactError(error: unknown): { name: string; code?: string; frames: string[] }`. `name` is the constructor's name and
  `code` the `RepositoryError.code`, each kept only if it matches `^[A-Za-z][A-Za-z0-9_]{0,63}$` (any library can set
  `name`), else `'Error'` and absent. `frames` are the lines of `error.stack` that match `^\s+at ` after the exact
  `error.message` and the `name: message` header have been **removed from the stack string first** (a message holding a
  newline and `    at ...` must not be read as a frame), each at most 200 characters and passed through the amount
  pattern, at most 20. **Never `message`, never the stack header, never `cause`, never an `AggregateError` member** (row 3).

**Tenant isolation.** The classifier never reads `entity`, `id`, `message` or `name` of a `NotFoundError`; the `not_found`
envelope is built from a constant. The promise is exactly this and no more: the same status, headers and body for a
missing row and for another workspace's row (both pass through `rethrowAsNotFound` to `{"isNotFound":true}`), and no
timing-sensitive field in the envelope. Network timing equality is not claimed. `AuthRequirementError` reasons that
depend on workspace existence (`not-a-member`) all become `forbidden` with the same key and no reason, so a guessed
organization id does not become an existence oracle.

**Server functions, Zod, TenantScope:** none are added. The envelope is validated with Zod on the _client_ side
(`readFailure`), because that is where an untrusted shape arrives; the server builds it from closed sets.

## 📝 UI/UX

None in this stage beyond three behaviour-preserving moves in Phase 3 (`rules/new.tsx` and the two invitation branches
read the envelope kind instead of a substring or a message). No new component, token or route. `fields` exists so that
`05-S2` and the forms can attach a validation failure to an input with `aria-describedby`; no form is changed here.

## 📝 Edge Cases & Failure Scenarios

- **A control-flow throw.** `redirect()`, `notFound()` and a thrown `Response` are returned untouched. A test throws each
  through the middleware and asserts the same object comes out.
- **A handler that throws a non-`Error`.** A string, `null`, a number: `internal`, and `redactError` yields
  `{ name: 'NonError', frames: [] }`. Nothing about the value is logged.
- **A throw while building the envelope.** `buildEnvelope` and `redactError` are written not to throw; the middleware wraps
  both in a last-resort `try/catch` that falls back to the constant `internal` envelope, because turning a failure into a
  different failure is worse than saying nothing.
- **A sink that throws.** A throwing `log` or `report` is swallowed (the original failure still reaches the client). It is
  the only place the middleware writes to `console`, with a fixed string and no value.
- **A message with a newline.** `new Error('x\n    at fake (a.ts:1:1)')` yields no fake frame (the message is removed from
  the stack before parsing).
- **Zod issues on a nested array.** `path` `['lines', 2, 'amountMinor']` becomes `lines.2.amountMinor`; the field name is a
  code identifier, not user data. The issue message and the received value do not appear.
- **The framework's own log.** The framework `console.error`s whatever is thrown _to it_. After this spec that is the
  `PublicFailureError` (empty stack, fixed message), or the `notFound()` sentinel, so the line carries nothing.
- **An old open tab.** A tab from before the deploy keeps rendering `error.message`, now the fixed fallback. A tab after the
  deploy against an older Worker gets a plain `Error`; `readFailure` returns `null` and the caller falls back to its generic
  panel.
- **An unknown `RepositoryError` code.** `internal`; `classify.test.ts` builds one and asserts it.
- **A metric the catalogue does not know.** `QuotaExceededError('widgets', ...)` yields a `quota` envelope with no `params`.

## 📝 Risks & Impact Review

| Risk                                                          | Severity | Mitigation                                                                                                                                                       |
| ------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registering the boundary degrades 63 `error.message` readers  | Medium   | Phase 3 lands before Phase 4 and moves the three that branch; the rest print a true fixed sentence until `05-S2`; the Phase 4 PR says so in its first paragraph  |
| The deny list is too narrow and a name or amount gets through | High     | No message ever reaches a sink; unknown-key strings survive only if id-shaped; fuzz over casing, plurals and glued keys; narrowing the set is Ask First          |
| The allow-list carries money or a name                        | Medium   | Allow-listed keys keep only id-shaped strings; the fuzz case puts an amount and a name under every allow-listed key                                              |
| Over-redaction hides the cause of an `internal` failure       | Medium   | `name`, `code`, the kind and up to 20 stack frames survive; accepted until `OPEN-8` is decided and loosened by a later change, because a leak cannot be recalled |
| A cross-tenant read becomes distinguishable                   | High     | Constant `not_found` envelope; same sentinel wire; a case in `tenant-isolation.test.ts` through the real handler path; no timing claim is made                   |
| The boundary changes every server function at once            | Medium   | One global registration, one-line revert; `createFailureMiddleware(ports)` is tested without a Worker; Phase 4 probes the running app once                       |
| The scrubber's regular expression is slow in a Worker         | Low      | Linear-time expression, test with a 100 000-digit string, input capped at 512 characters before matching                                                         |

The spec PR is design-only and `risk-low`. Phases 1, 2 and 4 are data-protection and request-path code: their PRs are
`risk-high`, take the security specialist's verdict, and merge on the QA panel (ADR 0031). Backward compatibility: the
wire shape of a failing server function changes (a fixed message, an empty stack, an `envelope` property); no surface
listed in `BACKWARD_COMPATIBILITY.md` names the old shape, and `not_found` keeps its 404 sentinel.

## 📝 Visual change expected

None designed. No route or state changes on screen in either theme or viewport. The only screen-visible effect is that a
failure line which printed a repository sentence prints the fixed fallback (`05-S2` replaces those lines), and that the
locked-plan card on `/transactions/rules/new` starts to appear when a plan meters rules at zero (it is dead today, Problem
3). No browser evidence beyond the existing `not-found` and `tenant-isolation` specs, and no axe run.

## 📝 Copy

New catalogue keys, `en` text here, `pl` in the same change (`i18n-messages` skill). The set is closed: one per kind plus
the field keys. No key is built at runtime.

| Key                        | en                                                               |
| -------------------------- | ---------------------------------------------------------------- |
| `failure.internal`         | Something went wrong on our side.                                |
| `failure.unauthenticated`  | Sign in to continue.                                             |
| `failure.forbidden`        | You do not have access to this.                                  |
| `failure.not_found`        | This could not be found.                                         |
| `failure.validation`       | Check the highlighted fields and try again.                      |
| `failure.conflict`         | This conflicts with what is already saved. Reload and try again. |
| `failure.quota`            | Your plan has reached its limit for this.                        |
| `failure.feature_locked`   | This is not part of your plan.                                   |
| `failure.rate_unavailable` | No exchange rate is available for that date.                     |
| `failure.rate_limited`     | Too many requests. Try again shortly.                            |
| `failure.upstream`         | A service we depend on did not answer. Try again.                |
| `failure.field.required`   | This field is required.                                          |
| `failure.field.invalid`    | This value is not valid.                                         |
| `failure.field.tooShort`   | This value is too short.                                         |
| `failure.field.tooLong`    | This value is too long.                                          |

The Polish text is written by the implementer in the catalogue's voice. The fixed English fallbacks of
`PublicFailureError` are not catalogue strings: they are the last-resort `Error.message` of a value that has no locale, and
no screen is designed to show them.

## 📋 Phasing

Five tickets, in this order. The numbering is the dependency order.

1. **Phase 1 - the scrubber.** Independently shippable. Fixes Problem 2 (sink half).
2. **Phase 2 - classifier, envelope, keys, isolation case.** Independently shippable. Fixes Problems 1, 4, 5, 6.
3. **Phase 3 - the client reader and the three readers.** Blocked by Phase 2 (the schema). Fixes Problem 3.
4. **Phase 4 - the middleware.** Blocked by Phases 1 to 3. Fixes Problem 2 (wire half).
5. **Phase 5 - documents and `Delivered:`.** Blocked by 1 to 4. Fixes Problem 7.

## 📋 Implementation Plan

Every phase ends by running the gate: `node -e "require('./.ai/agentic.config.json').validation.commands.forEach(c=>console.log(c))"`
and every command in the order it prints, on the final commit, with `git add -A` first (the three `git diff --exit-code`
commands compare with the index); `pnpm test` takes 160-200 s, so run it with a 600000 ms timeout and its output in a file.
No `.skip`, `.only`, `.todo`, `@ts-expect-error` or `eslint-disable`; prettier-clean on what it touches.

### Phase 1 - the scrubber

1. **Red first**, `src/server/errors/__tests__/redact.test.ts` (the `server` project): _an amount never survives_
   (`{ amountMinor: 1234 }`, `{ ref_amount_minor: 1234 }`, `{ balance: 5 }`, `{ amounts: [1, 2] }`, `{ amountminor: 1 }`, and
   the strings `"paid 12,34 zł"` and `"EUR 1 234.50"`); _a payee name never survives_ (`{ payeeName: 'Biedronka' }`,
   `{ payee: { name: 'x' } }`, `{ 'payee-name': 'x' }`, `{ payee_names: ['x'] }`); _a nested amount inside a queue-envelope
   shaped object never survives_; an array under a denied key keeps only its count; an allow-listed key keeps an id-shaped
   string and loses a number and a name-shaped string with a space; an unknown key keeps an id-shaped string and loses
   `'Biedronka Sp. z o.o.'`; `redactError` never returns the message or the stack header for an `AliasTakenError`, an
   `InvalidAmountError('12.5')`, an `InvitationAddresseeError('a@b.c')` and an error whose `name` is `'x y'`; an error whose
   message is `"x\n    at fake (a.ts:1:1)"` yields no `fake` frame; a depth-5 fuzz case over generated nested objects whose
   money and name keys are camelCase, snake_case, kebab-case, plural and glued and whose leaves are amounts and names,
   asserting no leaf appears in `JSON.stringify(redact(x))`; a cyclic object, a 10 000-key object, a getter that throws, a
   `__proto__` key, a `BigInt`, a `Symbol` and a 100 000-digit string neither throw nor take more than a second.
2. **Write `redact.ts`** to turn it green. No import. The deny set, the long-fragment list and the allow-list are three
   exported `ReadonlySet`s so the test iterates them rather than copying them.
3. **Tenant isolation test:** none, no repository. **Money invariant:** the file is the invariant.

### Phase 2 - classifier, envelope, keys

4. **Red first**, `classify.test.ts`: one case per thrown class in the kinds table, each asserting kind, status and
   `retryable`; an unknown throw, a string, `null`, a plain `Error` and an unknown `RepositoryError` code are `internal`,
   500, and the envelope deep-equals `{ v: 1, kind: 'internal', message: { key: 'failure.internal' } }`; a `ZodError` becomes
   `validation` with `fields`, and `JSON.stringify(envelope)` contains neither the issue message nor the rejected value, and
   a path segment with a space is reported at form level; `QuotaExceededError('rules', 5, 4)` is 402 with `params` exactly
   `{ metric: 'rules' }` and the serialised envelope contains neither `5` nor `limit`, and `('widgets', 5, 4)` has no
   `params`; `InvitationAddresseeError('a@b.c')` serialises without the address; `AuthRequirementError` is 401 for
   `unauthenticated` and 403 with one identical envelope for each of the other six reasons; a `PolarError` with status 429
   is `rate_limited` and with 500 `upstream`; `TenantIsolationError` and a `MoneyError` are `internal`.
5. **Write `src/lib/failure-envelope.ts`, `envelope.ts` and `classify.ts`**; add the `failure.*` keys to `en.ts` and
   `pl.ts` (the parity test is in `pnpm test`).
6. **Tenant-isolation case** in `src/server/repos/__tests__/tenant-isolation.test.ts`, named _the failure for a missing row
   and for another workspace's row is byte-identical_: run the real scoped read on the harness database for a non-existent
   id and for B's id read through A's scope, pass each through `rethrowAsNotFound`, and assert the same sentinel
   (`JSON.stringify` equal); classify the underlying `NotFoundError`s and assert equal envelopes, status and serialised
   bytes, with different entities and ids and no id or entity in the string; the envelope has no `requestId`, timestamp or
   `retryAfter`.
7. **Money invariant:** the `classify.test.ts` case that a `QuotaExceededError` never puts a number in `params`, plus
   Phase 1's file.

### Phase 3 - the client reader and the three readers

8. **Red first**, `src/lib/__tests__/failure.test.ts`: `readFailure` returns the envelope for a `PublicFailureError`-shaped
   object, `null` for `new Error('x')`, `null` for `v: 2`, `null` for an extra key, and never throws on `undefined`.
9. **Write `src/lib/failure.ts`**, then move `rules/new.tsx` to `readFailure(error)?.kind === 'feature_locked'` (with a
   component test that the locked card renders for a `PublicFailureError` of that kind and that the generic failure line
   renders for any other), and `invite.$invitationId.tsx` to `kind === 'unauthenticated'` in `isUnauthenticated` and in the
   accept handler's `toast.error` branch (an `unauthenticated` kind navigates to sign-in as the loader does; any other kind
   keeps the toast). `error.name === 'AuthRequirementError'` stays as a second condition for one release; the message regex
   goes.
10. A test (`src/lib/__tests__/failure-readers.test.ts`, the `server` project) asserts no file under `src/routes` or
    `src/components` matches `/message\.includes\(['"][A-Z_]+['"]\)/` or `/test\(\w+\.message\)/`, the pattern of the old
    leak.

### Phase 4 - the middleware

11. **Red first**, `src/server/errors/__tests__/middleware.test.ts`, running `createFailureMiddleware` with spy ports: the
    order is classify, redact, `log`, `report`, `setStatus`, throw (assert call order, and that **neither port receives a
    value containing the amount or the payee name** placed in the thrown error's message, its `cause` and an own property,
    and that `log` receives no `errorMessage`, `errorStack` or `errorCause` key); a thrown `new Error('postgres://u:p@h')`
    leaves as a `PublicFailureError` with `kind: 'internal'`, empty `stack`, no `cause`, and a serialisation run through
    seroval's `toCrossJSONAsync` that contains none of the original text and no file path; `redirect`, `notFound` and
    `Response` pass through as the same object; a `NotFoundError` leaves as the sentinel; a throwing port does not change
    what is thrown; a **ledger flush** case runs a handler that opens `runWithLedgerBatch`, touches an account and throws,
    and asserts the flush ran before the middleware's `catch`. Where the `server` project cannot import
    `createMiddleware` without the Start context, follow the `vi.mock` pattern of
    `src/server/fns/__tests__/attachments.test.ts`, which `vitest.config.ts` allows.
12. **Write `middleware.ts`** and set `functionMiddleware: [failureRedactionMiddleware]` in `src/start.ts`; rewrite its
    docblock (it says the boundary will be registered "when there is any").
13. **Probe the running app once** (agent ports 3011-3020, `docs/agents/shared-checkout.md`): force one server function to
    throw an `Error` containing a recognisable string from its handler and one from inside `authMiddleware`, read the HTTP
    status and body, and record both in the PR (the status is the kind's, the body contains the envelope and not the string,
    and no `Server Fn Error!` line carries it). This is the one claim the unit tests cannot prove, because they bypass the
    framework (Resolved assumptions row 12). Then run `e2e/not-found.spec.ts` and `e2e/tenant-isolation.spec.ts` once; both
    must stay green. The PR body's first paragraph states that 63 `error.message` sites now print a generic sentence
    until `05-S2`.

### Phase 5 - documents

14. Edit `docs/SECURITY.md` §6.1 (name `redactError`, what survives and the residual gap, and drop the sentence that says
    constructors already take structured fields), `docs/ARCHITECTURE.md` §10 and §11, `src/server/repos/errors.ts`'s header
    (point at `classify.ts`), and `docs/plans/05-error-and-observability.md`: the `05-S1` Owned paths gain the files this
    spec adds, the kinds list gains `unauthenticated`, the Quota paragraph says the envelope carries the metric and the plan
    is resolved by the screen, `05-S3`'s Server paragraph gains "route the API routes, the queue handlers and the Durable
    Object through the same scrubber", and the stage gets a `Delivered:` line once every phase has merged. Run
    `pnpm generate-spec-index`.

## 📝 Resolved assumptions (autonomous defaults)

Every row is a decision this run made without a human, or a default it applied; each is reversible before merge by saying so
on the spec PR.

| #   | Question                                                                         | Applied default                                                                                                                                                                                                                                                                                                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Is the stage delivered, or does it get a spec?                                   | **A spec.** No owned path exists; `src/start.ts` registers no middleware; the logger still writes `errorMessage` and `errorStack`.                                                                                                                                                                                                                          | Checked step 1 of `afk-plan-to-spec`: `05-S1` is in no spec, issue or open PR, and the plan carries no `Delivered:` line for it.                                                                                                                                                                                                                                                                                                                                             |
| 2   | What kind does an unauthenticated request take?                                  | **Add `unauthenticated` (401); every other `AuthRequirementError` reason is `forbidden` (403) with one identical envelope.**                                                                                                                                                                                                                                | Decided by software architect sub-agent (confidence medium): collapsing 401 into `forbidden` would erase the one distinction the invitation loader and `_app.tsx` act on; a union member is additive under `v: 1`. The security reviewer's condition that `not-a-member` must not be distinguishable is met by the single `forbidden` envelope.                                                                                                                              |
| 3   | One key per kind, or a reason key as well? `rate_limited` and `upstream`?        | **Per-kind keys only; both kinds stay; `PolarError` with status 429 is `rate_limited`, any other `PolarError` is `upstream`; no speculative `RATE_LIMITED` code.**                                                                                                                                                                                          | Decided by software architect sub-agent (confidence medium): dropping a named kind later is a breaking narrowing of a versioned union, keeping it costs two table rows; a closed `reason` param can be added without a version bump.                                                                                                                                                                                                                                         |
| 4   | What may a log or Sentry sink see of an `Error`?                                 | **`name`, `code`, the kind and up to 20 stack frames (message and header removed from the stack first, strict frame match). Never `message`, `cause` or an `AggregateError` member. The raw error is never handed to `logger.error`.**                                                                                                                      | Decided by security and tenancy reviewer sub-agent (confidence high): `AliasTakenError`, `InvitationAddresseeError`, `ConflictError` sentences and `InvalidAmountError` interpolate names, emails and amounts, so "classified, therefore safe" is false; the amount pattern misses bare minor-unit integers; the restriction can be loosened after `OPEN-8`, a leak cannot be recalled. Found while verifying: the existing `serializeError` emits message, stack and cause. |
| 5   | How do `TenantIsolationError` and the `MoneyError` family classify?              | **Both `internal`.**                                                                                                                                                                                                                                                                                                                                        | Decided by security and tenancy reviewer sub-agent (confidence high): `TenantIsolationError` fires on a patch carrying `organizationId` or on a queue-row mismatch, both bugs, and the plan forbids a friendlier default; the log keeps its class name at `error` level. The architect's table had `not_found` and deferred to this verdict. A `MoneyError` message embeds the amount.                                                                                       |
| 6   | How does the middleware speak, and where is it registered?                       | **Global `functionMiddleware` in `src/start.ts`; `not_found` leaves as the router's `notFound()` sentinel; every other kind as a `PublicFailureError` (fixed per-kind message, empty stack, no `cause`, one `envelope` property) with the status set by `setResponseStatus`; control-flow throws pass through; `readFailure` duck-types `error.envelope`.** | Decided by software architect sub-agent (confidence medium): deferring registration would ship OBS-03 "done" without running; leaving `not_found` as an envelope would change the 404 wire shape that `rethrowAsNotFound` and two e2e specs rely on; a per-call-site list is the forgotten-one failure the plan exists to prevent.                                                                                                                                           |
| 7   | What does a quota or feature-locked envelope carry?                              | **`params.metric` only, validated with `isQuotaMetric`, else no `params`. No `limit`, `current`, `planId`, count or amount. `QuotaExceededError` is not changed.**                                                                                                                                                                                          | Decided by security and tenancy reviewer sub-agent (confidence medium): `limit` and `current` are redundant (the screen resolves the ceiling from `PLANS`) and the scrubber redacts `limit` by key; `metric` is a free string at the throw site. Architect condition met: the middleware must not invent a plan.                                                                                                                                                             |
| 8   | The plan says the quota envelope carries "the plan".                             | **It does not; the screen holds the workspace's plan and `05-S2` resolves the ceiling from it. Phase 5 amends the plan text.**                                                                                                                                                                                                                              | Default applied: no throw site knows the plan, and `assertWithinLimit` only holds a resolver result. Adding a field to `QuotaExceededError` would be a wider change than the stage.                                                                                                                                                                                                                                                                                          |
| 9   | Is the deny list in the plan sufficient?                                         | **No. Word and substring matching with plurals and glued forms, a wider set (free text, secrets, totals, bank identifiers), first word `ref`, an allow-list that keeps only id-shaped strings, and unknown-key strings surviving only if id-shaped.**                                                                                                       | Decided by security and tenancy reviewer sub-agent (confidence medium): the plan's fragments miss `amounts`, `payeename`, `text`, `title`, `token` and similar; an exact allow-listed key can still carry a name or a number; bare digits cannot be matched without redacting every number, so unknown strings must be shape-limited.                                                                                                                                        |
| 10  | Who is the sink during this stage?                                               | **`log` is the existing logger fed `redactError` fields and the kind only; `report` is a no-op port that `05-S3` replaces. The API routes, queue handlers and the Durable Object are outside the boundary until `05-S3`, and the spec says so.**                                                                                                            | Default applied after the security reviewer's finding that "wraps every server function" does not cover them; `05-S3` owns Sentry and the logger.                                                                                                                                                                                                                                                                                                                            |
| 11  | `rules/new.tsx` tests `message.includes('FEATURE_LOCKED')`: keep, move or leave? | **Move it to the envelope kind in Phase 3, with a component test.**                                                                                                                                                                                                                                                                                         | Default applied after the architect's finding (verified: `FeatureLockedError`'s message does not contain the code) that the branch is dead today; moving it makes the locked card appear, which the file's own docblock says is intended.                                                                                                                                                                                                                                    |
| 12  | What does the stage promise about indistinguishability?                          | **The same status, headers and body for a missing row and another workspace's row, a constant `not_found` envelope built from no input of the error, and no timing-sensitive field. Network timing equality is not claimed.**                                                                                                                               | Decided by security and tenancy reviewer sub-agent (confidence high): the classifier must not read `entity`, `id`, `message` or `name`, and the test must go through the real handler path, not only compare built envelopes.                                                                                                                                                                                                                                                |
| 13  | Is the unit test enough for the framework wiring?                                | **No. Phase 4 probes the running app once (status and body of a forced failure in a handler and in `authMiddleware`) and records it in the PR.**                                                                                                                                                                                                            | Decided by software architect sub-agent (confidence medium): per `AGENTS.md`, a claim about what a library does is probed once; the unit tests bypass the framework.                                                                                                                                                                                                                                                                                                         |
| 14  | Which numbers in this spec are measured?                                         | The 63 `error.message` lines and 46 files; the seroval wire content; the line range of the framework handler; seven `AuthFailureReason` values.                                                                                                                                                                                                             | `grep -rn` for `error.message`, `err.message` and `.message)` over non-test files in `src/routes` (63); `grep -rln 'error.message' src/routes` (46); a `node` probe of seroval 1.5.6 `toCrossJSONAsync` on an `Error` subclass with an own property (the output carries `message`, `name`, `stack` and the property); `sed -n 170,215p` of `server-functions-handler.js`; `sed` of `src/server/auth/tenant.ts`.                                                              |
