# 27 — PWA and mobile

## Area brief

The last plan, and the one most easily overclaimed. This is **not** a native app and it is not an
offline-first rewrite. It is three concrete things:

1. **Installability** — a manifest, icons, and an install prompt that appears at a sensible moment.
2. **A service worker with an honest scope** — the app shell and static assets are cached so a
   returning visit paints instantly and a dropped connection degrades to a designed offline screen
   rather than the browser's error page. **Financial data is not cached and is never served stale.**
3. **A mobile pass over the whole product** — the 360px breakpoint, touch targets, the entry form on a
   phone keyboard, and the interactions that only fail on a real device.

The refusal that defines the area: **no offline writes.** Queueing transactions locally and syncing
later requires conflict resolution over a multi-user ledger with quotas, currency rates and a balance
rebuild — a genuinely hard distributed-systems problem, and getting it subtly wrong means someone's
money is wrong. `99-boundaries-and-blockers.md` records this as a deferral with the reason. Offline,
the app shows what it has and says plainly that it cannot record right now, which is a promise it can
keep.

Background sync and push are out for the same family of reasons (BND-13).

---

## Stage 27-S1 — Manifest, icons, service worker and the offline screen

### Stage id

`27-S1` · Wave 6 · effort **L**.

### Reference rows

`PWA-01 missing → done` — the web app manifest and the icon set.
`PWA-02 missing → done` — the service worker with a versioned precache and an explicit no-cache rule
for data.
`PWA-03 missing → done` — the offline screen and the connection-state banner.

### Owned paths

- `public/manifest.webmanifest` — new
- `public/icons/` — new
- `src/sw/service-worker.ts` — new
- `src/sw/precache-manifest.ts` — new
- `src/sw/__tests__/service-worker.test.ts` — new
- `src/routes/offline.tsx` — new
- `src/lib/connection.ts` — new
- `e2e/pwa.spec.ts` — new

### Data and migration

None. Nothing in this plan writes a row.

### Server (repo, server function, Zod)

- **Registration and headers.** The Worker (`00-S2` owns `worker.ts`) must serve
  `/service-worker.js` with `Cache-Control: no-cache` and `Service-Worker-Allowed: /`, and the
  manifest with a long cache and a content hash. This stage **requisitions** those two response rules
  into `00-S2` rather than editing `worker.ts`, which is a shared path.
- The service worker itself is built as a separate entry by the Vite config — also a shared path
  (`vite.config.ts`), also requisitioned, with the entry point and output name specified here so the
  foundations agent has everything it needs in one place.

### UI (route, components)

- **Manifest.** `name`, `short_name`, `start_url: /?source=pwa`, `scope: /`, `display: standalone`,
  `background_color` and `theme_color` **from the token values** so an installed app's splash matches
  the theme, `orientation: any`, and `shortcuts` to `/transactions/new` and `/reports`. Icons at 192,
  512 and a 512 `maskable`, plus an Apple touch icon — a maskable icon is what stops Android
  rendering a white square with a shrunken logo inside it.
  **`theme_color` is declared for both schemes** via a `<meta name="theme-color">` pair with
  `media="(prefers-color-scheme: dark)"`, because the manifest supports only one and a light chrome
  above a dark app looks broken.
- **Service worker strategy**, stated per class and enforced by tests:
  - **precache** — the app shell HTML, JS, CSS and fonts, keyed by a build hash; a new build activates
    with `skipWaiting` **only after** the person is notified and accepts, because swapping the running
    app under someone mid-form loses their input;
  - **stale-while-revalidate** — static assets and the currency catalogue;
  - **network only, never cached** — every `/api/**` route, every server function, and every
    document response for an authenticated route. This is the rule that matters: a cached balance
    served after a transaction is a wrong number presented as a fact, and a cached response served to
    the **next person** on a shared device is a data leak. `service-worker.test.ts` asserts the
    no-cache rule against a list of representative data URLs, and asserts the cache is **cleared on
    sign-out**.
- **Offline behaviour.** A navigation that fails while offline serves `/offline`, a designed page
  stating what is unavailable and what still works, with a retry that re-attempts the original URL.
  A **connection-state banner** (`connection.ts` over `navigator.onLine` plus a real fetch probe,
  since `onLine` lies) appears when offline and disappears on recovery, and **every mutating control
  is disabled with an explanation while offline** — a submit that silently fails is worse than a
  disabled button that says why.
- **States.** Online; offline; **update available** (a status region offering reload); updating;
  installed (running standalone, detected via `display-mode: standalone`, which suppresses the
  install prompt).
- **Accessibility.** The connection banner is `role="status"`, announced once per transition, not on
  every probe. The update prompt is a status region with a real button, never an auto-reload. The
  offline page is a complete page with a heading, an explanation and an action — held to the same bar
  as every other route, including at 360px in both themes.

### Quota

No countable row.

### Tenant isolation test

The one that matters most in this plan, in `tenant-isolation.test.ts` and `e2e/pwa.spec.ts`: _no
response containing tenant data is ever written to the Cache Storage API_, asserted by driving an
authenticated session through the app and then enumerating every cache entry, requiring that none has
a URL matching the data-route patterns and that no cached body contains a seeded transaction
description. Second: _signing out clears every cache_, asserted by the same enumeration after sign-out
— the shared-device case.

### Money invariant

_No amount is ever read from a cache._ Cases in `service-worker.test.ts`:

- _every route that can return an amount is on the network-only list_, asserted by generating the
  list from the route tree rather than maintaining it by hand — a new data route is covered
  automatically, which is the only version of this rule that survives contact with a growing app.
- _a cached shell served offline renders no stale amounts_: the shell contains the layout and no data,
  so the offline app shows its designed empty regions, not last week's balance. The test asserts the
  precached HTML contains no digit sequence matching a seeded amount.
- _the currency catalogue may be cached but rates may not_ — `currencies` is reference data,
  `fx_rates` is a value, and serving a stale rate would silently misprice a new entry.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `service-worker.test.ts`: the three money cases; the generated network-only list covering every data
  route; the update flow not auto-activating; the sign-out cache clear.
- `e2e/pwa.spec.ts`: install the service worker, go offline (`context.setOffline(true)`), navigate and
  land on `/offline`, assert mutating controls are disabled with their explanation, come back online
  and assert the banner clears and a real load succeeds; then the cache-enumeration assertions.
- Manifest validation: icons present at every declared size, `maskable` correct, `start_url` in scope.
- Browser evidence: `/offline` in both themes at **360 / 1280 / 2560 px**, the **connection banner**,
  the **update-available prompt**, and an **installed standalone capture** at 360px.
- Lighthouse installability check passing, recorded in the PR.
- axe on `/offline` and with the banner shown: zero `serious`, zero `critical`.
- Console silent — including no service-worker registration warnings, which are the usual noise here.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 27-S2 — The install prompt and standalone chrome

### Stage id

`27-S2` · Wave 6 · effort **S**.

### Reference rows

`PWA-04 missing → done` — the deferred install prompt with a sensible trigger.
`PWA-05 missing → done` — standalone-mode chrome: safe areas, back affordance, status bar.

### Owned paths

- `src/routes/_app/-ui/install-prompt.tsx` — edit
- `src/lib/install.ts` — new
- `src/lib/__tests__/install.test.ts` — new
- `src/routes/_app/-ui/standalone-chrome.tsx` — new

### Data and migration

None. Dismissal is `localStorage` per browser — an install prompt is a per-device concern and a server
round trip for it would be absurd.

### Server (repo, server function, Zod)

None.

### UI (route, components)

- **`install.ts`** captures `beforeinstallprompt`, defers it, and exposes `canInstall`, `promptInstall`
  and `dismissForNow`. **The prompt is not shown on first visit.** It appears after the person has
  done something real — recorded a transaction or completed an import — because asking a stranger to
  install is how the prompt gets dismissed permanently in the first three seconds. The trigger
  condition is a named constant and the test asserts it.
- **Dismissal is respected for 30 days**, then at most once more, then never. Three prompts across a
  lifetime is the whole budget.
- **iOS** exposes no `beforeinstallprompt`. On iOS Safari, `install-prompt.tsx` (the shell built by
  `00-S16`) renders **instructions** instead — "Share → Add to Home Screen" — with the same trigger
  and dismissal rules. A prompt that does nothing on half the phones is worse than no prompt.
- **`standalone-chrome.tsx`** applies when `display-mode: standalone`: `env(safe-area-inset-*)`
  padding on the header and the bottom bar (so content clears the notch and the home indicator), a
  **back affordance in the app header** since there is no browser chrome, and pull-to-refresh disabled
  on the ledger list where it fights the virtualised scroller.
- **States.** Cannot install (already installed, or unsupported — the prompt is absent, not disabled);
  can install (prompt available); dismissed; installed.
- **Accessibility.** The prompt is a `role="status"` region with a real button and a real dismiss, not
  a toast that steals focus. The back affordance is a button with an accessible name, and it uses the
  router's history rather than `window.history.back()` so it behaves at the stack's root instead of
  leaving the app.

### Quota

No countable row.

### Tenant isolation test

None — no data access. Stated rather than skipped.

### Money invariant

None — this stage renders no amount. Stated with the reason rather than omitted, per `TEMPLATE.md`'s
rule that this heading is never skipped.

### Verification

- Command gate.
- `install.test.ts`: the trigger condition met and unmet; the 30-day dismissal window; the three-prompt
  lifetime cap; the iOS branch selecting instructions; the already-installed branch rendering nothing.
- `e2e/pwa.spec.ts` extended: the prompt absent on first load, present after a recorded transaction,
  and absent after dismissal.
- Browser evidence: the **install prompt** and the **iOS instructions variant** in both themes at
  360px and 1280px; the **standalone chrome** with visible safe-area padding at 360px; the **back
  affordance focused**.
- axe with the prompt shown: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 27-S3 — The mobile pass

### Stage id

`27-S3` · Wave 6 · effort **L**. The product-wide sweep that closes the plan and the backlog.

### Reference rows

`PWA-06 missing → done` — the 360px audit across every app route.
`PWA-07 missing → done` — touch input: targets, keyboards, gestures, the entry form on a phone.
`PWA-08 missing → done` — the `mobile-safari` Playwright project covering the primary flows.

### Owned paths

- `src/routes/_app/-ui/mobile-nav.tsx` — new
- `src/routes/_app/-ui/mobile-sheet-behaviour.ts` — new
- `e2e/mobile.spec.ts` — new
- `docs/MOBILE.md` — new

### Data and migration

None.

### Server (repo, server function, Zod)

None.

### UI (route, components)

- **`mobile-nav.tsx`** — the bottom navigation for standalone and narrow viewports: five destinations
  maximum (Home, Transactions, Add, Budgets, More), each 44px minimum with its label in text, not an
  icon alone. The **Add** action is a link to `/transactions/new`, not a floating action button that
  covers the last list row — a FAB that hides content is a common and avoidable defect.
- **The sheet's mobile behaviours.** `src/components/ui/sheet.tsx` is a shared path owned by `00-S6`,
  so this stage does **not** edit it: it ships `mobile-sheet-behaviour.ts` (the safe-area padding
  values, the drag threshold and the scroll-lock hook) and **requisitions** the one-line wiring into
  `00-S6`. The behaviours are: safe-area
  padding, a drag handle that is also a keyboard-operable close button, and a scroll-lock that does
  **not** break the virtualised transaction list underneath. It remains built on React Aria's
  `Modal`/`Dialog` — `vaul` stays dropped (BND-22), and this stage is where that decision is finally
  paid for, so the drag physics are deliberately simple: a threshold and a snap, not a spring.
- **Number entry.** `money-field.tsx` (`00-S10`) sets `inputmode="decimal"`, `enterkeyhint="done"` and
  a locale-appropriate `pattern`, and — the detail that matters on Polish keyboards — accepts **both**
  `,` and `.` as the decimal separator regardless of locale, because phone keyboards disagree with
  themselves about which one they emit. The invariant test below covers it.
- **Date entry.** The React Aria `DatePicker` is used rather than a native `<input type="date">`, so
  the format is consistent and the calendar is keyboard- and screen-reader-operable; the trade-off is
  the loss of the native wheel picker, and it is recorded in `docs/MOBILE.md` rather than pretended
  away.
- **`docs/MOBILE.md`** records the audit: every app route, its 360px behaviour, and any known
  compromise. Like `docs/EMPTY-STATES.md` (`26-S3`), a test enumerates the route tree and fails if a
  route is missing from the table, so the audit cannot rot.
- **States.** Narrow; wide; standalone narrow; landscape narrow (a real state — a phone in landscape
  is 360px tall, and a header plus a bottom nav must not consume it all).
- **Accessibility.** Every interactive target is **44 × 44 CSS px** with no exception granted (2.5.5
  AAA), verified programmatically rather than by eye. Focus is never obscured by the bottom nav or a
  sticky header (2.4.11 and 2.4.12 AAA) — a focused field scrolled behind a sticky bar is the single
  most common mobile focus failure, and `mobile.spec.ts` asserts the focused element's rectangle is
  fully within the visual viewport after each tab step through the entry form. Text reflows at 320px
  with no horizontal scroll (1.4.10 AA); pinch-zoom is **not** disabled, and the viewport meta is
  asserted to contain no `user-scalable=no` or `maximum-scale`.

### Quota

No countable row.

### Tenant isolation test

None new; the mobile pass changes presentation only. The e2e suite runs the existing isolation
assertions under the `mobile-safari` project so a mobile-only route that skipped a scope check would
be caught, and that is why the project runs the full primary-flow spec rather than a reduced one.

### Money invariant

_A number typed on a phone is the number that is stored._ Cases in `money-invariants.test.ts` and
`e2e/mobile.spec.ts`:

- _`money-field` parses `12,34` and `12.34` to the same `1234`_ under both `en` and `pl`, which is the
  keyboard-disagreement case;
- _a paste of `1 234,56` (with a non-breaking space) parses to `123456`_, since a pasted amount from a
  bank's mobile site is the common real path;
- _a value exceeding the currency's `digits` is rejected inline, not rounded_, matching `19-S1`'s
  import rule so the two entry paths agree;
- _the amount displayed after saving on a phone is byte-identical to the same transaction rendered on
  a desktop viewport_, asserted by reading both from the DOM against one seeded row.

### Verification

- Command gate.
- `e2e/mobile.spec.ts` under the **`mobile-safari`** project (`docs/plans/98-verification-protocol.md`):
  the primary flows — sign in, record a transaction, split it, transfer between accounts, check a
  budget, run a report, import a small file — each completed **on a 360px viewport with touch
  emulation**; the focus-visibility assertion through the entry form; the target-size sweep asserting
  every interactive element's rectangle; the viewport-meta assertion.
- The **route-table test** for `docs/MOBILE.md`.
- Browser evidence: every primary route at **360px in both themes**, plus **landscape narrow** for the
  entry form and the transaction list, the **bottom nav**, the **sheet open over the virtualised
  list**, and the **numeric keyboard shown for the amount field**.
- Visual regression across the mobile project at `maxDiffPixelRatio: 0.002`, `threshold: 0.2` — never
  raised.
- axe under the mobile project on every primary route: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses. This is the final stage of the final plan, so its definition
of done carries one extra clause: **`docs/MOBILE.md` and `docs/EMPTY-STATES.md` are both complete and
their route-table tests pass**, which together assert that every route in the product has a designed
empty state and a documented mobile behaviour.

### Blockers

None.
