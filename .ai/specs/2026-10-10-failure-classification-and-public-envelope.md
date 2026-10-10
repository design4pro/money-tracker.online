# Failure classification, the public envelope and the redaction middleware (plan stage 05-S1)

| Field              | Value                                            |
| ------------------ | ------------------------------------------------ |
| **Status**         | ready                                            |
| **Issue**          | none                                             |
| **Spec PR**        | #634                                             |
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

**What not shipping costs.** Today the browser receives, and Workers logs record, repository sentences with a stack and
absolute paths. Those sentences can hold a normalised payee name (`AliasTakenError`), an invitee's email
(`InvitationAddresseeError`) and a rejected amount (`InvalidAmountError`). `05-S2` (the error panel) and `05-S3` (the logger
and Sentry) both reuse this stage's envelope and scrubber, and `docs/plans/24-console.md` line 125 redacts its audit log
through it, so none of them can start honestly before it.

**What the code already delivers**

- `src/server/repos/errors.ts` is the one family of refusals, each with a stable `code`; its header says the failure
  classifier "has a single thing to switch on". `AuthRequirementError` (`src/server/auth/tenant.ts`) carries `status`
  401 or 403 and a `reason`.
- `src/server/fns/not-found.ts` turns a repository `NOT_FOUND` into the router's `notFound()` sentinel at eight call
  sites (all reads; the 51 `new NotFoundError` sites in `src/server/repos` also include writes that do not pass
  through it), so a missing row and another workspace's row already leave identically on those reads (`e2e/not-found.spec.ts`,
  `e2e/tenant-isolation.spec.ts`).
- `src/server/observability/logger.ts` is a structured JSON logger with a sink port; its `error()` writes
  `errorName`, `errorMessage`, a 2000-character `errorStack` and the cause's message.
- `src/server/ledger/batch.ts` flushes the ledger collector in a `finally`, inside the handler body.
- `createStart` accepts `functionMiddleware`; `src/start.ts` passes `{}`.

**What does not hold**

1. **No classifier, no envelope, no scrubber, no middleware.** `src/server/errors/` does not exist.
2. **The framework publishes the raw error.** Read in the installed sources (`@tanstack/start-client-core` 1.170.27
   `createServerFn.js`, `executeMiddleware`; `@tanstack/start-server-core` 1.169.31 `server-functions-handler.js`): an error
   thrown by a handler, a per-function middleware or an input validator is caught by `callNextMiddleware` and returned as
   `{ ...ctx, error }`. `handleServerAction` then serialises that whole `{ result, error, context }` object with seroval's
   `toCrossJSONStream` and answers with `getResponse().status`, which is 200 unless something set it. A probe with seroval
   1.6.4 (the version the lockfile resolves for the TanStack packages) on an `Error` subclass with one own property shows the wire carries `message`, `name`, **`stack`** (absolute file
   paths) and the own property, and the client rebuilds a real `Error` from it. A repository sentence such as
   `AliasTakenError`'s (it interpolates a normalised payee name), `InvitationAddresseeError`'s (an email) or
   `InvalidAmountError`'s (`Not an integer minor-unit amount: 12.5`) therefore reaches the browser today. A log filter alone
   cannot fix this: the thrown value has to be replaced, and the status has to be set by the middleware. A second path
   exists and is **outside** this boundary, stated as a residual: the outer `catch` in `handleServerAction` (lines 179 to 200) serves failures that happen before the chain runs (a malformed payload, an unknown function id, an oversized
   payload) by `console.error`ing the raw error and serialising it with its stack and `getResponse().status ?? 500`. No
   function middleware can wrap it; it carries framework text, not repository text, and Phase 5 records it in
   `docs/SECURITY.md` §6.1.
3. **Client code reads `error.message`, 63 times.** A grep over non-test files in `src/routes` for `error.message`,
   `err.message` and `.message)` finds 63 lines, 46 files containing `error.message`: `detail={error.message}` in route error components, `setFailure(error.message)` in dialogs, and
   `toast.error(error.message)` in the members screen and the invitation route. Three branch on it:
   `rules/new.tsx` tests `message.includes('FEATURE_LOCKED')`, `invite.$invitationId.tsx` tests
   `error.name === 'AuthRequirementError'` or `/sign in to continue/i`, and its accept handler prints
   `toast.error(error.message)`. The first of those is **dead today**: `FeatureLockedError`'s message is `The <module>
module is not included in this plan.` and `FEATURE_LOCKED` is only its `code`, so the locked-plan upgrade card never
   appears. Moving that reader to the envelope makes it start working, which is a behaviour change and gets a test.
4. **The plan's taxonomy is short one kind.** `AuthRequirementError` is 401 for an anonymous request and 403 for six other
   reasons; none of the ten kinds says "sign in", and the invitation loader already treats "not signed in"
   differently from "refused" (`_app.tsx` returns `null` for every `AuthRequirementError`, so it does not).
5. **`QuotaExceededError` has no plan.** The stage says its envelope carries "the metric and the plan"; the error carries
   `metric`, `limit` and `current`, and `assertWithinLimit` (`src/server/repos/base.ts`) holds a resolver result but no
   plan id. The middleware must not invent one.
6. **`rate_limited` has no thrower of its own.** Better Auth's limit is its own endpoint (`auth.error.rateLimited`).
   `PolarError` carries the provider's HTTP status, so a 429 from the provider is the one real source.
7. **A server-function input failure is not a `ZodError`.** Every `createServerFn` here uses `.inputValidator(schema)` with
   a Zod 4 schema. In `@tanstack/start-client-core` (`createServerFn.js`, `execValidator`, lines 168 to 178) a schema with
   `~standard` is validated and, on issues, the framework throws `new Error(JSON.stringify(result.issues, undefined, 2))`: a
   plain `Error` whose message is the issues' JSON, and which runs inside the middleware chain, so a global middleware sees
   it. Under the rule "never classify by message" every bad input would be `internal` 500 and `validation` with `fields`
   would be reachable only from a repository's second parse. The classifier therefore needs one narrow, named exception
   (row 15).
8. **Documents describe the code as built.** `docs/SECURITY.md` §6.1 and `docs/ARCHITECTURE.md` §10 and §11 say
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
5. The sinks receive `redactError(e)` plus the kind, **before** any sink is called; `redactError` output is already final and is not passed through `redact()` again. The log
   port writes those fields only (it is never handed the raw error, because `logger.error(msg, error)` would emit
   `errorMessage` and `errorStack`); the report port is a no-op until `05-S3` installs Sentry (row 9).
6. A `notFound()` sentinel already thrown (by `rethrowAsNotFound` on the eight reads, row 5) passes through under step 2, so its wire and
   status stay what `e2e/not-found.spec.ts` relies on today. A **raw** `NotFoundError` (the 51 repository sites, writes among
   them, that no `rethrowAsNotFound` wraps) is not turned into the sentinel: a dialog that prints `String(error)` would show
   `[object Object]`, and today it shows the repository's sentence. It takes the same path as every other kind: it sets the
   response status and throws a `PublicFailureError` of kind `not_found` with a constant envelope. For
   every kind that is not a pass-through it sets the response status and throws a `PublicFailureError`: an `Error` whose `message` is a fixed
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

| Concept                               | Owner module                            | Seam this spec touches                                                                                                                                    |
| ------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What may leave in a payload or a sink | `src/server/errors/redact.ts` (new)     | `redact(value)`, `redactError(error)`; the only deny list in the repository                                                                               |
| Which kind a thrown value is          | `src/server/errors/classify.ts` (new)   | `classifyFailure(error)`; the only switch on a `RepositoryError.code`                                                                                     |
| What the client is told               | `src/server/errors/envelope.ts` (new)   | `buildEnvelope`; reads `FAILURE_MESSAGE_KEYS` from the shared module                                                                                      |
| The envelope's shape, both sides      | `src/lib/failure-envelope.ts` (new)     | `FailureEnvelope` type, `failureEnvelopeSchema`, `FAILURE_KINDS`, `FAILURE_MESSAGE_KEYS`, `FAILURE_FIELD_KEYS`; isomorphic, the one owner of the key list |
| The boundary                          | `src/server/errors/middleware.ts` (new) | `failureRedactionMiddleware`, `createFailureMiddleware(ports)`, `PublicFailureError`                                                                      |
| Reading an envelope in the browser    | `src/lib/failure.ts` (new)              | `readFailure(error)`                                                                                                                                      |
| Where the boundary is installed       | `src/start.ts`                          | `functionMiddleware: [failureRedactionMiddleware]`                                                                                                        |
| Copy for each key                     | `src/lib/i18n/messages/{en,pl}.ts`      | Namespace `failure.*`                                                                                                                                     |

Dependency direction: `classify.ts` imports `#/server/repos/errors`, `#/server/auth/tenant`, `#/server/files/upload`,
`#/server/import/map` and `#/server/import/registry` (the three `RepositoryError` subclasses defined outside
`repos/errors.ts`), `#/server/billing/polar-client` (`instanceof` only), `#/server/ledger/rates` (`RateTimelineUnavailableError`), `#/lib/money/types` (`MoneyError`), `#/lib/plans` (`isQuotaMetric`), `isNotFound` from `@tanstack/react-router` and `zod`; `middleware.ts` also imports `isRedirect`, `isNotFound` and `notFound`.
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
| `not_found`        | 404    | `NotFoundError`; the router's not-found sentinel (the sentinel passes through unchanged, only the raw error is wrapped)                                                                                                  |
| `validation`       | 422    | `ZodError` (with `fields`); the framework's input-validation `Error` (row 15); `UploadRejectedError`; `UnknownMappingColumnError`; `UnsupportedImportSourceError`                                                        |
| `conflict`         | 409    | `ConflictError` and every subclass; `LastOwnerError`; `InvitationClosedError`                                                                                                                                            |
| `quota`            | 402    | `QuotaExceededError`                                                                                                                                                                                                     |
| `feature_locked`   | 402    | `FeatureLockedError`                                                                                                                                                                                                     |
| `rate_unavailable` | 422    | `RateUnavailableError`; `RateTimelineUnavailableError`                                                                                                                                                                   |
| `rate_limited`     | 429    | `PolarError` whose `status` is 429                                                                                                                                                                                       |
| `upstream`         | 502    | every other `PolarError`                                                                                                                                                                                                 |
| `internal`         | 500    | everything else: `TenantIsolationError`, `MissingTenantContextError`, `UnscopedWriteError`, `BillingConfigError`, every `MoneyError`, D1 errors, an unknown `RepositoryError` code, a plain `Error`, a non-`Error` value |

`unauthenticated` is the one kind this spec adds to the plan's ten (row 1). The default is `internal` and a value the
switch does not name is never classified as something friendlier (row 4 explains `TenantIsolationError` and the
`MoneyError` family: both signal a bug, and a `MoneyError` message embeds the amount). Matching is by `instanceof` or by `RepositoryError.code`, never by `message` or `name`, with **one named exception**: the
framework's own input-validation failure (Problem 7). `isInputValidationError(e)` is true only when `e` is a plain `Error`
(constructor `Error`) whose `message` parses as JSON into a non-empty array of at most 100 objects that each have a `path`
array of strings and numbers and a string `code`. When it is true the classifier reads **only `path` and `code`** from each
issue (the `message`, `input`, `expected` and every other key are discarded), and the result is `validation`. A handler that
throws some other plain `Error` is `internal`, and a deliberately forged JSON message can only produce a `validation`
envelope built from sanitised paths and closed codes, never carry text.

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
- `fields[].path` is a Zod issue `path` (from `ZodError.issues` or from the framework's validator error) joined with `.`, kept only when every segment matches `^[A-Za-z0-9_]{1,64}$` (a numeric segment is an array index). A segment that is a record key typed by the user (Zod 4 gives `['b', 'Biedronka']`) cannot be told apart from a field name by shape; the residual is accepted and stated: `fields` goes only to the caller who sent that input and is never handed to a sink (the sinks receive `redactError` output and the kind only), so nothing is disclosed to anyone else. `key` is a closed map from the Zod issue code alone (`too_small` to `tooShort`, `too_big` to `tooLong`, anything else, including
  `invalid_type`, to `invalid`) to `failure.field.tooShort | tooLong | invalid`. `required` is dropped: Zod 4's `invalid_type` issue carries no
  received value, only a `message`, which is never read, so "missing" cannot be told from "wrong type" without reading text.
  The issue's `message` and the rejected value are never read.
- The envelope has no `requestId`, no timestamp, no entity and no id: two failures of the same kind are byte-identical.
  `retryAfter` is **omitted in this stage** for every kind (`PolarError` carries no `Retry-After`, and a throw site that knew one would still have to clamp it); the field stays in the type for the stage that has a source. It is never present on `not_found`. The Sentry event id `05-S2` shows is added by the report sink, not here.

**`PublicFailureError`.** `class PublicFailureError extends Error { readonly envelope: FailureEnvelope }`, constructed only
by the middleware. `message` is `FALLBACK_MESSAGES[kind]`, a constant English sentence per kind that says nothing about
the cause (`"You need to sign in to continue."` for `unauthenticated`; `"This could not be completed."` for the others),
`stack` is set to `''` after construction and `cause` is never set. A reader that still prints `error.message` shows the
fallback, which is why the unmigrated sites keep working as a generic line until `05-S2` re-points them (row 3).

**`readFailure(error: unknown): FailureEnvelope | null`.** Reads `error.envelope` (duck-typed: `instanceof` does not
survive the wire) and parses it with `failureEnvelopeSchema` (`z.object` at the top level and for `params`, so an unknown extra key is ignored and a new `params` key needs no version bump; `v: z.literal(1)`); an unknown `v` or
shape is `null`, so an old tab never throws on a newer shape and a newer tab against an older Worker falls back to its
generic panel.

**Middleware.** `createFailureMiddleware(ports)` with
`ports = { log(fields): void; report(fields, kind): void; setStatus(status): void }` returns a
`createMiddleware({ type: 'function' })` whose `.server` wraps `next()` in `try/catch`. `failureRedactionMiddleware` is declared as one top-level `createMiddleware(...).server(...)` constant with the server-only imports reached only from inside the `.server()` closure, the shape `src/server/middleware/auth.ts` already uses, so the build strips them from the client chunk; Phase 4's build check proves it. A thrown `Response` passes through untouched: no site under `src/` throws one today (`grep -rn "throw new Response" src` is empty), and a test pins the pass-through so a future one is a conscious choice. `failureRedactionMiddleware` is
`createFailureMiddleware(defaultPorts)`: `defaultPorts.log` writes one `error`-level line through the existing logger
(`loggerFromEnv(env)`) with `redactError` output and the kind as its **only** fields; `report` is a no-op that `05-S3`
replaces; `setStatus` is `setResponseStatus` from `@tanstack/react-start/server`. The middleware calls `log` and `report`
with already-redacted fields only, so a sink cannot be handed a raw error by this module.

**Scrubber** (`redact.ts`), the executable form of the plan's list:

- `redact(value: unknown): unknown` is **default-deny and total**. It never throws and it never invokes user code: it
  reads own data properties through `Object.getOwnPropertyDescriptor` only, renders an accessor as `'[getter]'`, does not
  touch a `Proxy` (a value for which the descriptor read throws is `'[unreadable]'`), ignores `__proto__`, breaks cycles,
  and caps depth at 8, string length at 512 and keys per object at 100. A `bigint`, a `symbol`, a function, a `Map`, a
  `Set`, a typed array and a `Date` reduce to a shape marker (`'[Map:3]'`). An `Error` nested in a payload reduces to
  `redactError`'s result with the frames dropped (`{ name, code }`).
- **Keys of the output.** A key is emitted only if it matches `^[A-Za-z][A-Za-z0-9_]{0,63}$`; any other key (a payee, a
  category or a CSV header used as a record key) becomes `'[key:N]'` with `N` the key's position among the object's own
  keys, so two such keys never collide. A record keyed by user text loses every key that is not identifier-shaped (`'Biedronka Sp. z o.o.'`, a CSV header with a space). An identifier-shaped record key (`'Biedronka'`) cannot be told apart from a field name by shape and survives in key position: a stated residual, latent in this stage because `redact()` has no sink consumer until `05-S3` and `docs/plans/24-console.md` use it, and each of them must not hand it a record keyed by user text.
- **Keys that deny.** A key is split into lower-case words (`camelCase`, `snake_case`, `kebab-case`, and ALLCAPS runs); each
  word loses a trailing `s`, and **each deny word is normalised the same way** (`address` and `alias` are stored as
  `addres` and `alia`), so a plural never slips past; the separator-free key is also tested by substring for the long
  fragments. The value is **redacted** when any word is in the deny set `{ amount, minor, balance, limit, rate, note,
payee, name, description, iban, email, filename, memo, alias, text, title, label, message, body, content, comment, subject,
merchant, counterparty, payer, recipient, phone, address, token, secret, password, cookie, authorization, total, sum,
price, cost, fee, value, bic, swift, key, signature, jwt }`, when the **first** word is `ref`, when the words include
  `account` followed by `number`, or when the separator-free key contains `amount`, `balance`, `payee`, `description`,
  `iban`, `name` or `token`. A redacted value becomes its shape: `'[redacted:string]'`, `'[redacted:number]'`,
  `'[redacted:object]'`, and `'[array:N]'` for an array, so a count survives and the items do not.
- **Allow-list, the only way a string survives.** The allow-list is evaluated **before** the deny rule and still applies its id-shape check (`errorName` holds the deny word `name`, and still survives when it is id-shaped). The case-sensitive full keys `errorName`, `kind`, `code`, `metric`,
  `module`, `organizationId`, `userId`, `id`, `requestId`, `route`, `queue` keep their value **only when it is a string
  matching `^[A-Za-z0-9_.:/$-]{1,128}$`**. A number or any other string under an allow-listed key is redacted. The list is
  an exported `ReadonlySet` of full keys, not a pattern.
- **Everything else is shape only.** Under a key that is neither denied nor allow-listed, **no string value survives**:
  it becomes `'[redacted:string]'`. A number becomes `'[redacted:number]'`; a boolean and `null` survive as themselves
  (they carry one bit); `undefined` is dropped; an array becomes `'[array:N]'` and an object recurses with the same rules.
  This is the plan's "what survives is the shape: a count, a type, an id", and an id is whatever an allow-listed key holds.
  A single-token name (`lastname: 'Kowalski'`), an IBAN or a 40-character token under an invented key is therefore removed
  by default, not by a deny word.
- **Strings, defence in depth.** An allow-listed string additionally has substrings shaped like a currency amount replaced
  by `'[amount]'`: an optional sign, an optional currency code or symbol on either side, digits with space, no-break space
  (U+00A0), narrow no-break space (U+202F), comma, dot or apostrophe grouping and an optional fraction of one to four
  digits. The expression is linear-time (no nested quantifier), and the 100 000-digit linearity test runs on the exported
  expression itself, because the 512-character cap would make a test through `redact()` vacuous. It errs towards removal;
  a false positive on an id-like string is accepted.
- `redactError(error: unknown): { name: string; code?: string; frames: string[] }` is **final output**: it is the value
  the sinks receive and it is **not** passed through `redact()` again (a frame has spaces and parentheses, so the
  default-deny rule would drop every frame, and `frames` is deliberately not an allow-listed key). `name` is the
  constructor's name and `code` the `RepositoryError.code`, each kept only if it matches `^[A-Za-z][A-Za-z0-9_]{0,63}$`
  (any library can set `name`), else `'Error'` and absent. `frames` come from `error.stack` only when `stack` is a string
  (a non-string, absent or throwing `stack` yields `[]`); the stack is first rebuilt by **removing the current
  `error.message` and the `name: message` header from it, and every line that is not a strict frame match
  `^\s+at \S` afterwards is discarded** (a message holding a newline and `    at ...`, or a `message` mutated after
  construction so the header is stale, must not be read as a frame), each frame at most 200 characters and passed through
  the amount pattern, at most 20. **Never `message`, never the stack header, never `cause`, never an `AggregateError`
  member** (row 3). An `Error` subclass with own enumerable properties yields none of them.

**Tenant isolation.** The classifier never reads `entity`, `id`, `message` or `name` of a `NotFoundError`; the `not_found`
envelope is built from a constant. The promise is exactly this and no more: the same status, headers and body for a
missing row and for another workspace's row (on the eight reads both pass through `rethrowAsNotFound` to `{"isNotFound":true}`; a raw `NotFoundError` from either leaves as the same constant `not_found` envelope), and no
timing-sensitive field in the envelope. Network timing equality is not claimed. `AuthRequirementError` reasons that
depend on workspace existence (`not-a-member`) all become `forbidden` with the same key and no reason, so a guessed
organization id does not become an existence oracle. One residual is named and left unchanged: `InvitationAddresseeError` is `forbidden` while an unknown invitation id is `not_found`, an existence signal for an authenticated caller on an unguessable single-use id, which the repository header already accepts.

**Server functions, Zod, TenantScope:** none are added. The envelope is validated with Zod on the _client_ side
(`readFailure`), because that is where an untrusted shape arrives; the server builds it from closed sets.

## 📝 UI/UX

None in this stage beyond three moves in Phase 3 (`rules/new.tsx` and the two invitation branches read the envelope kind
instead of a substring or a message). The two invitation moves are required, because after Phase 4 the error's `name` is
`PublicFailureError`. The `rules/new.tsx` move is not required for non-regression, is separable, and has no user-visible
effect today: no plan in `src/lib/plans.ts` meters rules at zero (free 3, plus 20, household unlimited), so the locked card has
no live trigger yet. The Phase 3 PR says so. No new component, token or route. `fields` exists so that
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
  code identifier for a schema-defined key (see the record-key residual above). The issue message and the received value do not appear.
- **The framework's own log.** A handler failure does not reach the framework's `catch`: the chain returns it as data, so the framework logs nothing for it. The `catch` serves only failures before the chain runs (Problem 2, the stated residual), and those carry framework text, not repository text.
- **An old open tab.** A tab from before the deploy keeps rendering `error.message`, now the fixed fallback. A tab after the
  deploy against an older Worker gets a plain `Error`; `readFailure` returns `null` and the caller falls back to its generic
  panel.
- **An unknown `RepositoryError` code.** `internal`; `classify.test.ts` builds one and asserts it.
- **A metric the catalogue does not know.** `QuotaExceededError('widgets', ...)` yields a `quota` envelope with no `params`.

## 📝 Risks & Impact Review

| Risk                                                                                                                                                                                    | Severity | Mitigation                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registering the boundary degrades 63 `error.message` readers: a conflict or validation sentence a dialog shows today (for example "alias taken") becomes "This could not be completed." | High     | Phase 3 lands before Phase 4 and moves the three that branch; the rest print a true fixed sentence until `05-S2`; the Phase 4 PR says so in its first paragraph and **files a follow-up issue naming the sites if no `05-S2` spec or ticket exists by then**, so the loss is owned |
| The deny list is too narrow and a name or amount gets through                                                                                                                           | High     | No message ever reaches a sink; no string survives under an unknown key (default-deny); fuzz over casing, plurals and glued keys; narrowing the set is Ask First                                                                                                                   |
| The allow-list carries money or a name                                                                                                                                                  | Medium   | Allow-listed keys keep only id-shaped strings; the fuzz case puts an amount and a name under every allow-listed key                                                                                                                                                                |
| Over-redaction hides the cause of an `internal` failure                                                                                                                                 | Medium   | `name`, `code`, the kind and up to 20 stack frames survive; accepted until `OPEN-8` is decided and loosened by a later change, because a leak cannot be recalled                                                                                                                   |
| A cross-tenant read becomes distinguishable                                                                                                                                             | High     | Constant `not_found` envelope; same sentinel wire on the eight reads; a case in `tenant-isolation.test.ts` through the real handler path; no timing claim is made                                                                                                                  |
| The boundary changes every server function at once                                                                                                                                      | Medium   | One global registration, one-line revert; `createFailureMiddleware(ports)` is tested without a Worker; Phase 4 probes the running app once                                                                                                                                         |
| A middleware that sets the response status also changes an SSR document's status, and the server-only import reaches the client bundle                                                  | Medium   | Phase 4 probes an SSR loader failure and records the document status, and greps the client build for `redactError`; `src/server/middleware/auth.ts` is the precedent for a server-only middleware in `src/start.ts`                                                                |
| The scrubber's regular expression is slow in a Worker                                                                                                                                   | Low      | Linear-time expression, test with a 100 000-digit string, input capped at 512 characters before matching                                                                                                                                                                           |

The spec PR is design-only and `risk-low`. Phases 1, 2 and 4 are data-protection and request-path code: their PRs are
`risk-high`, take the security specialist's verdict, and merge on the QA panel (ADR 0031). Backward compatibility: the
wire shape of a failing server function changes (a fixed message, an empty stack, an `envelope` property); no surface
listed in `BACKWARD_COMPATIBILITY.md` names the old shape, and a thrown `notFound()` sentinel keeps leaving unchanged with the same status handling (it is not touched at all); a raw `NotFoundError` becomes a `not_found` envelope, no worse for a reader than the generic sentence the other kinds print until `05-S2`.

## 📝 Visual change expected

None designed. No route or state changes on screen in either theme or viewport. The only screen-visible effect is that a
failure line which printed a repository sentence prints the fixed fallback (`05-S2` replaces those lines), and that the locked-plan branch of `/transactions/rules/new` works when a plan someday meters rules at zero (no plan does today, so nothing visible changes). No browser evidence beyond the existing `not-found` and `tenant-isolation` specs, and no axe run.

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
| `failure.field.invalid`    | This value is not valid.                                         |
| `failure.field.tooShort`   | This value is too short.                                         |
| `failure.field.tooLong`    | This value is too long.                                          |

The Polish text is written by the implementer in the catalogue's voice. The fixed English fallbacks of
`PublicFailureError` are not catalogue strings: they are the last-resort `Error.message` of a value that has no locale, and
no screen is designed to show them.

## 📋 Phasing

Five tickets, in this order. The numbering is the dependency order. Phases 1 and 2 are mechanism with no user value on their own (nothing consumes them until Phase 4); each is independently shippable and testable, and the user value is the whole.

1. **Phase 1 - the scrubber.** Independently shippable. Fixes Problem 2 (sink half).
2. **Phase 2 - classifier, envelope, keys, isolation case.** Independently shippable. Fixes Problems 1, 4, 5, 6, 7.
3. **Phase 3 - the client reader and the three readers.** Blocked by Phase 2 (the schema). Fixes Problem 3.
4. **Phase 4 - the middleware.** Blocked by Phases 1 to 3. Fixes Problem 2 (wire half).
5. **Phase 5 - documents and `Delivered:`.** Blocked by 1 to 4; a documentation-only ticket is thin and the documents are already wrong today, so `afk-to-tickets` ships it in the Phase 4 pull request unless it has a reason to cut it. Fixes Problem 8.

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
   string and loses a number and a name-shaped string with a space; **an unknown key loses every string, including
   `'Biedronka Sp. z o.o.'` and, under invented keys, a single-token name (`'Kowalski'`), an IBAN (`'PL61109010140000071219812874'`),
   a 40-character token and `'Salary.pdf'`**; a record keyed by `'Biedronka Sp. z o.o.'` emits `[key:0]` and no payee, and its values are redacted by the default-deny rule; `address`, `addresses`, `alias`
   and `aliases` are all denied; an ALLCAPS key (`AMOUNT`) is denied; `redactError` output is not re-scrubbed and keeps its frames; `redactError` never returns the message or the stack header for an `AliasTakenError`, an
   `InvalidAmountError('12.5')`, an `InvitationAddresseeError('a@b.c')` and an error whose `name` is `'x y'`; an error whose
   message is `"x\n    at fake (a.ts:1:1)"` yields no `fake` frame; a depth-5 fuzz case over generated nested objects whose
   money and name keys are camelCase, snake_case, kebab-case, plural and glued and whose leaves are amounts and names,
   asserting no leaf appears in `JSON.stringify(redact(x))`; a cyclic object, a 10 000-key object, a getter that throws **and a getter that records a call (never called)**, a `Proxy` whose traps throw, a
   `__proto__` key, a `BigInt`, a `Symbol`, a nested `Error` and an `AggregateError` neither throw nor take more than a second; an `Error` whose `stack` is a number, whose `stack` getter throws, or whose `message` was changed after construction yields no message text and no fake frame; an `Error` subclass with own enumerable properties yields none of them; NBSP and U+202F grouped amounts (`'12\u00a0345,67'`) are replaced; and the amount expression, exported for the test, runs over a 100 000-digit string in under a second.
2. **Write `redact.ts`** to turn it green. No import. The deny set, the long-fragment list and the allow-list are three
   exported `ReadonlySet`s so the test iterates them rather than copying them.
3. **Tenant isolation test:** none, no repository. **Money invariant:** the file is the invariant.

### Phase 2 - classifier, envelope, keys

4. **Red first**, `classify.test.ts`: one case per thrown class in the kinds table, each asserting kind, status and
   `retryable`; an unknown throw, a string, `null`, a plain `Error` and an unknown `RepositoryError` code are `internal`,
   500, and the envelope deep-equals `{ v: 1, kind: 'internal', message: { key: 'failure.internal' } }`; a `ZodError` becomes
   `validation` with `fields`, and the framework's input-validation `Error` (built as in Phase 4) is `validation` too while a plain `Error` whose message is `'[1,2]'` or `'[{"path":"x"}]'` is `internal`, and `JSON.stringify(envelope)` contains neither the issue message nor the rejected value, and
   a path segment with a space is reported at form level, `invalid_type` maps to `failure.field.invalid`, `too_small` to `tooShort` (the copy reads "too short" even for a number or an array, accepted for this stage); `QuotaExceededError('rules', 5, 4)` is 402 with `params` exactly
   `{ metric: 'rules' }` and the serialised envelope contains neither `5` nor `limit`, and `('widgets', 5, 4)` has no
   `params`; `InvitationAddresseeError('a@b.c')` serialises without the address; `AuthRequirementError` is 401 for
   `unauthenticated` and 403 with one identical envelope for each of the other six reasons; a `PolarError` with status 429
   is `rate_limited` and with 500 `upstream`; `TenantIsolationError` and a `MoneyError` are `internal`.
5. **Write `src/lib/failure-envelope.ts`, `envelope.ts` and `classify.ts`**; add the `failure.*` keys to `en.ts` and
   `pl.ts` (the parity test is in `pnpm test`).
6. **Tenant-isolation case** in `src/server/repos/__tests__/tenant-isolation.test.ts`, named _the failure for a missing row
   and for another workspace's row is byte-identical_: run the real scoped read on the harness database for a non-existent
   id and for B's id read through A's scope, pass each through `rethrowAsNotFound`, and assert the same sentinel
   (`JSON.stringify` equal); run the same two raw `NotFoundError`s through the real middleware (the Phase 4 test file) and assert equal envelopes, status and serialised
   bytes, with different entities and ids and no id or entity in the string; the envelope has no `requestId`, timestamp or
   `retryAfter`.
7. **Money invariant:** the `classify.test.ts` case that a `QuotaExceededError` never puts a number in `params`, plus
   Phase 1's file.

### Phase 3 - the client reader and the three readers

8. **Red first**, `src/lib/__tests__/failure.test.ts` (a pure test, collected by `ui`): `readFailure` returns the envelope for a `PublicFailureError`-shaped
   object, `null` for `new Error('x')`, `null` for `v: 2`, the envelope (extra key ignored) for an unknown extra key, and never throws on `undefined`.
9. **Write `src/lib/failure.ts`**, then move `rules/new.tsx` to `readFailure(error)?.kind === 'feature_locked'` (with a component test (under `src/routes/_app/transactions/rules/-ui/`, the folder the `ui` project collects, rendering the route's component from `../new`) that the locked card renders for a `PublicFailureError` of that kind and that the generic failure line
   renders for any other), and `invite.$invitationId.tsx` to `kind === 'unauthenticated'` in `isUnauthenticated` and in the
   accept handler's `toast.error` branch (an `unauthenticated` kind navigates to sign-in as the loader does; any other kind
   keeps the toast). `error.name === 'AuthRequirementError'` stays as a second condition for one release; the message regex
   goes.
10. A test (`src/server/errors/__tests__/failure-readers.test.ts`, which the `server` project collects and which reads files with `node:fs`; `src/lib/**` tests run in the `ui` jsdom project) asserts no file under `src/routes` or
    `src/components` matches `/message\.includes\(['"][A-Z_]+['"]\)/` or `/test\(\w+\.message\)/`, the pattern of the old
    leak.

### Phase 4 - the middleware

11. **Red first**, `src/server/errors/__tests__/middleware.test.ts`, running `createFailureMiddleware` with spy ports **inside the framework's own chain**: the test drives `executeMiddleware` (or `handleServerAction`) with `[failureMiddleware, handlerMiddleware]` and inspects the returned `{ result, error, context }` (`seroval` is not a dependency of this repository and this spec adds none, so the unit test does not call `toCrossJSONStream`; it serialises the error as seroval does for an `Error`, from `name`, `message`, `stack` and its own enumerable properties, with `JSON.stringify`), because that chain result, and not a raw `toCrossJSONAsync(error)`, is what a handler failure takes (Problem 2); the byte-level wire is proven by the Phase 4 probe. It covers a handler throw, an `authMiddleware` throw and an input-validator failure, and asserts the status the middleware set: the
    order is classify, redact, `log`, `report`, `setStatus`, throw (assert call order, and that **neither port receives a
    value containing the amount or the payee name** placed in the thrown error's message, its `cause` and an own property,
    and that `log` receives no `errorMessage`, `errorStack` or `errorCause` key); a thrown `new Error('postgres://u:p@h')`
    leaves as a `PublicFailureError` with `kind: 'internal'`, empty `stack`, no `cause`, and the serialised `{ result, error, context }` contains none of the original text, no file path and no `stack` content; `redirect`, `notFound` and
    `Response` pass through as the same object; a `notFound()` sentinel passes through as the same object and a raw `NotFoundError` leaves as a `PublicFailureError` of kind `not_found` with status 404; a throwing port does not change
    what is thrown; an **input-validation** case builds the error as `execValidator` does (`new Error(JSON.stringify(issues, undefined, 2))` from a real Zod 4 `~standard.validate` failure) and asserts `validation`, `fields` built from `path` and `code`, and no issue message in the serialised envelope; a **tenant-isolation** case runs a raw `NotFoundError` for a missing id and one for another workspace's id through the middleware, serialises each real `{ result, error }` stream and compares the serialised forms and the status, and asserts the two serialised envelopes are identical with no id or entity in them; an `AuthRequirementError` with `not-a-member` for an existing and for a non-existent organization id serialises to identical bytes; a **ledger flush** case runs a handler that opens `runWithLedgerBatch`, touches an account and throws,
    and asserts the flush ran before the middleware's `catch`. Where the `server` project cannot import
    `createMiddleware` without the Start context, follow the `vi.mock` pattern of
    `src/server/fns/__tests__/attachments.test.ts`, which `vitest.config.ts` allows.
12. **Write `middleware.ts`** and set `functionMiddleware: [failureRedactionMiddleware]` in `src/start.ts`; rewrite its
    docblock (it says the boundary will be registered "when there is any").
13. **Probe the running app once, in three cases** (agent ports 3011-3020, `docs/agents/shared-checkout.md`): force one server function to
    throw an `Error` containing a recognisable string from its handler and one from inside `authMiddleware`, read the HTTP
    status and body, and record both in the PR (the status is the kind's, the body contains the envelope and not the string,
    and the serialised chain result carries it nowhere); force one **input-validation failure** (a call with a wrong-typed field) and
    record that it arrives as `validation` with `fields` and without the issue text; load one route whose **SSR loader**
    calls a server function that fails (the invitation route) and record the **document** status (it must be the kind's status, never `200` with an error body, and the unauthenticated invitation case that ends in a redirect must stay 3xx); and grep the client build output for `redactError`
    and `@tanstack/react-start/server` and record that neither is in a client chunk (`pnpm build` is in the gate). The in-chain test above proves the wire for a server function call; the probe additionally proves the pieces a test cannot reach, the real HTTP status, the SSR document and the client bundle (Resolved assumptions row 13). Then run `e2e/not-found.spec.ts` and `e2e/tenant-isolation.spec.ts` once; both
    must stay green. Also force one **raw `NotFoundError` from a write** and record that the client reads the 404 `PublicFailureError` envelope as an error (not as a router not-found) and that a dialog shows its fixed sentence. The PR body's first paragraph states that 63 `error.message` sites now print a generic sentence
    until `05-S2`.

### Phase 5 - documents

14. Edit `docs/SECURITY.md` §6.1 (name `redactError`, what survives and the residual gap, and drop the sentence that says
    constructors already take structured fields), `docs/ARCHITECTURE.md` §10 and §11, `src/server/repos/errors.ts`'s header
    (point at `classify.ts`), and `docs/SPEC.md` §6 (add `server/errors/` to the tree) and `docs/plans/02-i18n.md` lines 92 and 93 (the root route is `05-S2`'s file, not `05-S1`'s), and `docs/plans/05-error-and-observability.md`: the `05-S1` Owned paths gain the files this spec adds, the kinds list gains `unauthenticated`, the Quota paragraph (line 76), the middleware paragraph (lines 57 to 59: the middleware throws a `PublicFailureError` that carries the envelope instead of returning it, and it covers server functions only, not API routes, queue handlers or the Durable Object), and `05-S2`'s States (line 157, "naming the metric and the plan") and Money invariant (lines 179 and 180, "a plan id for quota failures") say the envelope carries the metric and the plan is resolved by the screen, `05-S3`'s Server paragraph gains "route the API routes, the queue handlers and the Durable
    Object through the same scrubber", and the stage gets a `Delivered:` line once every phase has merged. Run
    `pnpm generate-spec-index`.

## 📝 Resolved assumptions (autonomous defaults)

Every row is a decision this run made without a human, or a default it applied; each is reversible before merge by saying so
on the spec PR.

| #   | Question                                                                                   | Applied default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Is the stage delivered, or does it get a spec?                                             | **A spec.** No owned path exists; `src/start.ts` registers no middleware; the logger still writes `errorMessage` and `errorStack`.                                                                                                                                                                                                                                                                                                                                                                                                 | Checked step 1 of `afk-plan-to-spec`: `05-S1` is in no spec, issue or open PR, and the plan carries no `Delivered:` line for it.                                                                                                                                                                                                                                                                                                                                                |
| 2   | What kind does an unauthenticated request take?                                            | **Add `unauthenticated` (401); every other `AuthRequirementError` reason is `forbidden` (403) with one identical envelope.**                                                                                                                                                                                                                                                                                                                                                                                                       | Decided by software architect sub-agent (confidence medium): collapsing 401 into `forbidden` would erase the one distinction the invitation loader acts on (`_app.tsx` treats both statuses alike); a union member is additive under `v: 1`. The security reviewer's condition that `not-a-member` must not be distinguishable is met by the single `forbidden` envelope.                                                                                                       |
| 3   | One key per kind, or a reason key as well? `rate_limited` and `upstream`?                  | **Per-kind keys only; both kinds stay; `PolarError` with status 429 is `rate_limited`, any other `PolarError` is `upstream`; no speculative `RATE_LIMITED` code.**                                                                                                                                                                                                                                                                                                                                                                 | Decided by software architect sub-agent (confidence medium): dropping a named kind later is a breaking narrowing of a versioned union, keeping it costs two table rows; a closed `reason` param can be added without a version bump.                                                                                                                                                                                                                                            |
| 4   | What may a log or Sentry sink see of an `Error`?                                           | **`name`, `code`, the kind and up to 20 stack frames (message and header removed from the stack first, strict frame match). Never `message`, `cause` or an `AggregateError` member. The raw error is never handed to `logger.error`.**                                                                                                                                                                                                                                                                                             | Decided by security and tenancy reviewer sub-agent (confidence high): `AliasTakenError`, `InvitationAddresseeError`, `ConflictError` sentences and `InvalidAmountError` interpolate names, emails and amounts, so "classified, therefore safe" is false; the amount pattern misses bare minor-unit integers; the restriction can be loosened after `OPEN-8`, a leak cannot be recalled. Found while verifying: the existing `serializeError` emits message, stack and cause.    |
| 5   | How do `TenantIsolationError` and the `MoneyError` family classify?                        | **Both `internal`.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Decided by security and tenancy reviewer sub-agent (confidence high): `TenantIsolationError` fires on a patch carrying `organizationId` or on a queue-row mismatch, both bugs, and the plan forbids a friendlier default; the log keeps its class name at `error` level. The architect's table had `not_found` and deferred to this verdict. A `MoneyError` message embeds the amount.                                                                                          |
| 6   | How does the middleware speak, and where is it registered?                                 | **Global `functionMiddleware` in `src/start.ts`; a thrown `notFound()` sentinel passes through and every kind, `not_found` included, leaves as a `PublicFailureError` (fixed per-kind message, empty stack, no `cause`, one `envelope` property) with the status set by `setResponseStatus`; control-flow throws pass through; `readFailure` duck-types `error.envelope`.**                                                                                                                                                        | Decided by software architect sub-agent (confidence medium): deferring registration would ship OBS-03 "done" without running; the sentinel that `rethrowAsNotFound` and two e2e specs rely on already passes through, so only a raw `NotFoundError` is wrapped, and turning that into a sentinel would print `[object Object]` in the dialogs that show `String(error)`; a per-call-site list is the forgotten-one failure the plan exists to prevent.                          |
| 7   | What does a quota or feature-locked envelope carry?                                        | **`params.metric` only, validated with `isQuotaMetric`, else no `params`. No `limit`, `current`, `planId`, count or amount. `QuotaExceededError` is not changed.**                                                                                                                                                                                                                                                                                                                                                                 | Decided by security and tenancy reviewer sub-agent (confidence medium): `limit` and `current` are redundant (the screen resolves the ceiling from `PLANS`) and the scrubber redacts `limit` by key; `metric` is a free string at the throw site. Architect condition met: the middleware must not invent a plan.                                                                                                                                                                |
| 8   | The plan says the quota envelope carries "the plan".                                       | **It does not; the screen holds the workspace's plan and `05-S2` resolves the ceiling from it. Phase 5 amends the plan text.**                                                                                                                                                                                                                                                                                                                                                                                                     | Default applied: no throw site knows the plan, and `assertWithinLimit` only holds a resolver result. Adding a field to `QuotaExceededError` would be a wider change than the stage.                                                                                                                                                                                                                                                                                             |
| 9   | Is the deny list in the plan sufficient?                                                   | **No. Word and substring matching with plurals and glued forms, a wider set (free text, secrets, totals, bank identifiers), first word `ref`, an allow-list that keeps only id-shaped strings, and default-deny for strings under any key outside the allow-list (row 17).**                                                                                                                                                                                                                                                       | Decided by security and tenancy reviewer sub-agent (confidence medium): the plan's fragments miss `amounts`, `payeename`, `text`, `title`, `token` and similar; an exact allow-listed key can still carry a name or a number; bare digits cannot be matched without redacting every number, so unknown strings must be shape-limited.                                                                                                                                           |
| 10  | Who is the sink during this stage?                                                         | **`log` is the existing logger fed `redactError` fields and the kind only; `report` is a no-op port that `05-S3` replaces. The API routes, queue handlers and the Durable Object are outside the boundary until `05-S3`, and the spec says so.**                                                                                                                                                                                                                                                                                   | Default applied after the security reviewer's finding that "wraps every server function" does not cover them; `05-S3` owns Sentry and the logger.                                                                                                                                                                                                                                                                                                                               |
| 11  | `rules/new.tsx` tests `message.includes('FEATURE_LOCKED')`: keep, move or leave?           | **Move it to the envelope kind in Phase 3, with a component test.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Default applied after the architect's finding (verified: `FeatureLockedError`'s message does not contain the code) that the branch is dead today; moving it makes the locked card appear, which the file's own docblock says is intended.                                                                                                                                                                                                                                       |
| 12  | What does the stage promise about indistinguishability?                                    | **The same status, headers and body for a missing row and another workspace's row, a constant `not_found` envelope built from no input of the error, and no timing-sensitive field. Network timing equality is not claimed.**                                                                                                                                                                                                                                                                                                      | Decided by security and tenancy reviewer sub-agent (confidence high): the classifier must not read `entity`, `id`, `message` or `name`, and the test must go through the real handler path, not only compare built envelopes.                                                                                                                                                                                                                                                   |
| 13  | Is the unit test enough for the framework wiring?                                          | **No. Phase 4 probes the running app once (status and body of a forced failure in a handler and in `authMiddleware`) and records it in the PR.**                                                                                                                                                                                                                                                                                                                                                                                   | Decided by software architect sub-agent (confidence medium): per `AGENTS.md`, a claim about what a library does is probed once; the unit tests bypass the framework.                                                                                                                                                                                                                                                                                                            |
| 14  | Which numbers in this spec are measured?                                                   | The 63 `error.message` lines and 46 files; the seroval wire content; the line range of the framework handler; seven `AuthFailureReason` values.                                                                                                                                                                                                                                                                                                                                                                                    | `grep -rn` for `error.message`, `err.message` and `.message)` over non-test files in `src/routes` (63); `grep -rln 'error.message' src/routes` (46); a `node` probe of seroval 1.6.4 on an `Error` subclass with an own property (the output carries `message`, `name`, `stack` and the property); `sed -n 60,215p` of `server-functions-handler.js` and `sed -n 88,150p` of `createServerFn.js` (the chain returns `{ ...ctx, error }`); `sed` of `src/server/auth/tenant.ts`. |
| 15  | How does a bad server-function input classify, given the classifier never reads a message? | **One named exception: `isInputValidationError` (plain `Error`, message parses as a bounded array of objects with a `path` array and a string `code`); only `path` and `code` are read, and the result is `validation` with `fields`.**                                                                                                                                                                                                                                                                                            | Decided by software architect sub-agent's panel finding (confidence medium), verified in `createServerFn.js` `execValidator`: the framework throws `new Error(JSON.stringify(issues))`, not a `ZodError`. The alternative, wrapping validators at 134 `inputValidator(` call sites (`grep -rn "inputValidator(" src`, tests excluded), is wider than the stage and was not taken; reading `path` and `code` alone leaks nothing even if the message is forged.                  |
| 16  | Phase 4 degrades 63 `error.message` readers before `05-S2` exists.                         | **Accepted, severity High, owned: the Phase 4 PR states it first and files a follow-up issue naming the sites when no `05-S2` spec or ticket exists.**                                                                                                                                                                                                                                                                                                                                                                             | Decided by product owner sub-agent's panel conditions (confidence medium): the regression is real and user-visible, `05-S2` has no spec yet, and a leak cannot be recalled while a generic sentence can be improved later.                                                                                                                                                                                                                                                      |
| 17  | Does the scrubber keep an unknown-key string if it is id-shaped?                           | **No: default-deny. Only the exported allow-list of full keys keeps a string (id-shaped); every other string and every object key that is not an identifier is replaced by a shape marker. `redactError` output is final and is not re-scrubbed.**                                                                                                                                                                                                                                                                                 | Decided by security and tenancy reviewer sub-agent's panel conditions (confidence medium): an id-shaped charset admits a single-token name, an IBAN and a short token. This supersedes the "unknown-key strings survive only if id-shaped" part of row 9.                                                                                                                                                                                                                       |
| 18  | How does a handler failure actually reach the wire?                                        | **As data in the chain's `{ result, error, context }`, serialised by `toCrossJSONStream`, with the status the middleware sets (the kind's, 404 for a raw `NotFoundError`; none for a sentinel that passes through); the framework's outer `catch` (before-the-chain failures) is outside the boundary and is a named residual.**                                                                                                                                                                                                   | Verified in `createServerFn.js` (`callNextMiddleware` returns `{ ...ctx, error }`) and `server-functions-handler.js` (`serializeResult(res)`); corrects the earlier reading in this spec, found by the security reviewer. The Phase 4 test drives the real chain.                                                                                                                                                                                                               |
| 19  | What did the specialist panel conclude?                                                    | **Round 1: product owner, architect and security reviewer each "approve with conditions"; all conditions applied. Round 2: product owner "approve"; architect "approve with conditions" (no `seroval` dependency, `not_found` leaves the status untouched (superseded by row 20), import list, test path) and security reviewer "approve with conditions" (allow-list before deny, record-key residual stated, `redactError` output final), all applied in the same commit series. No reviewer said "revise" and none escalated.** | Panel under `afk-plan-to-spec`, at most two rounds; the security reviewer's approval is recorded here and in the pull request.                                                                                                                                                                                                                                                                                                                                                  |
| 20  | What does a raw `NotFoundError` become at the boundary?                                    | **A `PublicFailureError` of kind `not_found` with a constant envelope and status 404; a `notFound()` sentinel that is already thrown (the eight `rethrowAsNotFound` reads) passes through untouched.**                                                                                                                                                                                                                                                                                                                             | Found by the `om-auto-review-pr` specification review: 51 repository sites throw `NotFoundError` and only eight reads wrap it, so turning every one into the sentinel would print `[object Object]` in the dialogs that show `String(error)`. Judged by the security reviewer on the amended text (approve with conditions: row 18 and 19 wording, a middleware-level tenant case, a client probe of the 404 envelope; all applied).                                            |
