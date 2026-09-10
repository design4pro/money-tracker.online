# Execution plan — designed empty, loading and error states

`Source doc:` `.ai/specs/2026-09-09-designed-empty-loading-error-states.md`
`Issue:` #21
`Spec PR:` #135 (merged 2026-09-09)
`Engine:` om-auto-create-pr (steps: 18, --loop: no)

## Goal

Give every list and detail surface a designed empty, loading and error state that a test and a
capture run can reach deliberately, and commit the inventory that says which surfaces already had
them.

## Scope

The spec's four Phases, all on this one PR (the run's operator chose one implementation PR over the
spec's per-Phase PRs; recorded here because the spec's Phasing section says otherwise):

1. The inventory document, its link from the design-system plan, and the `ErrorPanel` ownership
   follow-up issue.
2. Router pending thresholds, so the nineteen already-declared skeletons actually render.
3. The seven route modules that declare no loading state, plus the not-found/error split on
   `/transactions/$transactionId`.
4. The empty fixture workspace, the interception helper, `e2e/states.spec.ts` with its axe scans,
   the `capture.mjs` flag, and the captured frames.

## Non-goals

- Moving `ErrorPanel` out of `src/components/app/accounts/` — 37 importers, filed as its own issue
  in Phase 1 step 1.3 and deliberately not done here (spec Q1).
- Mounting a React Aria `RouterProvider` so the shell rail navigates client-side — spec Q2 resolved
  to option (a), configuration, and scopes the architectural half out to its own ADR.
- Changing the skeleton-versus-spinner house style — spec Q4 measured it as already consistent, so
  the rule is written down and no code moves for it.
- Any schema, server function, SQL or money path. `pnpm db:generate` is a no-op for this run.

## Risks

- **Setting `defaultPendingMs` changes every surface.** Nineteen skeletons that never rendered start
  rendering. That is the intended effect and the largest behavioural change here, so it lands in its
  own step with its own frames.
- **A deliberate `500` trips the console policy.** `e2e/support/console-policy.ts` treats a 500 as
  fatal by construction. Phase 3 step 3.1 settles how the error cases opt out, narrowly and with the
  justification recorded in the policy file, before any error case is written.
- **`retry: 1` doubles every failure**, so an interception handler must be idempotent, and
  `unroute` while a handler is suspended throws `Route is already handled!` — release first.
- **A mis-shaped skeleton makes the page jump** when content lands, which is worse than the hold it
  replaced. Each skeleton is drawn from the layout of the screen it fronts.
- **`e2e/support/states.ts` imports Playwright**, which breaks the premise `vitest.config.ts` states
  for keeping `e2e/support/__tests__/*.test.ts` in the node project. Settled in Phase 4 step 4.2.

## Implementation Plan

### Phase 1 — Inventory

- **1.1 Write `docs/STATE-INVENTORY.md`.** The read table with a file path per row, the three
  measurements with the commands that produced them, and the skeleton-versus-spinner rule. State the
  method so the next reader can re-run it. _Verification:_ each row names the file it was read from;
  `pnpm check` clean on the file.
- **1.2 Link it from `docs/plans/01-design-system.md`**, beside that plan's note that the component
  gallery has no async surface. _Verification:_ `pnpm lint`; the link resolves.
- **1.3 File the `ErrorPanel` ownership issue** — move to `src/components/app/shell/`, 37 importers,
  `docs/SPEC.md` §8 as the rationale, no behaviour change. _Verification:_ the issue exists and is
  linked from the inventory.

### Phase 2 — Pending thresholds

- **2.1 Set `defaultPendingMs` and `defaultPendingMinMs` on `src/router.tsx`**, with a docblock
  giving the numbers and the reason, in the register the file's existing comments use.
  _Verification:_ the Phase 4 e2e case holding `/_serverFn/*` on a client-side navigation asserts a
  `role="status"` region appears within the threshold and that `h1` is no longer the previous
  route's.

  > **Corrected while executing.** The step title is kept for the Progress parser, but the premise
  > under it was wrong and the commit does something else. `@tanstack/router-core@1.171.27` already
  > applies `defaultPendingMs: 1000` and `defaultPendingMinMs: 500` before it spreads the caller's
  > options (`dist/esm/router.js:620`), so restating them changes nothing. What was actually missing
  > is a default pending **component**: without one, `load-client.js:666` has nothing to show and the
  > previous screen simply stays. The commit therefore sets `defaultPendingComponent: RoutePending`
  > and lowers `defaultPendingMs` to 300, leaving `defaultPendingMinMs` at its framework default.
  > The before/after measurement is in `docs/STATE-INVENTORY.md` §3.

- **2.2 Re-photograph `/accounts`, `/budgets` and `/goals`** in the loading state to confirm the
  nineteen declared skeletons now render and the layout does not jump. _Verification:_ frames in
  `.ai/qa/artifacts_*/`, read by a human; no console output outside policy.

### Phase 3 — Close the seven bare surfaces

- **3.1 Settle the console-policy question first.** Decide how a deliberate `500` is tolerated,
  record it in `e2e/support/console-policy.ts` with its justification, or decide the error half is
  asserted outside the browser run. _Verification:_
  `e2e/support/__tests__/console-policy.test.ts` covers the new case.
- **3.2 `/import`** — `ImportPageSkeleton` in `src/routes/_app/import/-ui/` (two source cards, a
  history table, one `role="status"` carrying `import.list.loading`) as `pendingComponent`, plus an
  `errorComponent` rendering `ErrorPanel` with `import.load.error.{title,body}` and a `reset` retry.
  Keys in EN + PL. _Verification:_ route-local, so the browser run; the i18n parity test covers the
  keys.
- **3.3 `/import/$batchId`** — the same, batch-shaped, with `import.detail.{loading,error.*}`. The
  existing in-component `FileUnavailable` probe state is not touched. _Verification:_ as 3.2.
- **3.4 `/invite/$invitationId`** — an invitation-card skeleton as `pendingComponent` with
  `invite.loading`. The existing `InvitationMissing` error component is not touched. _Verification:_
  as 3.2.
- **3.5 `/payees/$payeeId`** — a detail skeleton beside the list one in
  `src/components/app/payees/payee-states.tsx`, wired as `pendingComponent` with
  `payees.detail.loading`. _Verification:_ a Vitest render in
  `src/components/app/payees/__tests__/` asserting one `status` region and one announced sentence.
- **3.6 `/transactions/rules`, `/transactions/rules/$ruleId`, `/transactions/rules/new`** —
  `RulesListSkeleton` and `RuleEditorSkeleton` in `src/components/app/transactions/`, wired as
  `pendingComponent` on all three, with `rules.list.loading` and `rules.editor.loading`; plus an
  `errorComponent` on `new` with `rules.editor.error.{title,body}`. _Verification:_ a Vitest render
  in `src/components/app/transactions/__tests__/`.
- **3.7 Split not-found from error on `/transactions/$transactionId`.** The `detailQuery.isError`
  branch renders `ErrorPanel` with `transactions.detail.error.*` and a `refetch` retry; the
  not-found copy is reached only through the router's not-found path. _Verification:_ a Phase 4 e2e
  case under `failServerFns` asserts the retry is present and the not-found copy is not;
  `e2e/not-found.spec.ts` passes unchanged.

### Phase 4 — Reachability, coverage and evidence

- **4.1 Add the empty fixture workspace.** An `EMPTY` credential in `e2e/support/session.ts` with
  the read-only contract in its docblock, `storageStateFor('empty')`, and its sign-in inside the
  existing serial `fixture workspaces` step, tolerating a `429` as a retry. _Verification:_
  `pnpm exec playwright test --project=setup` mints `e2e/.auth/empty.json` cold and warm.
- **4.2 Write `e2e/support/states.ts`** — `holdServerFns(page)` and `failServerFns(page)` over
  `**/_serverFn/**`, each returning a disposable, each idempotent under `retry: 1`, releasing before
  unrouting. Settle the Playwright-import question here. _Verification:_ whichever the settled
  answer allows — a stubbed unit test, or the browser run alone with the gap stated.
- **4.3 Write `e2e/states.spec.ts`.** Per surface: the empty state under the empty workspace; the
  loading state under `holdServerFns` reached by a client-side navigation; the error state under
  `failServerFns` with the retry exercised after the interception is removed. Assert the workspace
  reads zero rows before asserting any screen, and exactly one `role="status"` per loading region.
  _Verification:_ `pnpm e2e` green locally and in CI, under the policy settled in 3.1.
- **4.4 Axe-scan the empty states** in the same spec, with the WCAG A/AA tag set and
  `withoutKnownAxeDefects`, matching `e2e/accessibility.spec.ts`. Scope the matrix explicitly and
  say why. _Verification:_ zero violations at the A/AA tags on every empty surface across the stated
  matrix.
- **4.5 Add `--force-state <loading|error>` to `scripts/visual/capture.mjs`.** It navigates to an
  origin route, installs the interception, then drives a client-side navigation to the target —
  `page.goto` produces no `/_serverFn/*` request, as measured. Composes with `--state`.
  _Verification:_ two runs against a local dev server produce `loading-*` and `error-*` frames whose
  reported landed URL is the requested one, written outside the repository.
- **4.6 Capture the evidence.** Every state, light and dark, 360px and 1280px, into
  `.ai/qa/artifacts_*/` — never into the repository — attached to this PR. _Verification:_ a human
  reads the frames; `git status` clean of PNGs.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Inventory

- [x] 1.1 Write `docs/STATE-INVENTORY.md` — d534169
- [x] 1.2 Link the inventory from `docs/plans/01-design-system.md` — d534169
- [x] 1.3 File the `ErrorPanel` ownership issue — #208

### Phase 2: Pending thresholds

- [x] 2.1 Set `defaultPendingMs` and `defaultPendingMinMs` on `src/router.tsx` — 7f3ddbb
- [ ] 2.2 Re-photograph `/accounts`, `/budgets` and `/goals` loading

### Phase 3: Close the seven bare surfaces

- [x] 3.1 Settle the console-policy question for a deliberate 500 — 0e658aa
- [x] 3.2 `/import` pending and error components — 5353c20
- [x] 3.3 `/import/$batchId` pending and error components — fdff08a
- [x] 3.4 `/invite/$invitationId` pending component — f1f8ca8
- [x] 3.5 `/payees/$payeeId` pending component — c78022f, 3f8e31b
- [x] 3.6 `/transactions/rules`, `$ruleId` and `new` pending and error components — 03dfd26
- [x] 3.7 Split not-found from error on `/transactions/$transactionId` — d61f821

### Phase 4: Reachability, coverage and evidence

- [x] 4.1 Add the empty fixture workspace — e15dbea
- [x] 4.2 Write `e2e/support/states.ts` — d73e93e
- [x] 4.3 Write `e2e/states.spec.ts` — e5915f2
- [ ] 4.4 Axe-scan the empty states
- [ ] 4.5 Add `--force-state` to `scripts/visual/capture.mjs`
- [ ] 4.6 Capture the evidence
