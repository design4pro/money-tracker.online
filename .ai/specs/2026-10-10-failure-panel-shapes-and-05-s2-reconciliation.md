# The failure panel's shapes, the page-level boundaries and plan stage 05-S2 reconciled

| Field              | Value                                            |
| ------------------ | ------------------------------------------------ |
| **Status**         | ready                                            |
| **Issue**          | none                                             |
| **Spec PR**        | none                                             |
| **Implementation** | none                                             |
| **Plan**           | 05-S2 (docs/plans/05-error-and-observability.md) |

## 📝 TLDR

Plan stage `05-S2` (`docs/plans/05-error-and-observability.md`, "`ErrorPanel` and the boundaries",
rows `OBS-04`, `OBS-05`, `OBS-06`) was written before the code, and the code has since delivered most
of its surfaces in a different place: the 404, the router's default error component, the two
`CatchBoundary`s inside the layouts and `__root.tsx` all exist under `src/components/app/shell/` and
`src/routes/`. What is left is the part the stage says it exists for: an error panel with
**different recoveries for different failures**, the alert-versus-region rule and focus management,
the browser evidence, and the guideline `DESIGN.md` has never had. This spec covers that.

Phase 1 adds four opt-in props to the existing shell `ErrorPanel` (region or alert, heading level,
focus the heading, extra actions) with the default unchanged for its 41 consumers. Phase 2 adds a
sibling `FailurePanel` and a small browser-safe `FailureView` contract keyed by recovery shape
(`retryable | quota | feature_locked | internal`), with the quota and internal recoveries, the
optional reference text and its copy button. Phase 3 makes `RouteError`, the floor under every
route, the page-level internal shape. Phase 4 adds `e2e/errors.visual.spec.ts` and the browser
evidence. Phase 5 writes the `DESIGN.md` guideline, reconciles the plan with the tree and records the
stage as delivered. No schema change, no migration, no new dependency, no server code.

Two things are deliberately **not** here: the offline-failure surface (plan `27-S1` owns `/offline`
and the connection banner, `PWA-03`) and the removal of `detail={error.message}` from 21 route
modules (a follow-up that needs `05-S1`'s classifier to know what to show instead).

## 📝 Problem Statement

Verified against the repository at the time of writing (commands in Resolved assumptions row 10).

**What the code already delivers**

- **The 404** (`OBS-06`, its first half). `src/components/app/shell/not-found.tsx` is a designed page
  in the reader's language with two destinations (`/` and `/login`), mounted lazily as the root's
  `notFoundComponent` in `src/routes/__root.tsx`. `__tests__/not-found.test.tsx` asserts both links
  by destination and `e2e/not-found.spec.ts` asserts the 404 status, the translated surface and a
  silent console. A repository `NOT_FOUND` becomes the router sentinel in `src/server/fns/not-found.ts`.
- **The boundaries** (`OBS-05`). `src/routes/__root.tsx` exists (the plan calls it "new"): the SSR
  document shell with `<html lang dir>`, the theme bootstrap script, the i18n provider, the skip
  link. `src/router.tsx` sets `defaultErrorComponent` (lazy `default-error.tsx` -> `RouteError`) and
  `defaultPendingComponent`. `src/routes/_app.tsx` mounts a `CatchBoundary` **inside** the shell so
  navigation survives a route failure, and `src/routes/(auth)/route.tsx` does the same for the
  signed-out pages. React Aria's locale provider is deliberately not in the root (the entry-chunk
  rule at the top of `__root.tsx`).
- **A retryable panel** (`OBS-04`, one shape of three). `ErrorPanel`
  (`src/components/app/shell/error-panel.tsx`, 87 lines) is a card with a title, a body, an optional
  closed `<details>` for a raw message and a Retry button. It is owned by the shell barrel
  (`docs/SPEC.md` §8; `__tests__/error-panel-ownership.test.ts` fails on any other import path) and
  is used by 41 files with 45 uses.
- **A route-level internal failure** (`OBS-04`, a second shape without its recovery). `RouteError`
  (`route-error.tsx`) takes no error by construction, so nothing can leak, offers Retry and has an
  optional `reference` slot and catalogue key `empty.error.reference`. Its test asserts that neither
  the message nor the stack reaches the screen.
- **A way to force a failure** in a real browser: `failServerFns` in `e2e/support/states.ts` answers
  every `/_serverFn/*` with a 500, and `e2e/states.spec.ts` already uses it for the transaction
  detail. `e2e/support/axe-scan.ts` is the one axe definition.

**What does not hold**

1. **There are not three recoveries, there is one.** The stage's central requirement ("a single
   generic panel with a Reload button is the shape this stage exists to avoid") is unmet: no
   surface can say "you have reached the limit of _Accounts_ on the _Free_ plan, here is where to
   change it", and the internal failure (`RouteError`) has no way back to `/dashboard`. The route
   `/settings/billing` exists (`src/routes/_app/settings/billing.tsx`), and the catalogue already
   names every metric (`billing.usage.metric.*`) and plan (`plans.<id>.name`), so the copy needs
   no new vocabulary. There is no producer of a quota failure on the client yet (that is
   `05-S1`'s envelope and `22-billing`), which is why the panel is specified against a contract
   and not against a thrown error.
2. **Alert versus region is not a decision anyone made.** `ErrorPanel` and `RouteError` are
   `role="alert"` unconditionally. The 21 route-level `errorComponent`s render an alert on initial
   render, which the plan calls out ("an alert on initial render is announced before the person has
   any context for it"), and no failure moves focus anywhere: after a failed save in a dialog the
   reader hears the alert but keyboard focus stays where it was.
3. **No test of `ErrorPanel` itself.** `error-panel-ownership.test.ts` scans import specifiers and
   nothing renders the component. `route-error.test.tsx` covers `RouteError` only.
4. **No evidence file.** `e2e/errors.visual.spec.ts` does not exist; no axe scan runs on the 404 or
   on a forced failure, and nothing has looked at a failure state at 360, 1280 and 2560 px in both
   themes.
5. **`DESIGN.md` has no guideline for the panel**, although it has rendered in more than one place
   for a long time. `DESIGN.md` § Component guidelines makes writing one part of making a component
   shared, and the "Empty state" section only says what the panel _is not_.
6. **The plan's owned paths are stale.** `src/components/feedback/error-panel.tsx`,
   `src/components/feedback/not-found.tsx` and `src/routes/__root.tsx` are listed as "new"; the real
   files are in `src/components/app/shell/` and the root exists. The plan also names a `danger`
   token family; `tokens.css` calls it `negative` (`--color-negative`, `--color-negative-soft`).
   Moving the panel to `components/feedback` would only add churn to 41 consumers and break the
   ownership test, so the plan is amended, not the tree.
7. **`OBS-06` also names "the offline-failure surfaces".** Nothing in `src` reads
   `navigator.onLine`, and plan `27-pwa-and-mobile.md` (`PWA-03`, `27-S1`) owns a designed
   `/offline` page and a connection banner, and says `onLine` lies and must not be relied on. A
   second offline surface here would duplicate it. The row is split: the 404 closes here, the
   offline surface is deferred to `27-S1` by name.
8. **Disclosed, not fixed here:** 21 call sites pass `detail={error.message}`
   (`grep -rn "detail=" src --include=*.tsx | grep -c error`), so the repository's developer-facing
   English sentence reaches the screen under a disclosure. That contradicts `05-S1`'s "no detail at
   all", but the right replacement depends on the classifier that does not exist yet.
   `RouteError.reference` is also never passed by any caller today.

**Why now.** Plans `04` (a route failure inside the shell), `17` (a malformed link produces the
designed error panel) and `18` (a failing widget renders its own panel sized to its cell) all name
`ErrorPanel` from this stage as if it were the finished article. Each of them builds a failure
state this spec's contract is meant to be the single answer to.

## 📝 Proposed Solution

Keep the existing frame and make the **recovery** the unit of design. Three decisions:

1. **`ErrorPanel` stays where it is and changes only additively.** Four optional props, all
   defaulting to today's behaviour: `mode` (`'alert'` default, or `'region'`), `headingLevel`
   (default `3`, as today), `focusHeading` (default `false`) and `actions` (extra nodes beside the
   Retry button). The 41 consumers and the ownership test do not change.
2. **A sibling `FailurePanel` is the kind-aware surface**, in the same shell module and barrel. It
   takes a `FailureView` and composes `ErrorPanel`; it adds copy and recovery per shape. The shape
   is the discriminant, **not** `05-S1`'s ten `kind` strings: `src/server/repos/errors.ts` says only
   the classifier switches on `code`, and a `shapeOf(kind)` in the shell would be a second
   classifier. `05-S1` owns the one-function mapper from its envelope to `FailureView`; this spec
   amends that stage's text in the plan (Phase 5) so the handoff is written down, with no
   `Blocked by` on it.
3. **The page-level states reuse the same pieces.** `RouteError` becomes the page-level internal
   shape: a region, not an alert, with its heading focused after a client-side navigation, the
   reference when one is passed and, only inside the signed-in shell, a link back to `/dashboard`.

**Alternatives considered.** (a) Make `05-S1` a hard precondition and import its envelope type:
simplest contract, but the plan puts both stages in Wave 1 with `05-S2`'s blockers "None", and the
spec could not be sliced until an unreviewed interface merged. (b) A `src/components/feedback/`
directory as the plan names it: breaks `docs/SPEC.md` §8's single owner and the 41 imports. (c)
Rewriting the 21 `detail=` call sites in this spec: other areas' route modules, no classifier to
show instead, not reversible. (d) An offline shape: duplicates `27-S1`.

## 📝 Architecture

| Concept                                          | Owner module                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| The retryable frame, alert/region, heading focus | `src/components/app/shell/error-panel.tsx` (edit)                    |
| `FailureView`, `FailurePanel`                    | `src/components/app/shell/failure-panel.tsx` (new)                   |
| The page-level internal failure                  | `src/components/app/shell/route-error.tsx` (edit)                    |
| The 404                                          | `src/components/app/shell/not-found.tsx` (unchanged)                 |
| Quota metric and plan vocabulary                 | `src/lib/plans.ts` (`QuotaMetric`, `PlanId`; imported, not restated) |
| Envelope to `FailureView` mapper                 | `05-S1` (`src/server/errors/`), recorded in the plan by Phase 5      |

`failure-panel.tsx` is browser-safe and imports nothing from `#/server/errors` (which does not exist
yet) nor from any other `#/server` module; it may import the types `QuotaMetric` and `PlanId` from
`#/lib/plans`, which is isomorphic and binding-free by its own docblock. The shell barrel
(`src/components/app/shell/index.ts`) exports `FailurePanel` and the `FailureView` type.

```ts
// Shape of the contract. The discriminant is the recovery, not the server's kind.
export type FailureView =
  | { shape: 'retryable'; reference?: string }
  | { shape: 'quota'; metric: QuotaMetric; plan: PlanId }
  | { shape: 'feature_locked'; plan: PlanId }
  | { shape: 'internal'; reference?: string }
```

There is no `number` anywhere in it, so "the panel renders no amount" is a property of the type
before it is a property of a test. `metric` and `plan` are closed unions of the catalogue's own ids,
rendered through `billing.usage.metric.<metric>` and `plans.<plan>.name`.

`FailurePanel` props: `failure: FailureView`, `placement: 'after-action' | 'page'`, `onRetry?`,
`isRetrying?`, `homeHref?` (the dashboard link of the `internal` shape, passed only by a caller inside the shell), `title?` and `body?` (required for `retryable`, whose wording is the call site's, as
`ErrorPanel`'s docblock explains; ignored by the other shapes, which own their copy), `className?`.
`placement` decides `mode` (`after-action` -> `alert`, `page` -> `region`) and whether the heading
takes focus on mount (`after-action` only; see Edge cases for the page case).

The four recoveries:

| Shape            | Recovery rendered                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `retryable`      | The Retry button (`onRetry`, `isPending` while retrying). The panel is rendered **beside** the form, never instead of it, so input survives. |
| `quota`          | A link to `/settings/billing` named by the metric and the plan: "Plan: Free. Limit reached: Accounts."                                       |
| `feature_locked` | The same link, naming the plan only (see Resolved assumptions 7).                                                                            |
| `internal`       | An apology, the optional reference as selectable text with a Copy button, and (inside the shell) a link back to `/dashboard`.                |

## 📝 Data Model

None. No table, no column, no migration, no KV key, no queue message.

## 📝 API Contracts

No server function, route handler or envelope. The one contract is the in-process `FailureView`
above, and it is internal to the shell: nothing outside `src/components/app/shell/` and the three
boundary modules imports it in this spec. `05-S1`'s envelope is `{ v: 1, kind, message, fields?,
retryAfter? }`; the mapper from it to `FailureView` is that stage's, and a `kind` with no panel
shape (`validation`, `not_found`, `forbidden`, `conflict`, `rate_limited`, `rate_unavailable`,
`upstream`) is that stage's decision to map onto `retryable` or `internal`.

## 📝 UI/UX

**States.** `FailurePanel` is a state, with the four shapes above. Frame: the existing `Card` with
`border-negative/30` for `retryable` and `internal`, and the `warning` family
(`--color-warning`, `--color-warning-soft`) for `quota` and `feature_locked`, which are not faults.
The glyph is `aria-hidden` and the heading and sentence carry the meaning (Colour Is Never Alone).
No new token.

**Accessibility.**

- **Alert versus region.** `placement="after-action"` renders `role="alert"` (it appears in response
  to something the reader just did). `placement="page"` renders a plain region labelled by its
  heading (`role="region"` with `aria-labelledby`), because it is the page's content and an alert on
  initial render is announced before the person has any context for it.
- **Focus.** After an action failure the heading takes focus (`tabIndex={-1}`, programmatic only),
  so a keyboard reader lands on the explanation, and the Retry button is the next tab stop inside the
  same card. The heading, not the card, is the target.
- **Targets.** Every button and link keeps the 44px `target-min` hit area; the Copy button too.
- **Reference text** is selectable (`select-all`), has the label from `empty.error.reference`, and
  Copy announces success in a polite `role="status"` region ("Reference copied"); the clipboard call
  is wrapped so a rejection announces nothing and throws nothing.
- **Reflow.** Single column from 360 px; actions wrap; the card is capped at the measure on 2560 px.
- **Forced colours and dark.** Both themes use token pairs that already carry their contrast
  (`negative`/`negative-soft`, `warning`/`warning-soft`); dark values are re-declared in
  `tokens.css`, not derived.

## 📝 Edge Cases & Failure Scenarios

- **Quota failure for a metric the catalogue does not know** (a future metric): the type forbids it
  at compile time; at run time `FailurePanel` is only ever handed a `FailureView` its mapper built,
  so there is no untyped path in this spec.
- **A `retryable` panel with no `onRetry`:** renders without the button (as `ErrorPanel` does today).
- **`page` placement on first load versus after a client navigation.** An SSR-rendered error page
  must not steal focus from the skip link on load; after a client-side navigation that fails, focus
  has no home (the clicked link is gone), so the heading takes it. The implementation decides this
  from the router's state, with a test for both cases. If it cannot be told apart reliably, the safe
  fallback is to focus the heading in both cases, which costs a keyboard reader one Shift+Tab to
  reach the skip link; it is not to leave focus on `<body>`.
- **Internal failure outside the shell** (`(auth)` boundary, the router default, the guard failing
  in `_app`'s own `errorComponent` inside `AppShellFallback`): no link to `/dashboard`. A signed-out
  reader sent there is bounced through `/login`, and a guard that just failed would loop.
- **A reference string is long or has no spaces:** `break-all`, never horizontal scroll at 360 px.
- **Clipboard unavailable** (insecure context, permission denied): the button does nothing visible;
  the text stays selectable.
- **Double report.** Rendering a panel adds no `console` output of its own. A caught render error is
  also logged by React itself; `e2e/states.spec.ts` already declares that noise per test
  (`DELIBERATE_SERVER_FAILURE`), and the new spec does the same rather than weakening the console
  net.
- **A rate-limited failure with `retryAfter`** is out of this spec (it is a `retryable` the mapper
  chooses); the panel has no countdown.

## 📝 Risks & Impact Review

| Risk                                                      | Mitigation                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A prop added to `ErrorPanel` changes one of 41 consumers  | Every prop optional with today's default; `error-panel.test.tsx` pins the default render; the ownership test stays green |
| A second `kind` vocabulary drifts from `05-S1`            | The contract is keyed by recovery shape, not kind; the mapper is `05-S1`'s, written into its plan text                   |
| An amount reaches the panel through `params`              | `FailureView` has no `number` or free-form params; a test renders every shape with hostile strings                       |
| The internal shape claims "reported" before Sentry exists | `failure.internal.body` makes no such claim; `empty.error.body` (which does) is untouched and noted in the plan          |
| `DESIGN.md` is a governance document                      | The guideline ships in its own phase so the PR is `risk-high` with the second reviewer (`SDLC.md`)                       |
| The panel looks right in the harness and wrong in the app | Phase 4 captures the real 404 and a real forced 500 in the app, not only the harness                                     |
| Focus handling hides the skip link on an SSR error page   | Edge case above; both cases tested                                                                                       |

## 📝 Visual change expected

- **A new quota / feature-locked panel** and **an internal panel with a reference and a Copy
  button**: no route renders them on its own until `05-S1` and `22-billing` supply a producer; they
  are captured through the harness, with the real 404 and a real forced 500 (a route's retryable
  failure and `RouteError`) captured in the app.
- **`RouteError`** loses `role="alert"` for a region, gains a heading that takes focus after a
  client navigation, and, inside the signed-in shell, a "Back to the dashboard" link beside Retry.
- Everything else (the 404, the 41 `ErrorPanel` consumers) is unchanged on screen.
- Light and dark, 360, 1280 and 2560 px. Evidence goes to `.ai/qa/artifacts_*/` or a scratchpad,
  never the repository.

## 📝 Copy

New keys, `en` text (the implementation lands each in EN and PL in the same change, per the
`i18n-messages` skill; PL follows the product's household register, not accountancy):

| Key                           | `en`                                               |
| ----------------------------- | -------------------------------------------------- |
| `failure.quota.title`         | `This workspace is at its limit`                   |
| `failure.quota.body`          | `Plan: {plan}. Limit reached: {metric}.`           |
| `failure.featureLocked.title` | `Not part of your plan`                            |
| `failure.featureLocked.body`  | `This is not included in the {plan} plan.`         |
| `failure.billing.action`      | `See plans and billing`                            |
| `failure.internal.body`       | `We could not finish that. Try again in a moment.` |
| `failure.dashboard.action`    | `Back to the dashboard`                            |
| `failure.reference.copy`      | `Copy reference`                                   |
| `failure.reference.copied`    | `Reference copied`                                 |

Reused as they are: `empty.error.title`, `empty.error.reference`, `action.retry`,
`billing.usage.metric.*`, `plans.<id>.name`. `{plan}` and `{metric}` are catalogue names passed as
strings; no plural is needed (there is no count), so no `if (n === 1)` and no plural machinery.

## 📋 Phasing

Five phases, five tickets (`afk-to-tickets` cap: eight). Phase 5 is separate on purpose: it edits
`DESIGN.md`, a governance document, and takes the second reviewer.

| Phase | Ships                                                                                        | Depends on |
| ----- | -------------------------------------------------------------------------------------------- | ---------- |
| 1     | `ErrorPanel`: `mode`, `headingLevel`, `focusHeading`, `actions`; `error-panel.test.tsx`      | none       |
| 2     | `FailureView`, `FailurePanel`, the copy, `failure-panel.test.tsx`                            | 1          |
| 3     | `RouteError` as the page-level internal shape; the `_app` dashboard link; test updates       | 2          |
| 4     | `e2e/errors.visual.spec.ts`, the harness entry, browser evidence                             | 3          |
| 5     | `DESIGN.md` guideline; the plan reconciled and `05-S2` marked delivered; the follow-up issue | 4          |

## 📋 Implementation Plan

### Phase 1 - `ErrorPanel` learns two roles and a focus target

Files: `src/components/app/shell/error-panel.tsx` (edit),
`src/components/app/shell/__tests__/error-panel.test.tsx` (new).

1. Add the optional props. `mode: 'alert' | 'region'` (default `'alert'`; `'region'` renders
   `role="region"` and `aria-labelledby` the heading id from `useId`), `headingLevel: 2 | 3 | 4`
   (default `3`), `focusHeading: boolean` (default `false`; focuses the heading in an effect on
   mount, heading gets `tabIndex={-1}`), `actions: ReactNode` (rendered after the Retry button in
   the same row). Update the docblock: it currently says `role="alert"` because the panel appears in
   response to an action; state the region case beside it.
2. `error-panel.test.tsx` (the file the plan names, at the real path): the default render is
   `role="alert"`, an `h3`, no focus move, Retry only; `mode="region"` is a labelled region and not
   an alert; `focusHeading` moves focus to the heading and the Retry button is the next tab stop;
   `headingLevel` is respected; `detail` still renders under a closed disclosure; Retry keeps a
   sibling input's value (rendered beside a controlled field in the test); a spy on `console` records
   nothing for any of these renders.

Verification: `pnpm test` for the two files, the ownership test still green, command gate.

### Phase 2 - `FailureView` and `FailurePanel`

Files: `src/components/app/shell/failure-panel.tsx` (new), `src/components/app/shell/index.ts`
(edit, barrel), `src/components/app/shell/__tests__/failure-panel.test.tsx` (new),
`src/lib/i18n/messages/en.ts` and `pl.ts` (edit).

1. Define `FailureView` as in Architecture and `FailurePanel` per its props. Compose `ErrorPanel`
   (`mode` and `focusHeading` from `placement`); `quota` and `feature_locked` use the `warning`
   family and a router `Link` to `/settings/billing` via the `actions` slot; `internal` renders the
   reference line (`empty.error.reference`), the Copy button (`navigator.clipboard.writeText`, with
   a polite status line) and, when the caller passes `homeHref`, a link to it. `homeHref` is the one
   prop beyond the table in Architecture (`string | undefined`), so the panel never decides by itself
   whether the reader is signed in.
2. Add the nine keys above to both catalogues; run the parity test.
3. Tests: each shape renders its own recovery and not the others'; `role="alert"` only for
   `after-action`; the heading takes focus for `after-action` only; **the panel renders no amount for
   any shape** (hostile strings such as `1 234,56 EUR` and `€1,234` as `reference` must not become
   an amount-shaped line: the reference is rendered verbatim as an opaque id, and the test asserts the
   quota and feature-locked bodies contain only the catalogue names); Polish renders the Polish
   copy; Copy writes the exact reference and announces it, and a rejecting clipboard throws nothing;
   a console spy records nothing.

Verification: command gate; `grep` evidence that `failure-panel.tsx` imports nothing from `#/server`.

### Phase 3 - `RouteError` is the page-level internal shape

Files: `src/components/app/shell/route-error.tsx` (edit), `default-error.tsx` (unchanged unless the
props change), `src/routes/_app.tsx` and `src/routes/(auth)/route.tsx` (edit only if the call sites
need a prop), `__tests__/route-error.test.tsx` (edit).

1. Re-express `RouteError` through `FailurePanel` (`shape: 'internal'`, `placement: 'page'`) or keep
   its frame and add the same region/focus behaviour; either way its public props stay
   `onRetry`, `reference`, `className`, plus an optional `homeHref`. The component still takes no
   error: that is the mechanism that keeps a message off the screen.
2. `_app.tsx`'s inner `CatchBoundary` passes `homeHref="/dashboard"`. Its outer `errorComponent`
   (the guard failed), `(auth)/route.tsx` and `default-error.tsx` pass nothing.
3. Edit `route-error.test.tsx`: the `role="alert"` assertions become a labelled region; every
   existing negative assertion (no message, no stack, no reference label without a reference) stays;
   add the dashboard link present only when `homeHref` is passed, and the focus cases from Edge cases
   (first load keeps the skip link first; a client navigation focuses the heading).

Verification: command gate; the existing `e2e/states.spec.ts` failure case and
`e2e/not-found.spec.ts` still pass.

### Phase 4 - Browser evidence and the axe gate

Files: `e2e/errors.visual.spec.ts` (new), `e2e/support/mount-harness.ts` and a new harness entry
beside `focus-harness.tsx` (edit/new; parameterise the bundling by entry rather than copying it).

1. A harness entry mounts `FailurePanel` in every shape and both placements inside `I18nProvider`,
   `en` and `pl`, so the shapes that have no producer yet can be seen and scanned.
2. `errors.visual.spec.ts`: axe (`e2e/support/axe-scan.ts`, zero `serious`, zero `critical`) on the
   real 404 (`/does-not-exist`) and on one real forced failure (`failServerFns`, a signed-in route,
   the `_app` boundary or the route's panel), in both themes; axe over the harness page for every
   shape; the forced failure declares its deliberate console noise the way `states.spec.ts` does.
3. Evidence per `scripts/visual/capture.mjs`: each of the four shapes plus the 404, light and dark,
   360 / 1280 / 2560 px, the interaction state that is the point (the focused heading after a failed
   action; the Copy button's status line). Frames go outside the repository.

Verification: the new spec, run alone, then the command gate; `pnpm e2e` is CI's.

### Phase 5 - The guideline and the plan reconciled

Files: `DESIGN.md` (edit), `docs/plans/05-error-and-observability.md` (edit),
`docs/plans/27-pwa-and-mobile.md` (edit, one sentence) and, if the tracker is reachable, one issue.

1. `DESIGN.md` -> Component guidelines gains **Error panel** following the five bullets of that
   section: the shape (radius, type, tokens), the tones and what each means (`negative` for a fault,
   `warning` for a limit), the states it has and lacks, what carries the meaning without colour, and
   the one thing it is not (an `EmptyState`, `DESIGN.md` § Empty state, and a toast). It states the
   alert-versus-region rule, the focus rule and the rule "never render `error.message`; the
   reference is an opaque id".
2. The plan: correct `05-S2`'s owned paths to the real ones, name the `negative` token family, record
   `OBS-04`..`OBS-06` as delivered with this spec's evidence and `OBS-06`'s offline half as deferred
   to `27-S1`, add under `05-S1` the sentence that its mapper builds `FailureView` (browser-safe, in
   the shell) and must keep every `quota` envelope free of an amount, and add the
   `Delivered: <date> - <evidence>` line under the `## Stage 05-S2` heading. Add one sentence to
   `27-S1`'s `PWA-03` row saying the failure panel does not own an offline shape.
3. File the follow-up issue "Remove `detail={error.message}` from the 21 route modules and show the
   classifier's output instead", `Blocked by` the issue for `05-S1`.

Verification: command gate; `pnpm generate-spec-index`.

## 📝 Resolved assumptions (autonomous defaults)

| #   | Question                                                          | Applied default                                                                                                                                                                     | Why                                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | How does `05-S2` meet an envelope `05-S1` has not built?          | A browser-safe `FailureView` keyed by recovery shape, owned by the shell; `05-S1` owns the mapper; no `Blocked by`.                                                                 | Decided by software architect sub-agent (confidence high): the plan places both stages in Wave 1 and `05-S2` has no blockers; a `shapeOf(kind)` in the shell would be a second classifier.                                                                                      |
| 2   | Which part of the stage is still work, and is `detail=` in scope? | The shapes, role and focus, `RouteError` as the internal shape, evidence, guideline and plan reconciliation. The 21 `detail=` removals stay out.                                    | Decided by product-owner sub-agent (confidence medium): everything in scope is additive and reversible; the removals touch other areas' modules and need `05-S1` to know what to show.                                                                                          |
| 3   | Extend `ErrorPanel` or add a sibling?                             | Both, narrowly: `ErrorPanel` gains four optional props; `FailurePanel` is a sibling that composes it.                                                                               | The two verdicts differed here (architect: sibling; product owner: opt-in props on the existing panel). This is the intersection, and the more reversible one: the default render of the existing panel is unchanged.                                                           |
| 4   | Is an offline shape in this stage?                                | No. `OBS-06` splits: the 404 closes here, the offline surface is deferred to `27-S1` (`PWA-03`).                                                                                    | Decided by product-owner sub-agent (confidence medium), over the architect's contract which listed `offline`: `27-S1` owns `/offline` and the banner and says `navigator.onLine` is unreliable. Taken as the smaller scope.                                                     |
| 5   | Where does the panel live, and what about the plan's owned paths? | `src/components/app/shell/`; the plan is amended to the real paths.                                                                                                                 | Decided by software architect sub-agent (confidence high): `docs/SPEC.md` §8, the ownership test and 41 consumers.                                                                                                                                                              |
| 6   | Does the event id ship now?                                       | As an optional `reference` rendered only when passed, with a Copy button; no producer until `05-S3`.                                                                                | Decided by product-owner sub-agent (confidence medium): `RouteError.reference` and `empty.error.reference` already exist; no dependency on Sentry.                                                                                                                              |
| 7   | What does `feature_locked` name?                                  | The plan only, not the module.                                                                                                                                                      | Default: `FeatureLockedError.module` is a free string (`src/server/repos/errors.ts`) and there is no module-name catalogue to translate it; a raw module id would put untranslated text on screen.                                                                              |
| 8   | What does the internal body say?                                  | A new `failure.internal.body` that claims nothing about reporting; `empty.error.body` ("The problem has been reported") is left alone.                                              | Default: nothing reports to Sentry until `05-S3`, so the existing sentence is untrue today. Fixing the existing copy is not this spec's change; it is noted in the plan.                                                                                                        |
| 9   | Alert or region for page-level failures, and focus on first load? | Region for `page`, alert for `after-action`; focus the heading after a client navigation, with focusing in both cases as the safe fallback.                                         | Default from the plan's own accessibility paragraph; the panel review (rows 11 onwards) checks it.                                                                                                                                                                              |
| 10  | Which numbers and claims were measured?                           | 41 files / 45 uses of `<ErrorPanel`; 21 `detail=` call sites; 87 lines in `error-panel.tsx`; no `onLine` in `src`; `src/server/errors` absent; `RouteError.reference` never passed. | Commands run: `grep -rln "<ErrorPanel" src --include=*.tsx \| wc -l`; `grep -rn "<ErrorPanel" src --include=*.tsx \| wc -l`; `grep -rn "detail=" src --include=*.tsx \| grep -c error`; `wc -l`; `grep -rn "onLine" src`; `ls src/server/errors`; `grep -rn "<RouteError" src`. |
