# The failure panel's shapes, the page-level boundaries and plan stage 05-S2 reconciled

| Field              | Value                                            |
| ------------------ | ------------------------------------------------ |
| **Status**         | ready                                            |
| **Issue**          | none                                             |
| **Spec PR**        | #635                                             |
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

Phase 1 adds five opt-in props to the existing shell `ErrorPanel` (tone, alert or region, heading
level, focus the heading, extra actions; the default render unchanged for its 41 consumers) and a
sibling `FailurePanel` with a small browser-safe `FailureView` contract keyed by recovery shape
(`retryable | quota | feature_locked | internal`). Phase 2 makes `RouteError`, the floor under every
route, the page-level internal failure: a region with an `h1`, focus handled by one explicit rule, a
link back to `/dashboard` inside the shell, and a copyable reference. Phase 3 adds
`e2e/errors.visual.spec.ts` and the browser evidence. Phase 4 writes the `DESIGN.md` guideline,
reconciles the plan, files the follow-up issue and records the stage as delivered, naming the two
halves that are not. No schema change, no migration, no new dependency, no server code.

Two things are deliberately **not** here: the offline-failure surface (plan `27-S1` owns `/offline`
and the connection banner, `PWA-03`) and the removal of the repository's developer-facing message
from the screen at 46 `detail=` sites and 33 `error instanceof Error ? error.message` sinks (a
follow-up that needs `05-S1`'s classifier to know what to show instead; Phase 4 files it).

## 📝 Problem Statement

Verified against the repository at the time of writing (commands in Resolved assumptions row 12).

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
- **A route-level failure** (`OBS-04`, a second shape without its recovery). `RouteError`
  (`route-error.tsx`) takes no error by construction, so nothing can leak, renders `empty.error.title`
  and `app.shell.error.body` in a centred card with a `warning` glyph and an `h2`, offers Retry and
  has an optional `reference` slot with catalogue key `empty.error.reference`. Its test
  (`route-error.test.tsx`) asserts the alert role, the Polish copy and that neither the message nor
  the stack reaches the screen.
- **A way to force a failure** in a real browser: `failServerFns` in `e2e/support/states.ts` answers
  every `/_serverFn/*` with a 500, and `e2e/states.spec.ts` already uses it for the transaction
  detail. `e2e/support/axe-scan.ts` is the one axe definition.

**What does not hold**

1. **There are not three recoveries, there is one.** The stage's central requirement ("a single
   generic panel with a Reload button is the shape this stage exists to avoid") is unmet: no
   surface can say "plan Free, limit reached: Accounts, here is where to change it", and the
   page-level failure (`RouteError`) has no way back to `/dashboard`. The route `/settings/billing`
   exists (`src/routes/_app/settings/billing.tsx`), and the catalogue already names every metric
   (`billing.usage.metric.*`) and plan (`plans.<id>.name`), so the copy needs no new vocabulary.
   There is no producer of a quota failure on the client yet (that is `05-S1`'s envelope and
   `22-billing`), so the quota and feature-locked shapes are specified against a contract and are
   not reachable in production until a mapper exists (Resolved assumptions 11).
2. **Alert versus region is not a decision anyone made.** `ErrorPanel` and `RouteError` are
   `role="alert"` unconditionally. The route-level `errorComponent`s render an alert on initial
   render, which the plan calls out ("an alert on initial render is announced before the person has
   any context for it"), and no failure moves focus anywhere: after a failed save in a dialog the
   reader hears the alert but keyboard focus stays where it was. `RouteError` has an `h2` and no
   `h1`, because the failing route's own `h1` is gone, and `DefaultRouteError`
   (`default-error.tsx`) renders it in a bare `<div>` with no `<main>`, so the skip link has no
   target there.
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
8. **Disclosed, not fixed here: the repository's developer-facing message reaches the screen.**
   `grep -rn "detail=" src --include=*.tsx` finds 46 lines in 42 files, 21 of them
   `detail={error.message}` (route `errorComponent`s), and 33 more lines in `-ui` files do
   `error instanceof Error ? error.message : ...` into a local `failure` state or a toast. Those are
   the after-action surface this panel is for, and they can carry `ForbiddenError` role lists and
   `QuotaExceededError` "(current/limit)" text from `src/server/repos/errors.ts`. That contradicts
   `05-S1`'s "no detail at all", but the right replacement depends on the classifier that does not
   exist yet. The new components never accept or forward an error message; Phase 4 files the
   follow-up that audits every one of these sites (the 46 `detail=` lines include uses that do not
   carry an error, so only the 21 `error.message` ones and the 33 `error instanceof Error` sinks are
   the confirmed set). `RouteError.reference` is also never passed by any caller today.

**Why now.** Plans `04` (`04-auth-and-tenancy.md:315`, a route failure rendering `ErrorPanel` inside
the shell so navigation survives), `17` (`17-analytics.md:174`, an error state for the analytics
views) and `18` (`18-dashboard.md:20`, a failing widget renders its own `ErrorPanel` in place, sized
to its cell) all name `ErrorPanel` from this stage as if it were the finished article. Each of them
builds a failure state this spec's contract is meant to be the single answer to.

## 📝 Proposed Solution

Keep the existing frame and make the **recovery** the unit of design. Three decisions:

1. **`ErrorPanel` stays where it is and changes only additively.** Five optional props, all
   defaulting to today's behaviour: `tone` (`'negative'` default, or `'warning'`; picks the border,
   the soft wash and the glyph colour), `mode` (`'alert'` default, or `'region'`), `headingLevel`
   (default `3`, as today; `2 | 3 | 4`), `focusHeading` (default `false`) and `actions` (extra nodes
   beside the Retry button). The 41 consumers and the ownership test do not change.
2. **A sibling `FailurePanel` is the kind-aware surface for a block of the page or the result of
   an action**, in the same shell module and barrel. It takes a `FailureView` and composes
   `ErrorPanel`; it adds copy and recovery per shape. The shape is the discriminant, **not**
   `05-S1`'s ten `kind` strings: `src/server/repos/errors.ts` says only the classifier switches on
   `code`, and a `shapeOf(kind)` in the shell would be a second classifier. `05-S1` owns the
   one-function mapper from its envelope to `FailureView`; this spec amends that stage's text in the
   plan (Phase 4) so the handoff is written down, with no `Blocked by` on it.
3. **`RouteError` is the whole-page failure** and stays a separate component, because it replaces a
   route rather than a block: its own frame, copy (`app.shell.error.body`) and `warning` tone are
   kept, so the 41 panels and the page-level state do not change look as a side effect. It gains the
   region role, an `h1`, the focus rule, the dashboard link and the shared reference line.

The reference line (the opaque id, its label and its Copy button) is one small component,
`FailureReference` in the shell, used by `FailurePanel` and `RouteError` (DRY).

**Alternatives considered.** (a) Make `05-S1` a hard precondition and import its envelope type:
simplest contract, but the plan puts both stages in Wave 1 with `05-S2`'s blockers "None", and the
spec could not be sliced until an unreviewed interface merged. (b) A `src/components/feedback/`
directory as the plan names it: breaks `docs/SPEC.md` §8's single owner and the 41 imports. (c)
Rewriting the `detail=` and `error.message` sites in this spec: other areas' route modules, no
classifier to show instead, not reversible. (d) An offline shape: duplicates `27-S1`. (e) Re-express
`RouteError` through `FailurePanel`: it would swap its copy and tone as a side effect for no
recovery gained.

## 📝 Architecture

| Concept                                      | Owner module                                                         |
| -------------------------------------------- | -------------------------------------------------------------------- |
| The frame, tone, alert/region, heading focus | `src/components/app/shell/error-panel.tsx` (edit)                    |
| `FailureView`, `FailurePanel`                | `src/components/app/shell/failure-panel.tsx` (new)                   |
| The reference line and its Copy button       | `src/components/app/shell/failure-reference.tsx` (new)               |
| The whole-page failure                       | `src/components/app/shell/route-error.tsx` (edit)                    |
| The router's floor boundary                  | `src/components/app/shell/default-error.tsx` (edit)                  |
| The 404                                      | `src/components/app/shell/not-found.tsx` (unchanged)                 |
| Quota metric and plan vocabulary             | `src/lib/plans.ts` (`QuotaMetric`, `PlanId`; imported, not restated) |
| Envelope to `FailureView` mapper             | `05-S1` (`src/server/errors/`), recorded in the plan by Phase 4      |

`failure-panel.tsx` and `failure-reference.tsx` are browser-safe and import nothing from `#/server`
(`#/server/errors` does not exist yet); they may import the types `QuotaMetric` and `PlanId` from
`#/lib/plans`, which is isomorphic and binding-free by its own docblock. The shell barrel
(`src/components/app/shell/index.ts`) exports `FailurePanel` and the `FailureView` type.

```ts
// The discriminant is the recovery, not the server's kind.
export type FailureView =
  | { shape: 'retryable' }
  | { shape: 'quota'; metric: QuotaMetric; plan: PlanId }
  | { shape: 'feature_locked'; plan: PlanId }
  | { shape: 'internal'; reference?: string }
```

There is no `number` in it, and `metric` and `plan` are closed unions of the catalogue's own ids,
rendered through `billing.usage.metric.<metric>` and `plans.<plan>.name`. `reference` is the only
free-form string, so a narrowing rule sits on the rendering side:
**a reference is rendered only when it matches the opaque-id shape `/^[A-Za-z0-9_-]{8,64}$/`**
(a Sentry event id or a request id); anything else is dropped and the reference line, with its Copy
button, is omitted. The same rule holds in `RouteError`. **The rule narrows the string; it does not
prove it is not an amount**: a digits-only string of 8 to 64 characters passes it. What keeps an
amount out is the producer (`05-S3` or the `05-S1` mapper) passing only an event or request id, and
that constraint is written into the plan by Phase 4. `title` and `body` are catalogue strings by
convention only; the type cannot say so, and a test cannot prove it.

`FailurePanel` props: `failure: FailureView`, `placement: 'after-action' | 'in-place'`, `onRetry?`,
`isRetrying?`, `homeHref?` (the dashboard link of the `internal` shape, passed only by a caller
inside the shell, so the panel never decides by itself whether the reader is signed in), `title?` and
`body?` (required for `retryable`, whose wording is the call site's, as `ErrorPanel`'s docblock
explains; **catalogue copy, never `error.message`**; ignored by the other shapes, which own their
copy) and `className?`. **It has no `detail` prop and never forwards one to `ErrorPanel`**, so no
shape renders a `<details>`. `placement` decides `mode`: `after-action` -> `alert`, `in-place` ->
`region`. `in-place` is a block that failed to load (a widget, a tab); it never moves focus by
itself.

The four recoveries:

| Shape            | Recovery rendered                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `retryable`      | The Retry button (`onRetry`, pending while `isRetrying`). The panel is rendered **beside** the form, never instead of it, so input survives. |
| `quota`          | A link to `/settings/billing` (label `billing.title`) and the body "Plan: Free. Limit reached: Accounts."                                    |
| `feature_locked` | The same link, and a body naming the plan only (Resolved assumptions 7).                                                                     |
| `internal`       | An apology, Retry when `onRetry` is passed, the optional reference line with Copy, and a link to `homeHref` when passed.                     |

## 📝 Data Model

None. No table, no column, no migration, no KV key, no queue message.

## 📝 API Contracts

No server function, route handler or envelope. The one contract is the in-process `FailureView`
above, and it is internal to the shell. `05-S1`'s envelope is `{ v: 1, kind, message, fields?,
retryAfter? }`; the mapper from it to `FailureView` is that stage's. Two constraints on that mapper
are written into the plan by Phase 4: a `kind` with no panel shape (`validation`, `rate_limited`,
`rate_unavailable`, `upstream`, `conflict`) is mapped to `retryable` or `internal` by that stage, and
**`not_found` and `forbidden` map to the same shape**, so the panel never offers different recoveries
for a missing row and a foreign one (the 404/403 indistinguishability of `docs/SECURITY.md` and
`src/server/repos/errors.ts` survives once a mapper exists). `FailurePanel` and `RouteError` take no
error object at all.

## 📝 UI/UX

**States.** `FailurePanel` is a state with the four shapes above. `retryable` and `internal` use the
`negative` tone (border `border-negative/30`, `negative-soft` wash, as today); `quota` and
`feature_locked` use the `warning` tone, because they are not faults. The tone is a **static class
map** (`negative` -> `border-negative/30`, the soft wash and the glyph colour; `warning` ->
`border-warning/30` and its pair), written out as full class names, because Tailwind cannot see a
class name built from a variable. The glyph is `aria-hidden` and
the heading and sentence carry the meaning (Colour Is Never Alone). `negative`/`negative-soft` and
`warning`/`warning-soft` are token pairs declared for both themes in `tokens.css`, each commented at
7:1 or better; no new token, and the contrast is read from those comments, not recomputed.

**Accessibility.** This widens no claim in `docs/ACCESSIBILITY.md`.

- **Alert versus region.** `placement="after-action"` renders `role="alert"` (it appears in response
  to something the reader just did). `in-place` and `RouteError` render a plain region labelled by
  its heading (`role="region"` and `aria-labelledby`), because they are the page's content and an
  alert on initial render is announced before the person has any context for it.
- **After an action: alert plus focus, deliberately.** Focus moves to the heading
  (`tabIndex={-1}`, programmatic only) so a keyboard reader lands on the explanation and Retry is
  the next tab stop. The alert announces the same content, so a screen reader may hear the heading
  twice; this is accepted and documented because the alternative (alert only) leaves keyboard focus
  on a control that may have just been disabled. The heading is the first element inside the alert,
  and a test pins the DOM order. `FailurePanel` with `placement="after-action"` is the **only**
  caller that sets `focusHeading` (and passes `mode="alert"`); `in-place` passes `mode="region"` and
  never moves focus, and the 41 existing `ErrorPanel` consumers keep `focusHeading` off.
- **Focus when the panel goes away.** If the focused element is inside a panel with `focusHeading`
  set, or inside `RouteError`, when it unmounts, for example after a successful Retry, focus moves to
  the enclosing dialog, or else to `#MAIN_CONTENT_ID` (`<main tabIndex={-1}>`), rather than falling
  to `<body>`. It does not apply to `in-place` panels. In the **`useLayoutEffect` cleanup** the hook
  records whether focus was inside the panel and resolves the target while the node is still
  attached: `panel.closest('[role="dialog"],[role="alertdialog"]')`, else none (by the time a
  passive-effect cleanup runs the node is detached and `document.activeElement` is already `body`).
  After the commit (a microtask), and only if `document.activeElement` is `document.body`, it focuses
  that dialog if it is still connected, otherwise the `#MAIN_CONTENT_ID` then in the document. It
  never moves focus that something else has already placed. The test unmounts a panel that holds
  real focus. The
  focus move and the restore are one shared hook, `useFocusHeading`, used by `ErrorPanel` and
  `RouteError` (DRY).
- **Whole-page failure (`RouteError`).** It replaces the failing route's content and with it the
  route's `h1`, so it renders an `h1`. It moves focus to its heading **only when it mounts after the
  initial document render**; on the initial render the browser has already placed focus on the
  document and the skip link must stay the first tab stop. The signal is `useIsAfterInitialRender` in the
  shell: `useSyncExternalStore(subscribe, () => true, () => false)` read on the component's first
  render and kept in a ref. It is `false` on the server and while hydrating, `true` for any mount
  after hydration, decided at render time, independent of effect order and of whether a
  `RouteAnnouncer` exists. It therefore applies under `_app`, `(auth)` and the floor boundary alike.
  `RouteAnnouncer` is not changed. `RouteError` never focuses its heading when the hook returns
  `false`. The reason to move focus after a client navigation is that the content the reader
  asked for is gone.
- **Which boundary renders a failing child route.** TanStack Router gives every match its own
  boundary, `route.options.errorComponent ?? router.options.defaultErrorComponent`
  (`@tanstack/react-router/src/Match.tsx`). A child of `_app` that throws is therefore rendered by
  `DefaultRouteError` **inside** the shell's content area, not by `_app`'s inner `CatchBoundary`,
  which only catches errors that happen outside the child matches. So `DefaultRouteError` decides
  its own placement, from `useMatches()` route ids: under `_app` it renders no `<main>` (the shell
  has one) and passes `homeHref="/dashboard"`; under `(auth)` it renders no `<main>` and no
  `homeHref`; anywhere else (`index.tsx`, `invite.$invitationId.tsx`, `unsubscribe.tsx`) it renders
  `<main id={MAIN_CONTENT_ID} tabIndex={-1}>` and no `homeHref`. Exactly one `<main>` and one
  `MAIN_CONTENT_ID` exist on every page.
- **Document title on an error page** (SC 2.4.2, level A). `RouteError` does not touch
  `document.title`. The router runs `head()` for the failed match too (`router-core`
  `projectLane`), so the tab already carries the failed route's own `pageHead` title, or the root's
  where the route has none; an imperative write would compete with the `<title>` `HeadContent`
  renders and would survive a successful Retry on the same route. No entry is added to
  `docs/ACCESSIBILITY.md` §6, because there is no deviation.
- **Copy button.** The `role="status"` element is rendered **empty from the first paint** and
  filled on success (a region inserted together with its text is not announced; `RouteAnnouncer`'s
  docblock says so), and the same text is visible beside the button. Clipboard support is detected
  **after mount** (`useSyncExternalStore` with a server snapshot of `false`, or an effect), never
  during the first render: `RouteError` can render on the server, and a button that exists only in
  the browser would be a hydration mismatch (`docs/ACCESSIBILITY.md` §5.1). The status region is in
  the first render regardless. A rejected write fills the same region with
  `failure.reference.copyFailed`. A second press writes the same text, so the region is cleared and
  re-filled (in a following tick) for the repeat to be announced. It copies the bare reference, not
  the "Reference: ..." sentence.
- **Targets.** Every button and link keeps the 44px hit area; links in the `actions` slot and the
  dashboard link use `buttonVariants` as `not-found.tsx` does (or `target-min-h`), never a bare
  anchor.
- **Reflow.** Single column from 360 px; actions wrap; a reference uses `break-all`, never a
  horizontal scroll; the card is capped at the measure on 2560 px; the longest Polish strings pass a
  320 px / 200% zoom check.

## 📝 Edge Cases & Failure Scenarios

- **A `retryable` panel with no `onRetry`:** renders without the button (as `ErrorPanel` does today).
- **A reference that is not an opaque id** (`1 234,56 EUR`, `€1,234`, a sentence, 65 characters):
  dropped, no reference line, no Copy button.
- **Clipboard unavailable or rejecting:** no button when the API is absent; a visible and announced
  failure line when a write rejects.
- **Internal failure outside the signed-in shell** (the `(auth)` boundary, the public routes that
  fall to the router default, the guard failing in `_app`'s own `errorComponent` inside
  `AppShellFallback`): no `homeHref`. A signed-out reader sent to `/dashboard` is bounced through
  `/login`, and a guard that just failed would loop. The router default under `_app` is inside the
  shell and does get the link (see "Which boundary renders a failing child route").
- **Double report.** Rendering a panel adds no `console` output of its own. A caught render error is
  also logged by React itself; `e2e/states.spec.ts` already declares that noise per test
  (`DELIBERATE_SERVER_FAILURE`), and the new spec does the same rather than weakening the console net.
- **A rate-limited failure with `retryAfter`** is out of this spec (the mapper chooses `retryable`);
  there is no countdown.
- **A quota failure for a metric the catalogue does not know** is a compile error by the type; there
  is no untyped path in this spec.

## 📝 Risks & Impact Review

| Risk                                                                    | Mitigation                                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A prop added to `ErrorPanel` changes one of 41 consumers                | Every prop optional with today's default; `error-panel.test.tsx` pins the default render; the ownership test stays green                                                                                   |
| A second `kind` vocabulary drifts from `05-S1`                          | The contract is keyed by recovery shape, not kind; the mapper is `05-S1`'s, written into its plan text                                                                                                     |
| An amount reaches the panel through `reference`                         | The shape rule narrows the string (a digits-only one still passes); the producer passes only event or request ids, written into the plan; a test renders hostile strings and documents the digit-only case |
| The panel is mistaken for a place to show `error.message`               | No `detail` prop, no `<details>`, titles and bodies are catalogue copy; the existing sites are tracked in the follow-up                                                                                    |
| The internal shape claims "reported" before Sentry exists               | `failure.internal.body` makes no such claim; `empty.error.body` (which does) is untouched and noted in the plan                                                                                            |
| The quota and feature-locked shapes are dead code until a mapper exists | Said so in the plan's `Delivered:` line; they are scanned and captured through a harness                                                                                                                   |
| `DESIGN.md` is a governance document                                    | The guideline ships in its own phase so the PR is `risk-high` with the second reviewer (`SDLC.md`)                                                                                                         |
| The panel looks right in the harness and wrong in the app               | Phase 3 captures the real 404 and a real forced failure in the app, not only the harness                                                                                                                   |
| Focus handling hides the skip link on an SSR error page                 | `RouteError` moves focus only after the initial render, or not at all                                                                                                                                      |

## 📝 Visual change expected

- **A new quota / feature-locked panel** (`warning` tone) and **an internal panel with a reference
  and a Copy button**: no route renders them until `05-S1` and `22-billing` supply a producer; they
  are captured through a harness, with the real 404 and a real forced failure captured in the app.
- **`RouteError`**: keeps its frame, copy and `warning` tone; its heading becomes an `h1` of the same
  visual size, it is a region and not an alert, it gains a "Back to the dashboard" link beside Retry
  inside the signed-in shell only, and a reference line with Copy when a reference is passed (none is
  today).
- **`DefaultRouteError`** gains a `<main>` wrapper only outside `_app` and `(auth)`, and the
  dashboard link under `_app`.
- Everything else (the 404, the 41 `ErrorPanel` consumers) is unchanged on screen.
- Light and dark, 360, 1280 and 2560 px. Evidence goes to `.ai/qa/artifacts_*/` or a scratchpad,
  never the repository.

## 📝 Copy

New keys, `en` and `pl` (the implementation lands each in both catalogues in the same change, per the
`i18n-messages` skill). `{plan}` is a catalogue plan name and `{metric}` a catalogue metric label,
both interpolated as a nominative after a colon, so Polish grammar does not depend on the plan
name's case (`plans.free.name` is the adjective "Bezpłatny" in Polish). No count, so no plural
machinery.

| Key                            | `en`                                               | `pl`                                                        |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------------------------- |
| `failure.quota.title`          | `This workspace is at its limit`                   | `Ten dom osiągnął limit`                                    |
| `failure.quota.body`           | `Plan: {plan}. Limit reached: {metric}.`           | `Plan: {plan}. Osiągnięty limit: {metric}.`                 |
| `failure.featureLocked.title`  | `Not part of your plan`                            | `Poza Twoim planem`                                         |
| `failure.featureLocked.body`   | `Plan: {plan}. This is not included in it.`        | `Plan: {plan}. Tej funkcji nie obejmuje.`                   |
| `failure.internal.body`        | `We could not finish that. Try again in a moment.` | `Nie udało się tego dokończyć. Spróbuj ponownie za chwilę.` |
| `failure.dashboard.action`     | `Back to the dashboard`                            | `Wróć do pulpitu`                                           |
| `failure.reference.copy`       | `Copy reference`                                   | `Skopiuj numer`                                             |
| `failure.reference.copied`     | `Reference copied`                                 | `Numer skopiowany`                                          |
| `failure.reference.copyFailed` | `Could not copy the reference`                     | `Nie udało się skopiować numeru`                            |

Reused as they are: `empty.error.title`, `empty.error.reference`, `app.shell.error.body`,
`action.retry`, `billing.title` (the billing link), `billing.usage.metric.*`, `plans.<id>.name`. The
Polish word for a workspace is `Dom` (the vocabulary rule at the top of `pl.ts`), which is why
`failure.quota.title` reads `Ten dom osiągnął limit`.

## 📋 Phasing

Four phases, four tickets (`afk-to-tickets` cap: eight). Phase 1 is one ticket on purpose: the
panel's new props have no consumer outside `FailurePanel`, so shipping them alone would be an
enabling layer with nothing to see. Phase 4 is separate: it edits `DESIGN.md`, a governance
document, and takes the second reviewer.

| Phase | Ships                                                                                            | Depends on |
| ----- | ------------------------------------------------------------------------------------------------ | ---------- |
| 1     | `ErrorPanel` props; `FailureView`, `FailurePanel`, `FailureReference`; the copy; tests           | none       |
| 2     | `RouteError` and `DefaultRouteError`: region, `h1`, focus rule, dashboard link, reference; tests | 1          |
| 3     | `e2e/errors.visual.spec.ts`, the harness entry, browser evidence                                 | 2          |
| 4     | `DESIGN.md` guideline; the plan reconciled and `05-S2` marked delivered; the follow-up issue     | 3          |

## 📋 Implementation Plan

### Phase 1 - the panel's shapes

Files: `src/components/app/shell/error-panel.tsx` (edit),
`src/components/app/shell/failure-panel.tsx` (new),
`src/components/app/shell/failure-reference.tsx` (new), `src/components/app/shell/use-focus-heading.ts` (new),
`src/components/app/shell/index.ts` (edit),
`src/components/app/shell/__tests__/error-panel.test.tsx` (new),
`src/components/app/shell/__tests__/failure-panel.test.tsx` (new),
`src/lib/i18n/messages/en.ts` and `pl.ts` (edit).

1. `ErrorPanel`: add `tone`, `mode`, `headingLevel`, `focusHeading` and `actions` as in Proposed
   Solution. The tone is a static class map. `mode="region"` renders `role="region"` with
   `aria-labelledby` the heading id from `useId`. `focusHeading` uses the shared `useFocusHeading`
   hook (new, in the shell, also used by `RouteError`): it focuses the heading on mount and, in a
   `useLayoutEffect` cleanup, restores focus as Accessibility says ("Focus when the panel goes away"): to the enclosing dialog,
   else `#MAIN_CONTENT_ID`, after the commit and only if focus fell to `<body>`. Update
   the docblock: it currently justifies `role="alert"` by "appears in response to something the
   reader just did"; state the region case beside it.
2. `FailureReference`: the `empty.error.reference` line, the opaque-id shape check, the Copy button
   (clipboard support detected after mount) with the empty-from-first-paint status region, the
   clear-and-refill on a repeat press, the visible confirmation and the failure line, as specified
   under Accessibility.
3. `FailurePanel`: the four shapes per the recovery table. `quota` and `feature_locked` pass
   `tone="warning"` and a router `Link` to `/settings/billing` styled with `buttonVariants` in
   `actions`. No `detail` prop. Export from the barrel with the `FailureView` type.
4. Add the nine keys to both catalogues; run the parity test.
5. `error-panel.test.tsx`: the default render is `role="alert"`, an `h3`, `negative` tone, no focus
   move, Retry only; `mode="region"` is a labelled region and not an alert; `tone="warning"`;
   `focusHeading` moves focus to the heading, the heading comes first inside the alert, Retry is the
   next tab stop, unmounting a panel that holds real focus moves focus to `#MAIN_CONTENT_ID`, and a panel with
   `focusHeading` holding real focus inside a `role="dialog"` unmounts and focus lands on the
   dialog, not on `<main>`;
   `detail` still renders under a closed disclosure; Retry keeps a sibling input's value; a `console`
   spy records nothing.
6. `failure-panel.test.tsx`: each shape renders its own recovery and not the others'; `role="alert"`
   only for `after-action`; no shape renders a `<details>` element; the quota and feature-locked
   bodies contain only catalogue names; **hostile references** (`1 234,56 EUR`, `€1,234`, a 65-character
   string, a sentence) produce no reference line and no Copy button, while `evt_7f3a91c2` renders; a
   digits-only string of 8 characters renders too, and the test says in its name that this is the
   documented residual (the producer's constraint, not the shape rule's);
   Copy writes exactly the bare reference, announces it through the pre-existing empty status region,
   announces a second press again (the region is cleared and re-filled), hides the button when
   `navigator.clipboard` is absent and announces `copyFailed` on a rejection; **an SSR render
   followed by hydration has a clean console and no mismatch** (the button appears only after
   mount); Polish renders the Polish copy; a `console` spy records nothing.

Verification: the two test files, the ownership test unchanged and green, the command gate, and
`grep -n "#/server" src/components/app/shell/failure-*.tsx` printing nothing.

### Phase 2 - the whole-page failure

Files: `src/components/app/shell/route-error.tsx` (edit), `src/components/app/shell/default-error.tsx`
(edit), `src/routes/_app.tsx` (edit, only if the inner boundary keeps a use for it, see item 2),
`src/components/app/shell/use-is-after-initial-render.ts` (new),
`src/components/app/shell/__tests__/route-error.test.tsx` (edit),
`src/components/app/shell/__tests__/default-error.test.tsx` (new).

1. `RouteError`: keep the frame, `empty.error.title`, `app.shell.error.body` and the `warning` tone.
   Change the heading to an `h1` of the same visual size, the root to a labelled region, and add
   `homeHref?`, `FailureReference` for `reference`, the focus rule from Accessibility (the shared
   `useFocusHeading`, gated by `useIsAfterInitialRender`). Public props stay `onRetry`, `reference`,
   `className`, plus `homeHref`. It still takes no error.
2. `useIsAfterInitialRender` (new, in the shell) is
   `useSyncExternalStore(subscribe, () => true, () => false)` read on the component's first render
   and kept in a ref: `false` on the server and while hydrating, `true` for any mount after
   hydration, independent of effect order and of whether a `RouteAnnouncer` exists.
   `DefaultRouteError` places itself with `useMatches()` route ids as described under Accessibility
   ("Which boundary renders a failing child route"): under `_app` no `<main>` and
   `homeHref="/dashboard"`; under `(auth)` no `<main>` and no `homeHref`; elsewhere `<main
id={MAIN_CONTENT_ID} tabIndex={-1}>` and no `homeHref`. `_app.tsx`'s inner `CatchBoundary` covers
   only errors outside the child matches and passes `homeHref="/dashboard"` for that case; if the
   implementation finds it unreachable it drops the prop rather than keeping dead code. Its outer
   `errorComponent` (the guard failed) and `(auth)/route.tsx` pass nothing.
3. `route-error.test.tsx`: the `role="alert"` assertions become a labelled region; every existing
   negative assertion (no message, no stack, no reference label without a reference) stays and the
   `app.shell.error.body` assertion is kept; add the `h1`, the dashboard link only when `homeHref` is
   passed, the reference rules from Phase 1, `document.title` is unchanged by mounting and by
   unmounting `RouteError`, focus is not moved when `RouteError` is server-rendered and hydrated with
   `hydrateRoot`, and is moved to the `h1` when it is mounted by a client render, in a tree with no
   `RouteAnnouncer`, focus restored to `<main>` when a `RouteError` that holds real focus unmounts,
   and a `RouteError` inside `DefaultRouteError`'s own `<main>` that unmounts together with that
   `<main>` leaves focus on the `#MAIN_CONTENT_ID` rendered next, not on `<body>`. `default-error.test.tsx` covers all three
   placements (under `_app`, under `(auth)`, elsewhere): exactly one `<main>`, one
   `MAIN_CONTENT_ID`, and the dashboard link only under `_app`.

Verification: command gate; `e2e/states.spec.ts` and `e2e/not-found.spec.ts` still pass.

### Phase 3 - browser evidence and the axe gate

Files: `e2e/errors.visual.spec.ts` (new), `e2e/support/mount-harness.ts` (edit) and a new harness
entry beside `focus-harness.tsx`.

1. Parameterise the harness bundling by entry rather than copying it. The new entry mounts
   `FailurePanel` in every shape and both placements, and `RouteError`, inside `I18nProvider` **and a
   TanStack router** (`createRouter` plus `RouterProvider`, as `not-found.test.tsx` does), because
   the billing and dashboard `Link`s need router context and `focus-harness.tsx` has none. `en` and `pl`.
2. `errors.visual.spec.ts`: axe (`e2e/support/axe-scan.ts`, zero `serious`, zero `critical`) on the
   real 404 (`/does-not-exist`) and on one real forced failure, in both themes. **No signed-in route
   can produce a forced failure that reaches `RouteError`**: every one with a loader has its own
   `errorComponent`. The forced failure is therefore either `unsubscribe.tsx` (public, has a loader,
   no `errorComponent`, so the router default answers) or the harness alone; the real 404 is the
   in-app evidence, and the spec says which of the two it used. `failServerFns` is installed **after**
   the app is loaded and the failure is triggered by a client-side navigation, because a `page.goto`
   runs the loader during SSR. The spec asserts exactly one `<main>` and one `MAIN_CONTENT_ID` on the
   failed page, and that `document.title` equals the destination route's `pageHead` title
   (`unsubscribe.meta.title` followed by the product name), in `en` and `pl`. Axe also scans the harness page for every shape. The forced failure declares its
   deliberate console noise the way `states.spec.ts` does.
3. Target size: bounding-box assertions of at least 44 x 44 px for Retry, Copy, the billing link and
   the dashboard link at 360 px, in `en` and `pl`; plus a 320 px reflow check with the longest Polish
   strings and a `reference` of 64 characters (WCAG 1.4.10), asserting no horizontal scroll.
4. Evidence per `scripts/visual/capture.mjs`: each of the four shapes plus the 404 and `RouteError`,
   light and dark, 360 / 1280 / 2560 px, the interaction state that is the point (the focused heading
   after a failed action; the Copy confirmation line). Frames go outside the repository.

Verification: the new spec run alone, then the command gate; `pnpm e2e` is CI's.

### Phase 4 - the guideline, the plan, the follow-up issue

Files: `DESIGN.md` (edit), `docs/plans/05-error-and-observability.md` (edit),
`docs/plans/27-pwa-and-mobile.md` (edit, one sentence).

1. `DESIGN.md` -> Component guidelines gains **Error panel** following the five bullets of that
   section: the shape (radius, type, tokens), the tones and what each means (`negative` for a fault,
   `warning` for a limit), the states it has and lacks, what carries the meaning without colour, and
   the one thing it is not (an `EmptyState` and a toast). It states the alert-versus-region rule, the
   focus rule, the rule that an error surface never writes `document.title`, and the rule "new code
   never renders `error.message`; the reference is an event or request id", with the follow-up issue named as the tracked exception for
   the existing sites. It cites `docs/ACCESSIBILITY.md` §1, states no conformance level and widens
   nothing.
2. The plan (`docs/plans/05-error-and-observability.md`): correct `05-S2`'s owned paths to the real
   ones; name the `negative` token family; amend its Verification text to say the quota and
   feature-locked shapes are captured through a harness (no route can produce them yet) while the
   404 and a forced failure are captured in the app; amend `05-S1` with the sentence that its mapper
   builds `FailureView` (browser-safe, in the shell), must send `not_found` and `forbidden` to the
   same shape, passes only an event or request id as `reference` and keeps every `quota` envelope
   free of an amount; update `05-S2`'s Money-invariant and Verification references to
   `failure-panel.test.tsx` and its "three shapes" wording to the four shapes; and add under the
   `## Stage 05-S2`
   heading `Delivered: <date> - <evidence>`, where the evidence names the paths and tests above **and
   states the two open halves**: the offline half of `OBS-06` (deferred to `27-S1`, `PWA-03`) and the
   quota and feature-locked shapes having no producer until `05-S1` and `22-billing`. In
   `docs/plans/27-pwa-and-mobile.md`, one sentence on the `PWA-03` row saying the failure panel owns
   no offline shape.
3. **File the follow-up issue** (required): "Audit the `detail=` sites and remove those that carry
   the repository's message": the 46 `detail=` lines (21 of them `detail={error.message}`, the
   confirmed set; the rest need a look) and the 33 `error instanceof Error ? error.message` sinks,
   showing the classifier's output instead. `Blocked by` the issue for `05-S1`; if none exists when
   Phase 4 runs, the body names plan stage `05-S1` and is linked when `afk-to-tickets` creates that
   issue. It lists the greps that produced the numbers. The PR body names the issue number.

Verification: command gate (`pnpm generate-spec-index` and the plan/spec checks it carries).

## 📝 Resolved assumptions (autonomous defaults)

| #   | Question                                                                     | Applied default                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | How does `05-S2` meet an envelope `05-S1` has not built?                     | A browser-safe `FailureView` keyed by recovery shape, owned by the shell; `05-S1` owns the mapper; no `Blocked by`.                                                                                                                                                                | Decided by software architect sub-agent (confidence high): the plan places both stages in Wave 1 and `05-S2` has no blockers; a `shapeOf(kind)` in the shell would be a second classifier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2   | Which part of the stage is still work, and are the `detail=` sites in scope? | The shapes, role and focus, `RouteError`, evidence, guideline and plan reconciliation. The `detail=` and `error.message` removals stay out, tracked by a required issue.                                                                                                           | Decided by product-owner sub-agent (confidence medium): everything in scope is additive and reversible; the removals touch other areas' modules and need `05-S1` to know what to show.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3   | Extend `ErrorPanel` or add a sibling?                                        | Both, narrowly: `ErrorPanel` gains five optional props; `FailurePanel` is a sibling that composes it.                                                                                                                                                                              | The two verdicts differed (architect: sibling; product owner: opt-in props on the existing panel). This is the intersection and the more reversible one: the default render of the existing panel is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 4   | Is an offline shape in this stage?                                           | No. `OBS-06` splits: the 404 closes here, the offline surface is deferred to `27-S1` (`PWA-03`).                                                                                                                                                                                   | Decided by product-owner sub-agent (confidence medium), over the architect's contract which listed `offline`: `27-S1` owns `/offline` and the banner and says `navigator.onLine` is unreliable. Taken as the smaller scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 5   | Where does the panel live, and what about the plan's owned paths?            | `src/components/app/shell/`; the plan is amended to the real paths.                                                                                                                                                                                                                | Decided by software architect sub-agent (confidence high): `docs/SPEC.md` §8, the ownership test and 41 consumers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6   | Does the event id ship now?                                                  | As an optional `reference` rendered only when it is an opaque id, with a Copy button; no producer until `05-S3`.                                                                                                                                                                   | Decided by product-owner sub-agent (confidence medium): `RouteError.reference` and `empty.error.reference` already exist; no dependency on Sentry. The shape rule is the security reviewer's condition (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 7   | What does `feature_locked` name?                                             | The plan only, not the module.                                                                                                                                                                                                                                                     | Default: `FeatureLockedError.module` is a free string (`src/server/repos/errors.ts`) and there is no module-name catalogue to translate it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 8   | What does the internal body say, and what does `RouteError` keep?            | `FailurePanel` uses a new `failure.internal.body` that claims nothing about reporting. `RouteError` keeps `app.shell.error.body` and its `warning` tone. `empty.error.body` ("has been reported") is left alone.                                                                   | Default: nothing reports to Sentry until `05-S3`, so the existing sentence is untrue today, and `RouteError`'s copy is accurate for the page-level case; changing the page-level look is not this spec's change. Raised by the architect and product-owner reviews.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 9   | Alert or region, and when does focus move?                                   | `after-action`: alert plus heading focus (double announcement accepted and tested). `in-place` and `RouteError`: region. `RouteError` focuses only after the initial render or not at all; on unmount focus goes to `<main>`.                                                      | Decided by accessibility-specialist sub-agent (confidence medium) in the panel review: the first-load fallback of the first draft was wrong because the skip link is the first tab stop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 10  | May `reference` carry any string?                                            | No: opaque-id shape `/^[A-Za-z0-9_-]{8,64}$/` or it is dropped; the panel has no `detail` prop and never renders a `<details>`.                                                                                                                                                    | Decided by security-tenancy-reviewer sub-agent (confidence medium) in the panel review: the type has no `number`, but `reference` is a free string, so the rule has to be on the rendering side.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 11  | Is code with no producer acceptable?                                         | Yes, for the quota and feature-locked shapes: scanned and captured through a harness, and named as open in the plan's `Delivered:` line.                                                                                                                                           | Decided by product-owner sub-agent (confidence medium) in the panel review; the alternative (a shape with nothing to show) would leave `OBS-04` unbuilt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 12  | Which numbers and claims were measured?                                      | 41 files / 45 uses of `<ErrorPanel`; 46 `detail=` lines in 42 files, 21 of them `detail={error.message}`; 33 `error instanceof Error ? error.message` lines; 87 lines in `error-panel.tsx`; no `onLine` in `src`; `src/server/errors` absent; `RouteError.reference` never passed. | Commands run: `grep -rln "<ErrorPanel" src --include=*.tsx \| wc -l`; `grep -rn "<ErrorPanel" src --include=*.tsx \| wc -l`; `grep -rn "detail=" src --include=*.tsx \| wc -l`; `grep -rln "detail=" src --include=*.tsx \| wc -l`; `grep -rn "detail={error.message}" src --include=*.tsx \| wc -l`; `grep -rn "error instanceof Error ? error.message" src --include=*.tsx \| wc -l`; `wc -l`; `grep -rn "onLine" src`; `ls src/server/errors`; `grep -rn "<RouteError" src`.                                                                                                                                                                                                                                                                                       |
| 13  | Panel verdicts on this spec (round 1)                                        | Software architect: approve with conditions (medium). Product owner: approve with conditions (medium). Accessibility specialist: approve with conditions (medium). Security and tenancy reviewer: approve with conditions (medium).                                                | Every condition was applied in the revision that follows: the tone prop, `RouteError`'s copy and tone, the harness router, the focus signal, the first-load rule, `<main>` on the floor boundary, the Copy status region, the Polish copy, the opaque-id rule, the required follow-up issue and the open halves in `Delivered:`. Round 2 is the next row.                                                                                                                                                                                                                                                                                                                                                                                                             |
| 14  | Panel verdicts on this spec (round 2, the last)                              | Security and tenancy reviewer: approve with conditions (medium). Product owner: approve with conditions (medium). Software architect: approve with conditions (medium). Accessibility specialist: **revise** (medium).                                                             | Every condition was applied in the revision after round 2: the boundary routing (a failing `_app` child is rendered by `DefaultRouteError` inside the shell, which places itself by route id), the Phase 3 forced failure and its SSR caveat, the shared `useIsAfterInitialRender` and `useFocusHeading` hooks, the layout-effect focus restore, clipboard detection after mount with a hydration test, the repeat-press announcement, the `Dom` Polish copy, `document.title` set by `RouteError`, the static tone class map, and the reworded opaque-id claim (it narrows; the producer must pass only event or request ids). Two rounds are the limit, so this revision was not reviewed again and the accessibility verdict stays at **revise**; see the handoff. |
| 15  | Accessibility verdict on the revision after round 2                          | Accessibility specialist: approve with conditions (medium). No imperative `document.title`; the initial-render signal is a hydration snapshot independent of the announcer; focus is restored to the enclosing dialog, else `<main>`, after the commit.                            | Decided by accessibility-specialist sub-agent (confidence medium): `head()` runs for the failed match too, so the tab already names the failed route and an imperative title would survive a successful Retry; the announcer's first-paint ref is instance-local and cannot be shared; restoring to `<main>` from inside a modal sends focus behind the dialog. Every condition is applied in this revision, which supersedes the **revise** in row 14.                                                                                                                                                                                                                                                                                                               |
