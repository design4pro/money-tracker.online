# The design-system link navigates through the router

| Field              | Value |
| ------------------ | ----- |
| **Status**         | draft |
| **Issue**          | #245  |
| **Spec PR**        | #253  |
| **Implementation** | none  |

## 📝 TLDR

`src/components/ui/link.tsx` wraps React Aria's `Link`, which hands a click to the router supplied
by React Aria's `RouterProvider` — and no `RouterProvider` is mounted anywhere in this application.
Every link the design system draws is therefore a plain anchor and a full document load, including
the shell rail and the phone bottom bar, which is why `docs/STATE-INVENTORY.md` §3 records that the
product's primary navigation renders no route's pending state at all. This spec mounts one provider
beside the one already mounted for React Aria's locale, wired to `router.navigate({ href })`, and
reconciles the two workarounds the absence spawned. Nine call sites are touched and six of them
change behaviour, not the twenty-six an earlier estimate named; the set is enumerated and measured
in §Architecture. No new dependency, no schema change, no server change, no new message key.

## 📝 Problem Statement

### 1. The mechanism, from the installed library rather than from memory

React Aria's link machinery lives in `react-aria@3.52.0`, `dist/private/utils/openLink.mjs`. Its
router context defaults to:

```js
const RouterContext = createContext({
  isNative: true,
  open: openSyntheticLink,
  useHref: (href) => href,
})
```

and every link click runs through `handleLinkClick`, whose first condition is `!router.isNative`.
With no `RouterProvider` above it, `isNative` stays `true`, the handler returns without calling
`preventDefault`, and the browser follows the `<a href>` — a document request. `RouterProvider` is
the only thing in the library that sets `isNative: false`.

A full-repository grep confirms the absence: every `RouterProvider` occurrence under `src/` is
either a docblock describing that it is missing, or TanStack Router's unrelated same-named export
inside a test harness.

### 2. It was measured, and the measurement is in the repository

`docs/STATE-INVENTORY.md` §3, "The data endpoint is `/_serverFn/*`, and only a client-side
navigation produces one":

> Navigating through the shell rail produces exactly two requests, both `document`: `GET /accounts`
> and `GET /accounts?status=active`. No data fetch at all — the loaders run server-side during SSR.
> Navigating through the dashboard's `WidgetLink` instead produces `GET /_serverFn/<base64>` fetches
> and no document request.

and its conclusion:

> So the product's primary navigation is a document reload, and no route's `pendingComponent` can
> render on it.

Everything #21 shipped — the seven per-route pending shapes, the `defaultPendingComponent` at
`src/router.tsx`, the 300 ms threshold argued there — is unreachable from the rail. The rail is how
a reader moves through the product.

### 3. The absence has already been paid for twice, in workarounds

Two modules exist only because of it, and both say so in their own docblocks.

- `src/components/app/dashboard/widget-link.tsx` wraps TanStack Router's `Link` rather than the
  design system's, "and no `RouterProvider` is mounted in this app yet, so a `ui` link would do a
  full document load and lose the scroll position and the focus. When that provider lands, this
  file is the one place that has to change."
- `src/routes/_app/import/-lib/link-style.ts` is a bare class string for the import stepper's
  links, for the same stated reason plus a second one: the stepper's back and forward **are**
  links, and a document load between two steps drops the parsed file the browser is holding.

A third module documents the cost without working around it:
`src/components/app/nav/destinations.ts` explains that `href` is a plain string because "no
provider is mounted in the app yet… When it is, these become typed links."

And `src/components/ui/link.tsx`'s own docblock is currently **false**. It says the primitive
"routes through the app-level `RouterProvider`, which is what lets a client-side navigation keep
the focus and announcement behaviour of a document load." There is no such provider; the sentence
describes an intention.

### 4. What the reader gets today

Every move through the rail or the bottom bar is a document load. The tab reloads: the scroll
position of the screen being left is discarded, focus is reset to the start of the document, the
JavaScript bundle re-evaluates, the query cache is thrown away, and — because the loaders run during
SSR — nothing on screen ever enters a pending state. `e2e/states.spec.ts` cannot use the rail to
photograph a loading state and says so in its header docblock (lines 41-44); `e2e/support/states.ts`
is built around the same asymmetry.

## 📝 Proposed Solution

**Mount the provider the primitive was written for, in the two places React Aria is already given
its context, and delete the workaround whose stated reason expires.**

A new `src/components/app/shell/aria-router.tsx` exports `AriaRouterProvider`: a component that
reads TanStack Router through `useRouter()` and hands React Aria a `navigate` callback built on
`router.navigate({ href })`. `NavigateOptions.href` is TanStack Router's own documented entry for a
fully built href (`@tanstack/router-core@1.171.27`, `dist/esm/link.d.ts`), which is exactly the
shape React Aria passes.

It is mounted where `AriaI18nProvider` is mounted and nowhere else — `AppShell`,
`AppShellFallback` (`src/components/app/shell/app-shell.tsx`) and the auth frame
(`src/routes/(auth)/route.tsx`) — for the reason `src/components/app/shell/aria-i18n.tsx` gives at
length: the document shell in `__root.tsx` also renders the marketing page, which ships no React
Aria primitive, and an import there puts the library into the chunk every first-time visitor
downloads.

### Alternatives considered

| Option                                                            | Why it lost                                                                                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount it in `__root.tsx`, one place for the whole document        | Puts `react-aria-components` in the marketing entry chunk. `aria-i18n.tsx` already rejected this and the rejection has not changed.                                                                                       |
| Fold the provider into `AriaI18nProvider`                         | Two unrelated concerns in one component; the locale provider is mounted for primitives that never link, and a reader looking for the routing decision would not find it under a file named for i18n.                      |
| Convert the rail to TanStack Router's `Link`, as `WidgetLink` did | Spreads the workaround instead of removing it, keeps `components/ui`'s `Link` permanently broken for every other consumer, and leaves `link.tsx`'s docblock false.                                                        |
| Wrap `ui`'s `Link` with TanStack's `createLink` for typed `to`    | A second link abstraction over the one being fixed, and it does not help the rail: `destinations.ts` already stores plain string hrefs. Recorded in §Resolved assumptions as deliberately deferred, not rejected forever. |

## 📝 Architecture

### Owner module

`src/components/app/shell/aria-router.tsx` owns "how a React Aria link reaches TanStack Router",
and is the only module in the repository that may construct a React Aria `RouterProvider`
(`docs/SPEC.md` §8 — one owner per concept). `src/components/ui/link.tsx` stays the consumer and
learns nothing: it gains a `widget` pairing on `linkVariants` (Step 5) and a corrected docblock
(Step 7), but no new import and no knowledge that a router exists — `components/ui` must not import
from `src/routes`.

### The wiring, in full

```tsx
// src/components/app/shell/aria-router.tsx
import { RouterProvider } from 'react-aria-components'
import { useRouter } from '@tanstack/react-router'

export function AriaRouterProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const navigate = useCallback(
    (href: string) => {
      void router.navigate({ href })
    },
    [router],
  )
  return <RouterProvider navigate={navigate}>{children}</RouterProvider>
}
```

`useHref` is deliberately **not** passed. React Aria defaults it to the identity function, and this
application is served from the origin root with no base path, so an identity `useHref` is correct
rather than merely adequate.

The callback's second parameter is deliberately absent for the same kind of reason. React Aria types
it `navigate: (path: Href, routerOptions: RouterOptions | undefined) => void`
(`dist/types/src/utils/openLink.d.ts`), but `RouterOptions` is derived from `RouterConfig`, which is
`interface RouterConfig {}` in `@react-types/shared@3.36.1` and is augmented nowhere in this
repository. No call site can therefore pass one, and forwarding an always-`undefined` argument into
`router.navigate` would only invite a reader to wonder what it carries. Augmenting `RouterConfig` is
the same decision §Resolved assumptions records as Q6 and defers with it.

### What the provider does not capture — from the library, not from assumption

`shouldClientNavigate` in `openLink.mjs` is the gate every click passes before `navigate` is
called:

```js
return (
  (!target || target === '_self') &&
  link.origin === location.origin &&
  !link.hasAttribute('download') &&
  !modifiers.metaKey &&
  !modifiers.ctrlKey &&
  !modifiers.altKey &&
  !modifiers.shiftKey
)
```

So a `target="_blank"` link, a cross-origin link, a download and every modifier-click keep the
browser's own behaviour with no code on this side. That is what makes the change safe for the one
non-route link in the set.

### The blast radius, enumerated

The issue's own preparation comment estimated "roughly 26 files". That number came from counting
files that import anything from `#/components/ui` and contain the substring `Link`, which catches
`WidgetLink`, `NavLink`, `ExternalLink` and `Link2Off`. The measured set — files importing `Link`
from `#/components/ui` — is **7 files and 9 call sites**, six of which change behaviour:

| Call site                                                  | Target                        | After the change                                     |
| ---------------------------------------------------------- | ----------------------------- | ---------------------------------------------------- |
| `src/components/app/nav/nav-link.tsx:39`                   | `destination.href` (9 routes) | Client-side. **This is the issue.**                  |
| `src/components/app/nav/bottom-nav.tsx:88`                 | `/transactions/new`           | Client-side.                                         |
| `src/components/app/nav/bottom-nav.tsx:104`                | `destination.href`            | Client-side. The phone bar has the identical defect. |
| `src/routes/_app/settings/index.tsx:288` (`RecordLink`)    | settings sub-routes           | Client-side.                                         |
| `src/routes/_app/settings/members.tsx:166`                 | `/settings/billing`           | Client-side.                                         |
| `src/routes/_app/payees/$payeeId.tsx:87` (`BackLink`)      | `/payees`                     | Client-side.                                         |
| `src/routes/_app/transactions/-ui/attachment-list.tsx:177` | `/api/files/$id`, `_blank`    | **Unchanged** — `shouldClientNavigate` rejects it.   |
| `src/routes/invite.$invitationId.tsx:115` and `:135`       | `/dashboard`                  | **Unchanged** — see below.                           |

Eight rows, nine call sites: the invite route's two links share a row because they are the same
link rendered in two branches. The `(auth)` screens use `linkVariants` on TanStack Router's `Link`
rather than the primitive, so they are styling consumers only and nothing about them changes.

`src/routes/invite.$invitationId.tsx` sits outside `_app` and mounts no React Aria provider at all —
not this one and not `AriaI18nProvider`, which is a pre-existing gap this spec notes and does not
fix. Its two links keep their document load, which is defensible on its own terms: they cross from
an ungarded route into the guarded shell, where a fresh document is what resolves the session and
the workspace anyway.

### The two workarounds, reconciled differently

They are not the same case, and the honest answer is not the same for both.

**`widget-link.tsx` is deleted.** Its docblock states one reason for existing and this spec removes
it. Its six call sites (`accounts-widget.tsx` ×2, `recent-transactions-widget.tsx` ×2,
`first-run-panel.tsx` ×2) all pass a literal path with no `params` and no `search`, so `to="/accounts"`
becomes `href="/accounts"` with no loss. The styling it carried — `text-caption font-medium`, the
brand underline, `target-min` — moves into the design system as a `widget` size/variant pairing on
`linkVariants`, so the look survives the deletion in one place rather than six. `first-run-panel.tsx`'s
`readonly to?: WidgetLinkProps['to']` becomes a plain `string` href.

**`link-style.ts` stays, and its docblock is corrected.** Its first stated reason expires with this
change; its second does not, and its second is the stronger one — the import stepper's links carry
typed `params` and `search`, and `createLink` is what preserves those. A class string beside
TanStack's typed `Link` is still the right shape there. What changes is the premise sentence, which
currently asserts that no provider is mounted.

## 📝 Data Model

None. No table, no column, no migration, no stored row.

## 📝 API Contracts

None. No server function, no API route, no Zod schema, no queue job. This change is entirely inside
the browser's navigation path; the server sees _fewer_ requests afterwards, not different ones.

## 📝 UI/UX

### The three things a document load was doing for free

A document load is a blunt instrument that happens to satisfy three requirements at once. Replacing
it means satisfying each one deliberately.

1. **Scroll.** `src/router.tsx` already sets `scrollRestoration: true`, so TanStack Router restores
   the scroll offset per history entry on a client-side navigation. Nothing to add; something to
   assert.
2. **Focus.** Today a reload dumps focus at the start of the document, which is a poor outcome that
   is at least predictable. After the change, focus stays on the rail row that was activated — which
   is what `aria-current="page"` then describes, and which lets a keyboard reader carry on down the
   rail. This is the better behaviour and it is what the acceptance criterion "focus survives a rail
   navigation" asks for.
3. **Announcement.** This is the one the change would otherwise take away, and the reason it gets
   its own phase. On a document load the browser announces the new page to a screen reader; on a
   client-side navigation nothing does. `pageHead` (`src/routes/-lib/page-title.ts`) keeps setting
   `document.title` correctly on both — WCAG 2.2 §2.4.2 Page Titled is not at risk — but a title
   that changes silently is announced to nobody. A reader who presses Enter on "Budgets" would hear
   nothing until they went looking.

   Phase 2 adds `src/components/app/shell/route-announcer.tsx`: a visually-hidden `role="status"`
   region, mounted once in `AppShell`, that writes `document.title` into itself after each committed
   navigation. It reuses the title the route already computes, in the locale already negotiated, so
   it introduces no message key and cannot drift from the tab. It is not an `aria-live="assertive"`
   region: arriving where you asked to arrive is not an alert.

   `RoutePending`'s existing `role="status"` covers the _waiting_, and only past the 300 ms
   threshold. The announcer covers the _arrival_, at every speed. They are complementary and both
   polite, so a slow navigation announces "loading" and then the destination, in that order.

### Visual change expected

Nothing is redrawn. No token, no spacing value, no component shape, no copy on screen changes in any
theme or at any width. What changes is **which frames appear between two screens**:

| Route / state                                                 | Light | Dark | 360 px | 1280 px | What is new                                                                                          |
| ------------------------------------------------------------- | ----- | ---- | ------ | ------- | ---------------------------------------------------------------------------------------------------- |
| Any rail destination, mid-navigation (desktop rail, ≥1024 px) | ✅    | ✅   | n/a    | ✅      | The destination's `pendingComponent` — a skeleton — now renders. Today: the previous screen, frozen. |
| Any bottom-bar destination, mid-navigation (<1024 px)         | ✅    | ✅   | ✅     | n/a     | Same, on the phone bar.                                                                              |
| `/settings` → a settings sub-route                            | ✅    | ✅   | ✅     | ✅      | Same, via `RecordLink`.                                                                              |
| `/payees/$payeeId` → `/payees` (back link)                    | ✅    | ✅   | ✅     | ✅      | Same, and the list's scroll offset is restored rather than reset.                                    |
| `/dashboard` widget links                                     | ✅    | ✅   | ✅     | ✅      | Identical to today — they were already client-side; only the component drawing them changes.         |

The one pixel-level risk is the widget link's appearance surviving the move from `widget-link.tsx`
to `linkVariants`. That is what Phase 1's visual capture of `/dashboard` exists to check
(ADR 0016, `scripts/visual/capture.mjs`).

### Copy

None. No new user-facing string in either locale. The route announcer deliberately reuses the
`document.title` that `pageHead` already builds from the existing catalogue keys, which is the
reason it needs no key of its own and cannot drift out of parity with `pl.ts`.

## 📝 Edge Cases & Failure Scenarios

| Case                                                      | Behaviour                                                                                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Middle-click, ⌘-click, Ctrl-click on a rail row           | `shouldClientNavigate` returns `false` on any modifier; the browser opens a new tab exactly as today.                                                                 |
| The attachment link (`/api/files/$id`, `target="_blank"`) | Rejected by the same gate on the `target` check. The R2 download is untouched.                                                                                        |
| A rail click while a navigation is already in flight      | TanStack Router's own concern; the second navigation supersedes the first. Unchanged from today's dashboard-widget behaviour, which is already client-side.           |
| `router.navigate` rejects (a blocker, an unmatched href)  | The promise is explicitly voided and the router stays where it is. An href that matches no route lands on the root's `notFoundComponent`, as a typed link would.      |
| JavaScript has not hydrated yet                           | The rendered element is still a real `<a href>`. A click before hydration is a document load — the behaviour the product has today — so the rail never becomes inert. |
| SSR                                                       | `useRouter()` is available during SSR and `navigate` is never called there. The provider renders its children and nothing else.                                       |
| A reader on `prefers-reduced-motion`                      | Unaffected: this introduces no transition. The skeletons that now become reachable already honour it.                                                                 |

## 📝 Risks & Impact Review

**Blast radius: 9 call sites in 7 files, of which 6 change behaviour.** Enumerated in
§Architecture rather than estimated. The label `risk-high` on the issue is about the _category_ —
primary navigation for every authenticated screen — rather than about the size of the diff, and it
should stay.

**`BACKWARD_COMPATIBILITY.md`:** no protected surface is touched. No URL and no route path changes;
every href in the product resolves to the same page before and after. The "Public URLs" row is not
at risk, only the mechanism by which an existing href is followed.

**The real risk is the accessibility one, and it is why Phase 2 is not optional.** Landing Phase 1
alone would trade a measured pending-state defect for an unannounced navigation, which is a worse
bargain for the reader it affects most. The phases are separately shippable but must ship together
in the same release; `docs/ACCESSIBILITY.md` §5.2's criterion-specific assertions are the place a
regression here would surface, and the announcer's Playwright case is what keeps it honest.

**Rollback.** One import and one JSX wrapper per mount point. Removing `AriaRouterProvider` from
`app-shell.tsx` and `(auth)/route.tsx` restores today's behaviour exactly, because the primitive
falls back to the native context on its own. The `widget-link.tsx` deletion is the only part with a
non-trivial revert, which is why it is a separate Step and not folded into the mount.

**Documentation that becomes false on merge**, each named so none is missed:
`docs/STATE-INVENTORY.md` §3 (a measurement, re-measured in Phase 3),
`src/components/app/dashboard/widget-link.tsx` (deleted),
`src/routes/_app/import/-lib/link-style.ts` (premise corrected),
`src/components/app/nav/destinations.ts` (the "when it is, these become typed links" paragraph),
`e2e/states.spec.ts` header lines 41-44,
`e2e/support/states.ts` (`serverFnIdOf` and `holdServerFns` — see Phase 3),
and `src/components/ui/link.tsx`, whose docblock becomes true for the first time.

**The `holdServerFns` precondition needs re-checking, not rewriting.** Its rule is "the first
`/_serverFn/*` request on a client-side navigation is the shell's", justified by TanStack's ordering
guarantee that no loader beneath `_app` starts until `_app.beforeLoad` resolves. That guarantee is a
property of the router, not of which component drew the link, so the rule survives a rail navigation
becoming client-side. Phase 3 verifies it against a rail navigation rather than assuming it, and
`e2e/support/__tests__/states.test.ts` gets a case for the new call pattern.

**Interaction with #230 / `.ai/specs/2026-09-11-first-navigation-loading-state.md`.** Independent and
complementary. That spec makes the _first_ client-side navigation in a tab draw its loading state by
priming the query cache; this one makes the rail produce client-side navigations at all. Neither
blocks the other, and landing this one first makes that one's benefit apply to the rail too. Neither
changes `_app.beforeLoad`, which ADR 0018 keeps blocking.

## 📝 Resolved assumptions (autonomous defaults)

This spec was written unattended. Each row is a decision a human may overturn before the spec PR
merges.

| #   | Question                                                                                          | Applied default                                                                                                        | Why                                                                                                                                                                                   | Confirm |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Q1  | Is verifying the non-rail `ui` `Link` call sites in scope? (The issue's open readiness question.) | Yes — all 9, listed in §Architecture, each with a stated expected behaviour.                                           | The estimate that made this look unbounded was a substring count. The measured set is 7 files, small enough to enumerate and assert rather than accept as an untested side effect.    | ok      |
| Q2  | Where is the provider mounted?                                                                    | `AppShell`, `AppShellFallback` and the `(auth)` frame — exactly where `AriaI18nProvider` is mounted. Not `__root.tsx`. | Follows a precedent this repository already argued and documented, and keeps React Aria out of the marketing entry chunk.                                                             | ok      |
| Q3  | `widget-link.tsx`: delete, or keep with a new docblock?                                           | Delete; its six call sites move to the design-system `Link` and its styling becomes a `linkVariants` pairing.          | Its only stated reason expires here, and all six call sites pass literal paths with no `params`/`search`, so the typed-`to` argument that keeps `link-style.ts` alive does not apply. | ok      |
| Q4  | `src/routes/_app/import/-lib/link-style.ts` — in scope? (Not mentioned on the issue.)             | Keep it; correct the premise sentence in its docblock only.                                                            | Its second reason — typed `params` and `search` through `createLink` — is independent of this change and still holds. Folding it away would be a regression in type safety.           | ok      |
| Q5  | Does a client-side navigation need a route announcer?                                             | Yes — Phase 2, a polite visually-hidden `role="status"` echoing `document.title`. No new message key.                  | The document load being removed was announcing the new page for free. Shipping Phase 1 without it would narrow the published conformance claim in `docs/ACCESSIBILITY.md`.            | ok      |
| Q6  | Augment React Aria's `RouterConfig` so `href` is typed against the route tree?                    | No. `href` stays `string`.                                                                                             | `attachment-list.tsx` legitimately links to `/api/files/$id`, which is not a route, and `destinations.ts` stores plain strings by design. A separate, reversible decision for later.  | ok      |
| Q7  | Does this warrant a new ADR?                                                                      | No. The spec plus the corrected docblocks carry it.                                                                    | The direction was decided when `ui/link.tsx` was written on React Aria; this implements a promise the codebase already made in three docblocks rather than making a new product call. | ok      |
| Q8  | One spec, or split the announcer out?                                                             | One spec, three phases. Phase 1 and Phase 2 ship in the same release.                                                  | The announcer is only needed _because_ of Phase 1. Splitting invites the two halves to land a release apart, which is the failure mode §Risks names.                                  | ok      |

## 📋 Phasing

- **Phase 1 — the provider and the reconciliation.** The rail, the bottom bar and the other seven
  call sites become client-side navigations; `widget-link.tsx` is deleted.
- **Phase 2 — the route announcer.** The announcement a document load was providing, restored
  deliberately. Ships in the same release as Phase 1.
- **Phase 3 — the measurements and the docblocks.** `docs/STATE-INVENTORY.md` §3 re-measured, the
  e2e helpers re-verified, every sentence that describes the old behaviour corrected.

Each phase leaves the application working, and Phase 1 alone is a complete, revertible change.

## 📋 Implementation Plan

### Phase 1 — the provider and the reconciliation

1. **Add `src/components/app/shell/aria-router.tsx`** exporting `AriaRouterProvider`, and export it
   from `src/components/app/shell/index.ts`. The docblock states the mount-point rule and why
   `useHref` is absent.
   _Verify:_ `src/components/app/shell/__tests__/aria-router.test.tsx` renders a `ui` `Link` under
   a stub TanStack router inside the provider, clicks it, and asserts `navigate` was called with
   `{ href: '/accounts' }` and that `defaultPrevented` is `true`. A second case renders the same
   link _outside_ the provider and asserts `navigate` was not called — the regression guard for
   somebody removing a mount point. Mirrors `__tests__/aria-i18n.test.tsx` in shape.
2. **Mount it** in `AppShell` and `AppShellFallback` (`src/components/app/shell/app-shell.tsx`) and
   in the `(auth)` frame (`src/routes/(auth)/route.tsx`), directly inside `AriaI18nProvider`.
   _Verify:_ `pnpm test`; a Playwright case in a new `e2e/navigation.spec.ts` asserting that a rail
   click produces **no** `document` request (the `page.on('request')` log filtered to
   `resourceType() === 'document'` is empty) and that the URL and the `h1` both reach the
   destination.
3. **Assert the pending state is reachable from the rail.** Extend `e2e/navigation.spec.ts` using
   `holdServerFns` from `e2e/support/states.ts`: navigate from `/dashboard` to `/accounts` through
   the rail with the hold installed, and assert `main` holds a `role="status"` region and skeleton
   bars while the previous screen's content is gone.
   _Verify:_ the case fails on `origin/develop` and passes on the branch. This is the issue's
   headline acceptance criterion.
4. **Assert scroll and focus survive.** In the same file: scroll `/transactions` down, navigate away
   through the rail and back, assert the offset is restored (`scrollRestoration` is already on); and
   assert `document.activeElement` after a rail click is still the rail row, carrying
   `aria-current="page"`.
   _Verify:_ `pnpm e2e` for the new file, in both the desktop and the mobile project — the mobile one
   exercises `bottom-nav.tsx`, which is the same defect on the phone bar.
5. **Add the `widget` pairing to `linkVariants`** in `src/components/ui/link.tsx`, reproducing
   `widget-link.tsx`'s current classes, and give it a case in the existing `components/ui` link test.
   _Verify:_ `pnpm test`; a `scripts/visual/capture.mjs` frame of `/dashboard` in light and dark at
   360 px and 1280 px, compared against the same frames captured from `origin/develop`.
6. **Delete `src/components/app/dashboard/widget-link.tsx`**, its two exports from
   `src/components/app/dashboard/index.ts`, and migrate its six call sites to the design-system
   `Link`; `first-run-panel.tsx`'s `to?: WidgetLinkProps['to']` becomes `href?: string`.
   _Verify:_ `pnpm typecheck` (the deleted export cannot be referenced), `pnpm lint`, `pnpm test`,
   and the `/dashboard` frames from Step 5 unchanged.
7. **Correct the docblocks whose premise this phase removed:**
   `src/components/ui/link.tsx` (the claim is now true and should say where the provider is mounted),
   `src/components/app/nav/destinations.ts`, and
   `src/routes/_app/import/-lib/link-style.ts` (keep the file, replace the "no provider is mounted"
   sentence with the typed-`params`/`search` reason that actually keeps it alive).
   _Verify:_ `pnpm lint` and a read; no assertion covers prose, which is why it is its own Step.

### Phase 2 — the route announcer

8. **Add `src/components/app/shell/route-announcer.tsx`**: a visually-hidden `role="status"`
   `aria-live="polite"` region that writes `document.title` into itself on each committed navigation,
   subscribing through `useRouterState`. It renders nothing on the first paint — announcing the page
   a reader just loaded is noise the browser already made.
   _Verify:_ `src/components/app/shell/__tests__/route-announcer.test.tsx` asserts the region is
   empty on mount and holds the new title after a simulated navigation, and that it is a `status`
   rather than an `alert`.
9. **Mount it once in `AppShell`**, beside `ToastHost`, which is the existing precedent for a
   single region owned by the shell.
   _Verify:_ a Playwright case in `e2e/navigation.spec.ts` asserting that after a rail click the
   `status` region's text equals `document.title`, and an `accessibility.spec.ts` axe scan of the
   shell with the region populated, so a malformed live region cannot ship green.

### Phase 3 — the measurements and the docblocks

10. **Re-measure `docs/STATE-INVENTORY.md` §3** against the branch: the request log for a rail
    navigation, and the `role="status"` / skeleton-bar counts at the sample points the section
    already uses. Rewrite the two subsections that record the document-load behaviour, keeping the
    old numbers as the "before" they were.
    _Verify:_ every number in the rewritten section comes from a command whose output was read
    (`docs/SPEC.md` §7.7); the section names the PR that changed it.
11. **Re-verify `e2e/support/states.ts`'s preconditions** against a rail navigation: confirm the
    shell's read is still the first `/_serverFn/*` request, with the timings read from a request log
    rather than asserted from the ordering argument. Correct `e2e/states.spec.ts`'s header (lines
    40-43), which tells the reader the rail cannot be used for a loading-state case, and add a case
    to `e2e/support/__tests__/states.test.ts` covering the new call pattern.
    _Verify:_ `pnpm exec vitest run e2e/support/__tests__/states.test.ts`, then the whole of
    `pnpm e2e` in both projects.
12. **Run the full gate** in `AGENTS.md` → Validation Commands, in order, plus `pnpm e2e`.
    _Verify:_ every command green, with the output read rather than assumed.
