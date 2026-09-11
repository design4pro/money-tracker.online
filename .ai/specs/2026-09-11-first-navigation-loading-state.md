# The first client-side navigation draws its loading state

| Field              | Value |
| ------------------ | ----- |
| **Status**         | draft |
| **Issue**          | #230  |
| **Spec PR**        | #232  |
| **Implementation** | none  |

## 📝 TLDR

`_app.beforeLoad` awaits the application shell, and on a fresh document the client's query cache is
empty, so the **first** client-side navigation in a tab spends a round trip before the router will
render any pending component. For that one navigation — the one a reader is most likely to be
waiting on — the previous screen's figures stay on the page under the next screen's URL, with
nothing announced. The guard is not the problem and does not move: it keeps awaiting the shell, and
no part of a protected route paints before the session and the tenant are confirmed. What changes is
that the shell the server already resolved during SSR now **crosses into the client's cache before
the first client render**, through `@tanstack/react-router`'s own `dehydrate`/`hydrate` router
options, so the guard's `await` resolves from cache instead of from the network. Two router options
carrying two values, one extracted constant, no new dependency, no schema change, no message key.

## 📝 Problem Statement

### 1. The pending machinery is inert for exactly one navigation per tab

`src/routes/_app.tsx:152-157` is the whole of it:

```ts
beforeLoad: async ({ context, location }) => {
  const shell = await context.queryClient.ensureQueryData({
    queryKey: SHELL_QUERY_KEY,
    queryFn: () => loadShell(),
    staleTime: SHELL_STALE_TIME,
  })
```

TanStack Router resolves a match's `beforeLoad` before it will render that match's pending component
or any of its children's. So until this `await` returns there are no pending matches, and neither
`_app`'s own `pendingComponent` (`src/routes/_app.tsx:173-177`) nor the `defaultPendingComponent`
that #21 installed at `src/router.tsx:73` nor any per-route shape can render. The router is not
misconfigured. It is not yet allowed to speak.

On a fresh document the client's query cache is empty, so `ensureQueryData` takes its
`fetchQuery` branch and makes a real `/_serverFn/*` round trip. That happens exactly once per tab,
on whichever client-side navigation comes first.

### 2. It was measured, by #21, and deliberately left alone

`docs/STATE-INVENTORY.md` §3 records the probe. On a client-side navigation from `/accounts` to an
account detail, with the shell's own request held and everything after it let through:

| What was held                        | `role="status"` regions in `main` | Skeleton bars | The previous screen |
| ------------------------------------ | --------------------------------- | ------------- | ------------------- |
| The shell read, and everything after | **0**                             | **0**         | still on screen     |
| Everything **except** the shell read | **1**                             | **11**        | gone                |

The same finding is written from the test side, with timings, in `e2e/support/states.ts` — the
docblock on `serverFnIdOf`: the shell's read starts at 1909 ms and finishes at 1924 ms, the
account-detail read starts at 1927 ms, and the detail screen's own two reads start at 1974 ms. That
helper exists _because_ of this block: `holdServerFns` has to let the shell's request through, or
the hold freezes the router one step before the state it was installed to photograph.

#21 shipped the router-level pending default, the seven missing per-route shapes and the
reachability harness **around** this block rather than through it, because `_app.beforeLoad` is the
session and tenant guard and `AGENTS.md` → Ask First covers it. `docs/STATE-INVENTORY.md` §6 says so
and names this issue.

### 3. What the reader actually gets

For the duration of that round trip: the URL reads the new screen, the rail highlights the new tab,
the `h1` names the old screen, and the old screen's amounts are on the page. Nothing is announced to
a screen reader, because `role="status"` is a property of the skeleton that did not render. In a
product about money that is worse than a blank hold — the numbers are real, they are stale, and
nothing says so. `src/router.tsx:66-68` already argues exactly this case for the router-level
default; this spec is what makes that argument reach the first navigation too.

## 📝 Proposed Solution

**Prime the cache; do not move the guard.** The shell is already resolved on the server during SSR
of every protected document — `_app.beforeLoad` runs there, in-process, with no network hop. Today
that resolution is thrown away at the water's edge: `beforeLoad`'s return value is router _context_,
and context is not dehydrated into the SSR stream. `src/routes/__root.tsx:169-171` already states
this property of the framework in the codebase's own words, and is the reason the locale negotiation
lives in a `loader` rather than in `beforeLoad`.

`@tanstack/react-router` offers a channel for precisely this, and it is already installed. Verified
in `@tanstack/router-core@1.171.27`:

| Half    | Where                                    | What it does                                                                  |
| ------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| Server  | `dist/esm/ssr/ssr-server.js:320`         | `const dehydratedData = await router.options.dehydrate?.()`                   |
| Server  | `dist/esm/ssr/ssr-server.js:322`, `:346` | attaches it to the dehydrated router and streams it (`crossSerializeStream`)  |
| Browser | `dist/esm/load-client.js:1088`           | `await waitFor(router.options.hydrate?.(dehydratedRouter.dehydratedData), …)` |

The ordering is the part that makes this work rather than merely plausible: `load-client.js:1088`
awaits `hydrate` **before** the match-hydration loop at `:1119` (whose bound `shared` is computed at
`:1117`) and before any client render. So a `hydrate` that seeds `SHELL_QUERY_KEY` leaves the cache
warm before the tab is capable of a client-side navigation at all.

After that, the first navigation's `ensureQueryData` takes its cached branch —
`@tanstack/query-core@5.102.8`, `build/modern/queryClient.js:75-82`:

```js
ensureQueryData(options) {
  const defaultedOptions = this.defaultQueryOptions(options);
  const query = this.#queryCache.build(this, defaultedOptions);
  const cachedData = query.state.data;
  if (cachedData === void 0) return this.fetchQuery(options);
  if (options.revalidateIfStale && query.isStaleByTime(…)) this.prefetchQuery(defaultedOptions);
  return Promise.resolve(cachedData);
}
```

`beforeLoad` still awaits. It awaits an already-resolved promise, resolves in a microtask, and the
router proceeds to the destination's loaders with its pending machinery live.

### The alternative, and why it lost

The issue named a second shape: move the shell read out of `beforeLoad` into the route's loader or a
suspense boundary, leaving `beforeLoad` with only the checks that must precede a render. It is
**rejected**, by a maintainer, on the record: [#230, comment
5630289004](https://github.com/design4pro/money-tracker.online/issues/230#issuecomment-5630289004).
Nothing of a protected route may paint before the session and the tenant are confirmed, so the
decision to draw a skeleton is not separable from the guard by making the guard advisory. The
rejection is durable enough to be re-litigated, so it is recorded as an ADR in this PR rather than
as a paragraph here — see **Decisions in play**.

## 📝 Architecture

### What changes

Three files, and one of them only moves a constant.

**1. One owner for the shell's cache contract.** `SHELL_QUERY_KEY` and `SHELL_STALE_TIME` live in
`src/routes/_app.tsx:46` and `:49` today, and `src/router.tsx` now needs the key as well. `src/router.tsx`
must not import `src/routes/_app.tsx` — `routeTree.gen.ts` already imports it, so the edge would
close a cycle through generated code. `docs/SPEC.md` §8 gives a concept exactly one owner, so the
contract moves to a small module both sides import:

```
src/components/app/shell/shell-query.ts
```

It exports `SHELL_QUERY_KEY`, `SHELL_STALE_TIME` and the `shellQueryOptions()` factory that
`beforeLoad` passes to `ensureQueryData`. It does **not** re-export `ShellData`: that type already
lives one directory up in `src/components/app/shell/types.ts` and is already exported from that
directory's `index.ts`, so a second export would be the "one concept, one owner" rule broken by the
module that cites it. Consumers import the type from where it lives.

It is reached by a deep import rather than through the barrel — `src/router.tsx` already deep-imports
`route-pending` (`src/router.tsx:19`), and adding a query-key module to a barrel whose docblock says
"nothing in this directory fetches" would invite the barrel into `src/routes/_app.tsx`'s import graph
for no gain. `src/components/app/shell/index.ts` is therefore left alone.

The module imports nothing from `#/server` and fetches nothing itself — the `queryFn` stays an
argument, supplied by `_app.tsx`, which is the only module that may reach `loadShell`. That keeps
`AGENTS.md` → Always ("`components/ui` never fetches and never imports from `server/`") true of the
shell module as well, and keeps the server function's dynamic-import discipline
(`src/routes/_app.tsx:93-100`) intact.

**2. The channel.** `src/router.tsx` gains two options beside the ones #21 added:

```ts
dehydrate: () => ({
  shell: queryClient.getQueryData<ShellData>(SHELL_QUERY_KEY) ?? null,
  // The server's own stamp, not the browser's. See "Why the timestamp travels" below.
  shellUpdatedAt:
    queryClient.getQueryState(SHELL_QUERY_KEY)?.dataUpdatedAt ?? null,
}),
hydrate: ({ shell, shellUpdatedAt }) => {
  if (shell) {
    queryClient.setQueryData(SHELL_QUERY_KEY, shell, {
      updatedAt: shellUpdatedAt ?? undefined,
    })
  }
},
```

`getQueryData` returns `undefined` on any document where `_app` never matched — the marketing page,
`/login`, `/invite/$invitationId` — so those documents carry `{ shell: null, shellUpdatedAt: null }`
and seed nothing. See **Edge Cases** for why that is asserted rather than assumed.

#### Why the timestamp travels

`setQueryData` reaches `query.js:57-66`, which dispatches `dataUpdatedAt: options?.updatedAt`. Pass
no options and the reducer stamps `Date.now()` — **the moment of hydration in the browser**, not the
moment the server resolved the shell. Everything downstream measures freshness from that stamp:
`isStaleByTime` compares `SHELL_STALE_TIME` against `dataUpdatedAt`, and Q3's `revalidateIfStale`
fires off it.

Dropping the stamp would therefore silently widen the refresh window to
`SHELL_STALE_TIME + (hydration − SSR resolution)`, which on a slow connection with a streamed
document is not a rounding error. It would also make the cadence claim in **Why Q2 + Q3 is a
tightening** false as written, in the one area `AGENTS.md` → Ask First names explicitly. So the
server's `dataUpdatedAt` crosses the wire beside the data, and `SetDataOptions.updatedAt` — which
exists for exactly this — puts it back.

**The alternative, and why it was not taken.** `@tanstack/query-core` exports its own `dehydrate` /
`hydrate` pair, and `hydration.js:28-40`'s `dehydrateQuery` preserves the whole `query.state` —
`dataUpdatedAt` included — plus a `dehydratedAt` stamp. Filtering it to this one key with
`DehydrateOptions.shouldDehydrateQuery` would carry the timestamp without the explicit field above,
and an implementer who prefers it should take it. It is not the default here because it dehydrates
`query.state` wholesale — `status`, `fetchStatus`, `error`, `errorUpdatedAt`, `fetchFailureCount` —
into a document that needs exactly two values, which is a wider serialized surface than the anonymous-document
assertion in Step 5 can cheaply reason about. Two named fields are the narrower promise.

**3. The guard, unchanged in shape.** `src/routes/_app.tsx` keeps its `await`, its redirect, its
`pendingComponent` and its `errorComponent`. It passes `shellQueryOptions({ queryFn })` where it
today passes an inline object literal. Two fields of that object change, and they are the subject of
**Resolved assumptions** Q2 and Q3.

### What is reused rather than invented

- The dehydration channel is the framework's, not a `<script>` tag this repository writes.
- The cache is the router's existing per-request / per-tab `QueryClient`
  (`src/router.tsx:31-43`); no second cache, no module-scope state. The comment at
  `src/router.tsx:1-11` explains why a shared client would be a cross-tenant leak in a reused
  Worker isolate, and this change does not touch that placement.
- The loading states themselves already exist. #21 shipped them. This spec only makes them
  reachable on one more navigation.

### What does not change

No repository function, no server function signature, no Zod schema, no D1 migration, no queue
message, no Durable Object, no binding, no message key, no route path. `loadShell`'s body is not
edited.

## 📝 Data Model

None. No entity, field, relation or migration. No amount, rate, currency or date bucket is read,
written, formatted or converted, so no case in
`src/server/repos/__tests__/money-invariants.test.ts` is owed (`docs/MONEY.md` is not engaged).

## 📝 API Contracts

No contract changes. `loadShell` keeps its signature and its `ShellData | null` return.

One **new serialized surface** is introduced, and it is internal to a single document: the router's
dehydrated payload gains a `shell` field. It is not a public contract — it is written and read by
the same deploy, in the same document, and nothing outside the current deploy can hold a reference
to it. It is therefore not a `BACKWARD_COMPATIBILITY.md` surface; see **Risks & Impact Review** for
the check against that document rather than the assumption.

## 📝 UI/UX

The deliverable is that one navigation gains the state #21 designed for it. There is no new
component, no new layout and no new copy.

| Navigation                                  | Today                                        | After                                         |
| ------------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| First client-side navigation in a fresh tab | previous screen's content, 0 `role="status"` | the destination's skeleton, 1 `role="status"` |
| Every later client-side navigation          | the destination's skeleton                   | unchanged                                     |
| Full document load (the shell rail's links) | SSR, no pending state, nothing to fix        | unchanged                                     |

The skeleton that appears is the one already shipped: the destination route's `pendingComponent`
where it declares one, otherwise `RoutePending` via `defaultPendingComponent`
(`src/router.tsx:73`). `defaultPendingMs` stays at 300 ms (`src/router.tsx:83`), so a navigation
that finishes inside 300 ms still shows nothing, which is the intended behaviour and not a
regression.

Accessibility: the announcement is the `role="status"` region inside the existing skeleton. This
spec adds no new landmark, no new live region and no new keyboard path, and it does not widen the
claim in `docs/ACCESSIBILITY.md` (`docs/SPEC.md` §10). What it changes is that an assistive
technology user is told "loading" on a navigation where they are currently told nothing — which is
a defect being closed under the existing AA claim, not a new claim.

## 📝 Edge Cases & Failure Scenarios

| Scenario                                                       | Behaviour                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anonymous document** (`/`, `/login`, `/invite/$id`)          | `_app` never matched, so `getQueryData` and `getQueryState` are both `undefined` and the payload carries `{ shell: null, shellUpdatedAt: null }`. No session-derived field is serialized into a signed-out document. Asserted, not assumed — see Phase 1 Step 5.                                                                                                                               |
| **`hydrate` receives `null`**                                  | `setQueryData` is skipped, `shellUpdatedAt` with it. The cache stays empty and behaviour is exactly today's: the first navigation fetches and blocks. A reader who signs in on `/login` and is redirected into the app arrives via a document load, which re-primes.                                                                                                                           |
| **Session revoked between the document load and a navigation** | The guard is unchanged: it still awaits, still receives a shell, still redirects to `/login` when the shell is `null`. A revoked session's _chrome_ may be one navigation stale; its _data_ cannot be, because every server function underneath calls `requireOrg()` for itself (`src/routes/_app.tsx:27-31`). Q3 tightens this window rather than widening it — see **Resolved assumptions**. |
| **The primed entry is garbage-collected**                      | Verified: the shell query has no observers, so `query.js:28` schedules collection at construction and `removable.js:17` defaults the client-side `gcTime` to `3e5` — five minutes. Without Q2 the priming would be a five-minute privilege and the block would return silently. This is the failure mode the spec would ship with if Q2 were defaulted the other way.                          |
| **`dehydrate` throws**                                         | It cannot: `getQueryData` is a synchronous cache read that returns `undefined` for a missing key. `hydrate` is guarded by the `if (shell)`. Neither reaches the network. A malformed payload is a framework-level deserialization failure that already takes the document down independently of this change.                                                                                   |
| **SSR itself fails to resolve the shell**                      | Unchanged. `loadShell` returns `null` for a banned or membership-less user and `beforeLoad` redirects; a thrown error reaches `errorComponent` (`src/routes/_app.tsx:185-189`). The dehydration adds no branch here.                                                                                                                                                                           |
| **A second tab**                                               | Each tab hydrates its own router and its own `QueryClient` (`src/router.tsx:46`). Nothing is shared, so nothing is cross-contaminated.                                                                                                                                                                                                                                                         |

## 📝 Risks & Impact Review

**Blast radius.** `src/router.tsx` is in every visitor's entry chunk, so a mistake here is a mistake
on the marketing page as well as in the product. That is what makes the anonymous-document assertion
(Step 5) a required step rather than a nicety. Against that: the two added options are a synchronous
cache read and a synchronous cache write, both no-ops when there is no shell.

**`BACKWARD_COMPATIBILITY.md`, checked rather than assumed.** The issue flagged that the fix may
touch a protected surface because auth and session behaviour is what that document protects. It does
not. The row reads: `/api/auth/*` (Better Auth), the KV session store, `BETTER_AUTH_SECRET`,
`APP_URL` — broken by "rotating the secret without a plan, changing the session shape, renaming a
secret". This spec changes no endpoint, no stored session shape, no secret and no binding name. No
other row is engaged: no D1 schema, no stored money, no tenant-scope signature, no queue message, no
Durable Object migration, no public URL, no message-catalogue key.

**The tenant scope is untouched.** No repository function's call site changes, so no new case in
`src/server/repos/__tests__/tenant-isolation.test.ts` is mechanically owed (ADR 0002,
`AGENTS.md` → Always). The issue is right that the _guarantee_ is the point, however, so the
assertion is made where the change actually lands — in the browser suite, on the guard's observable
answer (Phase 1 Step 5).

**Rollback.** Revert the commit. There is no migration, no stored state and no deployed artefact
that outlives the deploy: the dehydrated payload is written and read within one document by one
build. A rolled-back deploy serves documents without the field, and a client of the rolled-back
build never looks for it.

**Reversibility of each state change.** The only state this introduces is one entry in an in-memory,
per-tab cache that the same code path already creates one navigation later. Closing the tab undoes
it.

## 📝 Decisions in play

`.ai/specs/product-brief.md` does not exist in this repository, so there is no Non-goals / Business
rules / Decisions table to cite. The decision this spec relies on is recorded as an ADR in the same
PR, per `.ai/skills/om-spec-writing/SKILL.md` → _What a spec cites_:

**ADR 0018 — the session guard stays blocking; loading states are bought by priming, not by
relaxing the guard.** It records the maintainer's answer on #230, the shape it rejects (moving the
shell read into a loader or a suspense boundary), and the standing consequence: a future loading-state
complaint against a protected route is answered by priming or by making the read cheaper, never by
letting a protected route paint before its session is confirmed.

Existing decisions relied on and not modified: **ADR 0011** (Better Auth with a KV session store —
the guard's substance), **ADR 0002** (the tenant-scoped repository boundary — untouched, and the
reason `beforeLoad` is UX rather than a data boundary), **ADR 0009** (the scoped WCAG claim — not
widened), **ADR 0016** (journeys replace the visual gate — how the frames in Step 6 are taken).

## 📝 Resolved assumptions (autonomous defaults)

Q1 was answered by a human before this spec was written. Q2 and Q3 were drafted as autonomous
defaults carrying `⚠ NEEDS HUMAN CONFIRMATION` and were **confirmed by a maintainer** on the spec
PR before it left draft ([#232, the Open Questions
comment](https://github.com/design4pro/money-tracker.online/pull/232#issuecomment-5630372296)). Nothing in this table is now
an unconfirmed assumption; the column records how each answer was reached, per `SDLC.md` →
Definition of Ready.

| #   | Question                                                                                     | Answer                                                                                                                                                                                                                            | Rationale                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | What may render before the shell read has answered?                                          | **Nothing new. The guard stays blocking and the cache is primed instead.** Answered by a maintainer on [#230](https://github.com/design4pro/money-tracker.online/issues/230#issuecomment-5630289004) — not an autonomous default. | The alternative shape (shell read in a loader or a suspense boundary) is rejected on the record and recorded as ADR 0018.                                                                                                                                                                                    |
| Q2  | Must the primed entry survive `gcTime`?                                                      | **Yes — `gcTime: Number.POSITIVE_INFINITY` on the shell query only.** Confirmed by a maintainer on #232 (ships with Q3)                                                                                                           | Measured: the shell query has no observers, so it is collected five minutes after its last fetch (`query.js:28`, `removable.js:17`, default `3e5`). Without this the fix silently expires and the block returns for a reader who has been on a page for five minutes. Scope is one entry in a per-tab cache. |
| Q3  | With the entry resident forever, how does a revoked or demoted session's shell ever refresh? | **`revalidateIfStale: true` on the `ensureQueryData` call, keeping `SHELL_STALE_TIME` at 30 s.** Confirmed by a maintainer on #232                                                                                                | See the argument below. It makes `_app.tsx:37-41`'s stated intent real for the first time, and it never blocks: `queryClient.js:80-81` returns the cached value and refetches in the background.                                                                                                             |
| Q4  | Does `holdServerFns`'s shell exception in `e2e/support/states.ts` stay?                      | **Stays; its docblock is rewritten.**                                                                                                                                                                                             | Smallest blast radius, and removing it would be a change to what a passing test exercises for no behavioural gain. The docblock currently documents the block as a permanent property of the app and must stop doing so.                                                                                     |
| Q5  | Is a new ADR owed, or is a paragraph enough?                                                 | **ADR 0018, in this PR.**                                                                                                                                                                                                         | The repo-local `om-spec-writing` rule: a product decision a spec relies on that has no ADR gets one in the same PR. This decision will be re-litigated — the issue itself proposes the rejected shape — which is what an ADR is for.                                                                         |

### Why Q2 + Q3 is a tightening, not a weakening

They were drafted behind a `⚠ NEEDS HUMAN CONFIRMATION` marker because `AGENTS.md` → Ask First names
sessions explicitly, and this is the argument a maintainer read before confirming them. It is kept
here rather than deleted with the marker: the reason a session-touching change was judged safe is
worth more to the next reader than the fact that somebody once approved it. From the installed
source:

- **Today, a motionless reader's shell never refreshes.** `ensureQueryData` is only called from
  `beforeLoad`, so with no navigation there is no call. Garbage collection _removes_ the entry; it
  does not refetch it. So today's cadence for a reader who does not navigate is: never.
- **Today, a navigating reader's shell refreshes at most once per five minutes,** and only by
  accident — the entry has to be collected first, because `queryClient.js:79-81` returns cached
  data whatever its staleness unless `revalidateIfStale` is set, which today it is not. The
  30-second `SHELL_STALE_TIME` at `_app.tsx:46` currently changes nothing about this call. The
  intent written at `_app.tsx:37-41` is not implemented by the code beneath it.
- **After Q2 + Q3, a navigating reader's shell refreshes at most once per thirty seconds,** in the
  background, on the next navigation past the stale mark. Thirty seconds measured from the moment
  the **server** resolved the shell, not from the moment the browser hydrated it — which is what the
  `shellUpdatedAt` field in **Architecture** point 2 buys, and what the window would silently lose
  without it. A motionless reader's cadence is unchanged: never — and unchanged is the relevant
  comparison.

There is therefore no window in which the proposal is staler than what ships today, and one in
which it is ten times fresher. The security floor is untouched either way: `beforeLoad` is UX, every
server function calls `requireOrg()` for itself, and a revoked session's _data_ calls fail
regardless of what the chrome says (`src/routes/_app.tsx:27-31`, ADR 0002).

### What Q3 costs at the next query-core major

`revalidateIfStale` is an option of a **deprecated** surface, and a reader confirming Q3 should know
its supported lifetime. In the installed `@tanstack/query-core@5.102.8`,
`build/modern/hydration-Bjs0MSgg.d.ts`:

| Line       | What it says                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `:464-467` | `ensureQueryData` is `@deprecated`: _"Use `queryClient.query({ ...options, staleTime: 'static' })` instead. This method will be removed in the next major version."_                                         |
| `:796-799` | `EnsureQueryDataOptions` is itself `@deprecated`, and **`revalidateIfStale` is declared only there** — not on `FetchQueryOptions`, and not on the `QueryExecuteOptions` that the replacement `query()` takes |
| `:584`     | `StaleTime = number                                                                                                                                                                                          | 'static'`, and `'static'` means never stale |

Three consequences, none of which changes this spec's answer:

1. **Nothing is deepened by this change.** `_app.tsx:153` already calls `ensureQueryData`. Q3 adds a
   field to a call that exists; it does not introduce the dependency on the deprecated method.
2. **The stack is pinned** (`docs/SPEC.md` §3), so the removal is a future upgrade's problem, not
   this build's, and upgrading is an Ask First item in its own right.
3. **The vendor's suggested replacement is not a drop-in, and would invert Q3.**
   `query({ ...options, staleTime: 'static' })` marks the entry permanently fresh, which is the
   opposite of "refetch in the background past thirty seconds". So a query-core major upgrade owes
   this behaviour a deliberate re-implementation — most likely an explicit staleness check plus
   `prefetchQuery`, which is what `queryClient.js:80-81` does internally today — and not a mechanical
   find-and-replace. Whoever opens that upgrade should read this section first.

## 📝 Visual change expected

**Yes, and it is the deliverable.**

| Route                                                        | State     | Themes       | Widths     |
| ------------------------------------------------------------ | --------- | ------------ | ---------- |
| `/transactions` (reached from `/dashboard` via `WidgetLink`) | `loading` | light + dark | 360 + 1280 |
| `/accounts/$accountId` (reached from `/accounts`)            | `loading` | light + dark | 360 + 1280 |

Captured from a **fresh context** with
`node scripts/visual/capture.mjs --state loading --force-state loading --force-from …`, per
ADR 0016 and `AGENTS.md` → Visual verification. The frame that matters is the one that is impossible
to take on `develop` today: the first navigation in the context. Frames go to `.ai/qa/artifacts_*/`
and never into the repository (`AGENTS.md` → Never).

No other route's rendered output changes. No light/dark token, no spacing and no component is
edited.

## 📝 Copy

**None.** No user-facing string is added, changed or removed, so no key lands in
`src/lib/i18n/messages/{en,pl}.ts` and the `i18n-messages` skill is not engaged. The skeleton's
announcement text is already in the catalogue, shipped by #21.

## 📋 Phasing

**One phase.** It is one independently deployable capability, one product area, no migration, and it
fits in one run — `docs/SPEC.md` §8's sizing rule. Splitting it would produce a phase that primes a
cache nothing reads and a phase that reads a cache nothing primes, neither of which leaves the
application meaningfully better than it is now.

## 📋 Implementation Plan

### Phase 1 — The shell crosses the wire, and the first navigation draws its skeleton

Steps 1–6. Each leaves the application working and the validation gate green.

**Step 1 — Give the shell's cache contract one owner.**
Create `src/components/app/shell/shell-query.ts` exporting `SHELL_QUERY_KEY`, `SHELL_STALE_TIME` and
a `shellQueryOptions({ queryFn })` factory; re-point `src/routes/_app.tsx` at it and delete the two
local constants. Pure move — the object the factory returns is field-for-field what
`_app.tsx:153-157` passes today, so no behaviour changes in this step.
_Verify:_ `pnpm typecheck`, `pnpm lint`, `pnpm test` green; `git diff` shows no change to any
emitted value. The module must not import from `#/server` — assert it the way the repo already
asserts import boundaries, or by inspection if no such test exists.

**Step 2 — Write the failing browser test.**
Add a case to the states suite that reproduces the issue: a **fresh context**, a document load of
`/dashboard`, then a **client-side** navigation via `WidgetLink` with the shell's read held — the
inverse of what `holdServerFns` does today, so it needs a helper that holds the shell _including_
the first request rather than excluding it. Assert at least one `role="status"` region inside
`main`. **This test must be red on `develop`**; a green one means it is not reproducing the issue
and is worth nothing.
_Verify:_ the new case fails, and fails for the documented reason (zero `role="status"`, previous
`h1` still on screen) rather than by timeout. Record the observed failure output in the PR.

**Step 3 — Open the channel.**
Add `dehydrate` and `hydrate` to `getRouter()` in `src/router.tsx`, reading and writing
`SHELL_QUERY_KEY` through the Step 1 module, and carrying `shellUpdatedAt` beside the data as
**Architecture** point 2 specifies. Docblock them the way the surrounding options are docblocked —
what the channel is for, the `load-client.js:1088`-before-`:1119` ordering that makes it sound, and
why the server's `dataUpdatedAt` travels rather than being restamped at hydration.
_Verify:_ Step 2's case turns green. `pnpm test` and `pnpm build` green.

**Step 4 — Make the priming outlive five minutes, and make the refresh real.**
Apply Q2 and Q3 in `shellQueryOptions`: `gcTime: Number.POSITIVE_INFINITY` and
`revalidateIfStale: true`, with the reasoning from **Why Q2 + Q3 is a tightening** in the docblock
and a correction to the now-inaccurate comment at `src/routes/_app.tsx:37-41`.
_Verify:_ a unit test over `shellQueryOptions` asserting both fields and the 30-second
`staleTime`. A unit test over `hydrate` asserting that the primed entry's `dataUpdatedAt` is the
value the payload carried and **not** the time of the call — the one assertion that keeps the
thirty-second window honest; `queryClient.getQueryState(SHELL_QUERY_KEY)?.dataUpdatedAt` reads it
back. A browser assertion that a second navigation past the stale mark still renders from cache
without a blocking wait.

**Step 5 — Assert the guard's answer is unchanged, and that nothing leaks into a signed-out
document.**
Two browser assertions, both new:

1. An unauthenticated first client-side navigation to a protected route still lands on `/login`
   with the `redirect` search parameter intact — the guard's observable answer, unchanged by the
   dehydration.
2. An anonymous document (`/` and `/login`) carries **no** session-derived field in its dehydrated
   payload. This is the assertion that pays for touching a module in every visitor's entry chunk.

   The payload is not reachable from a page object: `ssr-server.js:346` serializes it into the
   document with `crossSerializeStream`, so it exists as script text, not as a property a test can
   read. Assert it on the **served document** rather than on the live page — fetch `/` and `/login`
   with the test's request context and search the response body for the signed-out fixture's own
   email and workspace slug, which are the session-derived values that would appear if `dehydrate`
   stopped discriminating. Searching for known-secret values rather than for the field name is what
   makes the assertion survive a rename of `shell`.

   _Verify:_ both green. Assertion 2 must be shown to fail when `dehydrate` returns the shell
   unconditionally — make that edit locally, watch it go red, and revert it; a test that has never
   failed proves nothing about the case it is guarding.

**Step 6 — Reconcile the documents that record the block as permanent, and capture the frames.**
`docs/STATE-INVENTORY.md` §3 and §6 describe this as measured-and-left-alone and name #230;
`e2e/support/states.ts`'s `serverFnIdOf` and `holdServerFns` docblocks describe the freeze as a
property of the application. Both must now say what is true, with this PR named (Q4: the exception
stays, the prose changes). Then capture the frames listed under **Visual change expected** and
attach them to the PR.
_Verify:_ `pnpm generate-spec-index && git diff --exit-code -- .ai/specs/README.md`, then the full
gate in `AGENTS.md` → Validation Commands, then `pnpm e2e`.

### Not in this spec

- Anything #21 shipped: `defaultPendingComponent`, the per-route pending and error shapes, the
  empty-state fixture workspace, `e2e/states.spec.ts`, `--force-state`.
- The `ErrorPanel` ownership move — #208.
- The design-system `Link` routing through a full document load rather than the router
  (`docs/STATE-INVENTORY.md` §3, `src/components/app/dashboard/widget-link.tsx`). It is the reason
  most in-product navigations are document loads and therefore the reason priming covers nearly every
  entry into a client-side navigation, but mounting a `RouterProvider` is a separate capability with
  its own blast radius. It is not filed; filing it is a follow-up this PR should raise.
- Weakening the guard, in any form. ADR 0018 is the record.
