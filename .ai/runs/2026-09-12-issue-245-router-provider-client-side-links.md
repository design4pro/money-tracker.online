# Execution plan — the design-system link navigates through the router

`Source doc:` `.ai/specs/2026-09-11-router-provider-client-side-links.md`
`Issue:` #245
`Spec PR:` #253 (merged 2026-09-12)
`Engine:` om-auto-create-pr (steps: 12, --loop: no)

## Goal

Mount React Aria's `RouterProvider` so `src/components/ui/link.tsx` hands a click to TanStack Router
instead of to the browser, making every navigation through the shell rail and the phone bottom bar a
client-side navigation that can render the destination's pending state — then restore, deliberately,
the announcement the removed document load was making for free, and correct every sentence in the
repository whose premise the change deletes.

## Scope

The spec's three phases, on this one PR.

**Phase 1 — the provider and the reconciliation**

- `src/components/app/shell/aria-router.tsx` (new) + its export from `shell/index.ts`, and
  `src/components/app/shell/__tests__/aria-router.test.tsx` (new).
- Mount points: `src/components/app/shell/app-shell.tsx` (`AppShell`, `AppShellFallback`) and
  `src/routes/(auth)/route.tsx` (`AuthFrame`).
- `e2e/navigation.spec.ts` (new): no `document` request on a rail click, the pending state reachable
  from the rail, scroll restored, focus retained.
- `src/components/ui/link.tsx`: a `widget` pairing on `linkVariants`, plus
  `src/components/ui/__tests__/link.test.tsx` (new — the file the spec assumed exists does not).
- `src/components/app/dashboard/widget-link.tsx` deleted, its two exports removed from
  `dashboard/index.ts`, and its six call sites in `accounts-widget.tsx`,
  `recent-transactions-widget.tsx` and `first-run-panel.tsx` migrated to the design-system `Link`.
- Docblock corrections: `src/components/ui/link.tsx`, `src/components/app/nav/destinations.ts`,
  `src/routes/_app/import/-lib/link-style.ts`.

**Phase 2 — the route announcer**

- `src/components/app/shell/route-announcer.tsx` (new), its test, its export, and one mount in
  `AppShell` beside `ToastHost`.

**Phase 3 — the measurements and the docblocks**

- `docs/STATE-INVENTORY.md` §3 re-measured against the branch.
- `e2e/support/states.ts` preconditions re-verified against a rail navigation;
  `e2e/states.spec.ts`'s header corrected; a case added to
  `e2e/support/__tests__/states.test.ts`.
- Spec lifecycle bookkeeping owned by `om-auto-implement-spec`: the spec's `Status` /
  `Implementation` rows and the generated `.ai/specs/README.md`.

## Non-goals

- Augmenting React Aria's `RouterConfig` so `href` is typed against the route tree (spec Q6).
- Folding away `src/routes/_app/import/-lib/link-style.ts` (spec Q4) — only its premise sentence is
  corrected; its typed `params`/`search` reason is untouched.
- Mounting either React Aria provider on `src/routes/invite.$invitationId.tsx`. That route mounts
  no `AriaI18nProvider` either; the spec records the gap and does not fix it.
- A new ADR (spec Q7), a new dependency (`docs/SPEC.md` §3 freeze), a schema change, a server
  change, or a new message key in either locale.
- `_app.beforeLoad`'s round trip (#230, ADR 0018) — independent and explicitly out of scope.

## Risks

- **Primary navigation for every authenticated screen.** `risk-high` on the issue is about the
  category, not the diff size. The blast radius is enumerated in the spec's §Architecture: 9 call
  sites in 7 files, 6 of which change behaviour. Each is asserted or explicitly reasoned about
  rather than accepted as an untested side effect.
- **The accessibility trade is the real one.** Phase 1 alone would swap a measured pending-state
  defect for an unannounced navigation. Phase 2 is therefore not optional and ships on this PR.
- **The widget link's appearance must survive the move** from `widget-link.tsx` into `linkVariants`.
  ADR 0016 blind pair over `/dashboard`, light and dark, 360 and 1280, against `origin/develop`.
- **`holdServerFns`'s precondition** ("the first `/_serverFn/*` request is the shell's") is
  re-verified against a rail navigation from a request log, not re-argued (Phase 3).
- **A gate nobody watched fail is not trusted** (skill `verifying-changes`). Step 1.3 is a
  watched-red step: the rail pending-state case must fail on `origin/develop` and pass on the
  branch, and that output goes in the PR body.

## Implementation Plan

### Phase 1 — the provider and the reconciliation

- **1.1 Add `AriaRouterProvider`.** `src/components/app/shell/aria-router.tsx` reads TanStack Router
  through `useRouter()` and hands React Aria a `navigate` built on `router.navigate({ href })`;
  `useHref` and the `routerOptions` parameter are deliberately absent and the docblock says why.
  Exported from `shell/index.ts`. _Verification:_
  `src/components/app/shell/__tests__/aria-router.test.tsx` — a `ui` `Link` inside the provider
  navigates (`navigate` called with `{ href: '/accounts' }`, `defaultPrevented` true); the same link
  outside it does not. `pnpm exec vitest run --project=ui src/components/app/shell/__tests__/aria-router.test.tsx`.
- **1.2 Mount it** inside `AriaI18nProvider` in `AppShell`, `AppShellFallback` and the `(auth)`
  frame. _Verification:_ `pnpm exec vitest run --project=ui src/components/app/shell`; a case in the
  new `e2e/navigation.spec.ts` asserting a rail click produces no `document` request and that the
  URL and the `h1` both reach the destination.
- **1.3 Assert the pending state is reachable from the rail.** Extend `e2e/navigation.spec.ts` with
  `holdServerFns`: navigate `/dashboard` → `/accounts` through the rail with the hold installed and
  assert `main` holds a `role="status"` region and skeleton bars while the previous screen's content
  is gone. _Verification:_ the case fails on `origin/develop` and passes on the branch — watched,
  with both outputs read.
- **1.4 Assert scroll and focus survive.** In the same file: scroll `/transactions`, navigate away
  through the rail and back, assert the offset is restored; assert `document.activeElement` after a
  rail click is still the rail row and carries `aria-current="page"`. _Verification:_
  `pnpm exec playwright test e2e/navigation.spec.ts` in the `chromium` and `mobile-safari` projects —
  the second exercises `bottom-nav.tsx`.
- **1.5 Add the `widget` pairing to `linkVariants`**, reproducing `widget-link.tsx`'s classes.
  _Verification:_ `src/components/ui/__tests__/link.test.tsx` (new) covers the pairing and the
  disabled-link contract; `pnpm exec vitest run --project=ui src/components/ui/__tests__/link.test.tsx`.
- **1.6 Delete `widget-link.tsx`** and its two exports, and migrate its six call sites to the
  design-system `Link`; `first-run-panel.tsx`'s `to?: WidgetLinkProps['to']` becomes
  `href?: string`. _Verification:_ `pnpm typecheck`, `pnpm lint`, `pnpm test`, and a
  `scripts/visual/capture.mjs` blind pair of `/dashboard` against `origin/develop`.
- **1.7 Correct the docblocks whose premise this phase removes:** `src/components/ui/link.tsx`
  (the claim is now true and names where the provider is mounted),
  `src/components/app/nav/destinations.ts`, and `src/routes/_app/import/-lib/link-style.ts` (the
  file stays; the "no provider is mounted" sentence is replaced by the typed-`params`/`search`
  reason that actually keeps it alive). _Verification:_ `pnpm lint` and a read.

### Phase 2 — the route announcer

- **2.1 Add `route-announcer.tsx`.** A visually-hidden `role="status"` `aria-live="polite"` region
  that writes `document.title` into itself on each committed navigation via `useRouterState`, and
  renders nothing on the first paint. _Verification:_
  `src/components/app/shell/__tests__/route-announcer.test.tsx` — empty on mount, holds the new
  title after a simulated navigation, is a `status` and not an `alert`.
- **2.2 Mount it once in `AppShell`** beside `ToastHost`. _Verification:_ a case in
  `e2e/navigation.spec.ts` asserting the region's text equals `document.title` after a rail click,
  and an axe scan of the shell with the region populated.

### Phase 3 — the measurements and the docblocks

- **3.1 Re-measure `docs/STATE-INVENTORY.md` §3** against the branch: the request log for a rail
  navigation and the `role="status"` / skeleton-bar counts at the section's own sample points.
  The old numbers stay as the "before" they were, and the section names this PR.
  _Verification:_ every number comes from a command whose output was read (`docs/SPEC.md` §7.7).
- **3.2 Re-verify `e2e/support/states.ts`'s preconditions** against a rail navigation from a
  request log; correct `e2e/states.spec.ts`'s header, which tells the reader the rail cannot be
  used for a loading-state case; add a case to `e2e/support/__tests__/states.test.ts` for the new
  call pattern. _Verification:_
  `pnpm exec vitest run --project=tooling e2e/support/__tests__/states.test.ts`, then `pnpm e2e`.
- **3.3 Spec lifecycle bookkeeping and the full gate.** Set the spec's `Status` and
  `Implementation` rows, regenerate `.ai/specs/README.md`, then run every command in
  `AGENTS.md` → Validation Commands in order, plus `pnpm e2e`. _Verification:_ every command green,
  with the output read rather than assumed.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: the provider and the reconciliation

- [x] 1.1 Add `AriaRouterProvider` — 5d5df9d
- [x] 1.2 Mount it in `AppShell`, `AppShellFallback` and the `(auth)` frame — a81aeb6
- [x] 1.3 Assert the pending state is reachable from the rail — eb39fc2
- [x] 1.4 Assert scroll and focus survive — eb39fc2
- [x] 1.5 Add the `widget` pairing to `linkVariants` — 90ca042
- [x] 1.6 Delete `widget-link.tsx` and migrate its call sites — 1b6637f
- [x] 1.7 Correct the docblocks whose premise this phase removes — 76fd373

### Phase 2: the route announcer

- [x] 2.1 Add `route-announcer.tsx` — 0d1795a
- [x] 2.2 Mount it once in `AppShell` — 5bd162e

### Phase 3: the measurements and the docblocks

- [ ] 3.1 Re-measure `docs/STATE-INVENTORY.md` §3
- [ ] 3.2 Re-verify `e2e/support/states.ts`'s preconditions
- [ ] 3.3 Spec lifecycle bookkeeping and the full gate
