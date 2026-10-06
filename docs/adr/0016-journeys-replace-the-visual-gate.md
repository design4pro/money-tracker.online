# 0016. Critical journeys replace the visual gate

Status: accepted
Date: 2026-09-04

## Context

`e2e/visual.spec.ts` photographed seven surfaces in two themes and two locales under two projects
and compared each frame against a committed baseline. That is **56 PNGs, 4,162,897 bytes** in
`e2e/__screenshots__/`, produced by **one `toHaveScreenshot` call site**, gated behind the
`needs-e2e` label so it did not run on most pull requests.

Three things are wrong with it, and they compound.

**A screenshot comparison answers the question nobody is asking.** It asks _did these pixels
change_. Nobody wants to know that. A reviewer wants to know _does this look right_, which is a
judgement no comparator makes, and _does this screen still work_, which a comparator actively
obscures: a suite photographing a 500 page is green the moment the 500 is re-recorded. The gate
could not tell an improvement from a regression, so every diff went to a human anyway - and the
human was shown a diff of a frame rather than the frame.

**The baselines cost more to keep than they caught.** In 109 commits, exactly two ever touched
`e2e/__screenshots__/`, and both recorded frames rather than fixing anything the frames found. The
set was never a net; it was an asset with a maintenance schedule. `docs/SPEC.md` §7.7 records what
that schedule looked like from the inside: moving the suite from the dev server to a build broke
24 frames in one step, and the diff read as a rendering change when it was a calendar change,
because the day-pin travelled with the target rather than with the suite.

**The label made the honest suite optional.** `needs-e2e` existed so a 30-minute job would not run
on every pull request, and it gated the _whole_ browser suite - the journeys, the i18n checks and
the axe run together with the frames. A human deciding whether to spend runner minutes on
photographs was also deciding whether to run the accessibility gate. The expensive half was the
half nobody needed and the cheap half is the half that catches things.

Meanwhile `docs/SPEC.md` §2.10 asks for **zero console errors or warnings** and, at HEAD,
`git grep -c "page.on(" -- e2e/` answers **0**. The clause had no instrument pointed at it. A
React hydration mismatch on a money surface - the server and the client rendering different numbers

- passed this suite in silence while 56 photographs stood guard over antialiasing.

## Decision

**Nothing in this repository or in CI compares a screenshot.**

1. `e2e/visual.spec.ts`, `e2e/support/visual.ts`, all 56 baselines and the `update-snapshots.yml`
   workflow are deleted. `snapshotDir`, `snapshotPathTemplate` and `expect.toHaveScreenshot` leave
   `playwright.config.ts`; `--update-snapshots` and the `snapshotDiff` verdict field leave
   `scripts/agent/validate.sh` and `cez-ladder.sh`.

2. **The visual judgement is a human's, made from the blind pair.** `scripts/visual/capture.mjs`
   already takes it, already pins the clock, and already writes outside the repository. It is now
   the whole of the visual protocol: a ticket declaring `## Visual change expected` gets a note in
   its pull request telling the reviewer to take the pair and look at it. `docs/SPEC.md` §7.4 is
   what enforces it.

3. **The console becomes the net the pixels were.** `e2e/support/console-policy.ts` classifies a
   message and `e2e/support/console.ts` wraps it in an `auto: true` fixture, so a spec importing
   `test` from `./support/console` is watched whether its author thought about the console or not.
   Every `console.error`, every `console.assert`, every `pageerror` and every unmatched
   `console.warn` fails the run. The tolerance table has one entry, it is anchored, and it is
   structurally unable to fire on the surface that gates a merge - `.github/actions/e2e-env`
   serves a production build through `vite preview`, so CI loads hashed `/assets/*` and the entry
   only matches a dev-server URL. `e2e/support/__tests__/console-policy.test.ts` pins that
   asymmetry.

4. **The suite runs on every pull request.** `needs-e2e` is deleted, the `labeled` trigger comes
   off `ci.yml`, and the `e2e` job loses its `if:` entirely. The label vocabulary closes at 18.

## What this costs

**A rendering regression nobody looks at now ships.** That is the honest trade and it should be
written down rather than argued away. The mitigation is not another comparator; it is that §7.4 was
always the real check and is now the only one, so it cannot be skipped on the grounds that CI
covered it.

**A reviewer has to run a command.** `node scripts/visual/capture.mjs` is one line and produces two
frames, but it is a step a label used to perform. A pull request that declares a visual change and
shows no evidence of having taken the pair is incomplete, and the template says so.

## Consequences

- Runner time falls: `globalTimeout` goes 25 → 15 minutes and the job's `timeout-minutes` 30 → 20.
  **How much wall clock this actually saves has not been measured here and is not claimed** - the
  suite has not yet run on this branch under CI.
- `e2e/baseline-day.ts` keeps its name. The constant was never about pixels: it pins the server's
  clock so a count, a total or an empty state does not depend on which evening the suite ran. Its
  docblock now says that instead of naming a baseline set.
- `docs/plans/98-verification-protocol.md` §5 changes meaning rather than number: it was
  "`maxDiffPixelRatio` is never raised" and is now "No screenshot is compared". §6.4's console
  verdict, which named `watchConsole` and `classifyConsoleMessage` before either existed, finally
  has the module it was describing.
- ADR 0003's e2e trigger sentence and ADR 0014's three-PR-label list are amended in place at the
  end of their own records, per ADR 0001's append-only rule.
- `docs/adr/0013-cezar-replaces-sandcastle.md` mourns the loss of `record-baselines.ts`. That loss
  stopped mattering the moment there were no baselines to record; the amendment there says so.

## Amendment, 2026-09-04: the tolerance covers the advisory, not a dev-server URL

Point 3 above claimed the tolerance table was "structurally unable to fire on the surface that
gates a merge", because CI serves a build and the entry matched only a dev-server URL. The first
CI run of this suite falsified that, in both engines at once:

- **chromium** emitted it about `/fonts/inter-latin.woff2` and `/fonts/bricolage-grotesque-latin.woff2`
  - two faces `src/routes/__root.tsx` preloads with `as="font"`, `type="font/woff2"` and
    `crossorigin`, and that `src/styles/tokens.css` then requests by the same absolute path;
- **mobile-safari** emitted it about `/assets/_app-*.js`, `useDrop`, `copy` and `eye-off` - Vite's
  own `modulepreload` hints for route chunks - in WebKit's wording, "preloaded for nothing".

The distribution is what decides the verdict. Of the 133 chromium tests that ran, **131 passed**;
the two that did not were the two longest, and one of them was **flaky** - green on retry. A page that closes
before the browser's few-second timer never hears the advisory at all. The same document, rendered
identically, is green or red depending on how long the test kept it open, which is the signature of
a stopwatch rather than of a defect.

So the class was right and the scope was wrong. The entry now matches the advisory's own sentence
on any resource, and the rule that admits it is stated positively in `console-policy.ts`: a message
the browser's **resource loader** emits about its own bookkeeping, whose arrival depends on how long
the page stayed open rather than on what the page rendered. A timing verdict cannot carry a
correctness one - "you preloaded something and had not used it a few seconds later" is never the
shape a hydration mismatch, a missing key or a 500 arrives in - so widening it does not widen what
the net can miss. Everything the application says stays fatal, and each entry stays anchored at `^`
so a warning that merely quotes one is still fatal.

Whether those four chunks and two faces are preloaded to any purpose is a real performance question.
It is answered by a build measurement, not by a browser advisory that fires on a clock, and it is
not this record's to answer.

One consequence above can now be replaced by numbers rather than a disclaimer, measured on the
first fully green run of this branch: Playwright reported **134 passed in 5.8 minutes** for
chromium and **122 passed in 10.2 minutes** for mobile-safari, inside the 15-minute `globalTimeout`
in both cases. The jobs' wall clocks were 10m29s and 12m03s, inside `timeout-minutes: 20`. The
margin on mobile-safari is the thinner of the two and is the one to watch.

## Amendment 2026-09-15 (a promotion pull request defers to the push run)

Decision 4 has one exception: a `develop` → `main` promotion pull request skips the `e2e` legs, as
it already skipped `verify` and `test`. Its head is the tip of `develop`, `ci.yml` checks out the
head rather than the merge commit, and the push to `develop` has already run every leg on that
commit, so the second run of the same suite on the same code found nothing the first had not. It
held the pool's four CI runners through every promotion.

`e2e · merged report` does not run behind the skipped legs, and a skipped job passes as a required
check, so the promotion stays mergeable on the push run's result. The push to `main` that the merge
creates still runs the whole suite, and `deploy · production` waits for it (amendment 2026-09-15 to
ADR 0003).

## Amendment 2026-09-16 (the legs run in the merge queue)

**Decision 4's "on every pull request" is now "once, in the merge queue".** A pull request runs
`verify` and `test`; the queue runs the legs on the commit it builds and then moves `develop` to,
and the push that follows finds that verdict instead of producing a second one (ADR 0020). What the
legs are, what they cover and the promotion exception above are unchanged - only the event they run
on is.

The reason is the one this record already counted in runner minutes: the same suite ran on the pull
request's merge preview and again on the push its merge created, on four CI runners, and the second
run judged a commit the first could not have tested, because `develop` may have moved in between.
The queue's commit is the one that ships.

What it costs: the journeys report after a human enqueues the pull request, not while it is under
review, and a failure arrives as a dropped queue entry rather than as a red check on the branch.
`validation.commands` does not run them either, so an agent iterating on a pull request never sees
them - `pnpm e2e` locally is the only earlier signal. The alternative, keeping the legs on the pull
request and skipping them in the queue, buys that signal back at the price of verifying a base that
may have moved, and is one `if` per job away.

## Amendment 2026-09-18 (the phone leg runs on chromium)

**The legs are `chromium` and `mobile-chromium`; `mobile-safari` leaves CI (#317).** It was two of
the three legs, sharded because it was the slow one, and the failures it produced were mostly its
own timing: #236 and #295 were `mobile-safari`-only. The project stays in `playwright.config.ts`,
so a change that touches WebKit at phone width runs `pnpm e2e --project=mobile-safari` itself.

`mobile-chromium` (a Pixel 7) is there because the phone width was not the WebKit engine's to keep.
`navigation.spec.ts` reaches the bottom bar only on a phone viewport, and the `*.visual.spec.ts`
panel scans run axe on the project's own `page`, so a matrix of `chromium` alone would have dropped
every case against `bottom-nav.tsx` and every axe scan at phone width. The route scans in
`accessibility.spec.ts` are not among them: `openSurface` opens its own context at Playwright's
default 1280x720 under every project, `mobile-safari` included. The specs that exist to run once
skip it by `isMobile`, as they skip the other engines.

What this costs is WebKit at phone width in the gate: safe-area insets, `100dvh` and momentum
scrolling are now checked when a change asks for them, not on every merge. The measurements behind
one unsharded leg are in the comment above the `e2e` matrix in `ci.yml`.

## Amendment 2026-10-06 (the route scans follow the project's viewport)

**A correction of one sentence in amendment 2026-09-18; the decision it records does not change.**
That amendment says that the route scans in `accessibility.spec.ts` are not among the cases that
need the phone leg, because "`openSurface` opens its own context at Playwright's default 1280x720
under every project, `mobile-safari` included". That is not what the suite does. A context made through the
`browser` fixture, bare `browser.newContext()` included, already receives the running project's
`use` options: viewport, `isMobile` and touch, locale, time zone, colour scheme and the clock-pin
header. `openSurface` therefore scans at the width of the project it runs under, and the 1280x720
in the sentence is the registry default of `Desktop Chrome`, which no browser project scans at.
Measured in #336 (PR #531) with a throwaway probe on Playwright 1.62.1.

The viewports, as the installed registry resolves the `devices[...]` entries that
`playwright.config.ts` spreads:

| Project           | Viewport at scan time | Source in `playwright.config.ts`                       |
| ----------------- | --------------------- | ------------------------------------------------------ |
| `chromium`        | 1440x900              | `Desktop Chrome`, viewport set explicitly              |
| `mobile-chromium` | 412x839               | `Pixel 7`, `isMobile` and touch                        |
| `mobile-safari`   | 393x659               | `iPhone 15`, `isMobile` and touch; leaves CI per 09-18 |

Two of those figures are not the ones the comments in `playwright.config.ts` and the docblocks of
`accessibility.spec.ts` and `e2e/support/surfaces.ts` give. `412x915` and `393x852` are the
registry's `screen` size of the device; the `viewport` a page lays out in is a different, shorter
rectangle. Width, which is what a responsive layout and the bottom bar key on, is the same in both.
Those comments are not this record's to correct and are left as they are.

So under `mobile-chromium` the route scans already ran at phone width: the leg carries the route
scans as well as the bottom-bar and panel cases the 2026-09-18 amendment names, and the reason for
keeping it is stronger than that amendment said.

The evidence is the test `a scan runs at the project's viewport width` in
`e2e/accessibility.spec.ts`, which opens a surface through `openSurface` and asserts that
`window.innerWidth` equals the project's `use.viewport.width`. It holds the outcome rather than the
mechanism, so it goes red the day a scan stops following the project.

The decision stands: the CI legs are `chromium` and `mobile-chromium`, and `mobile-safari` stays out
of CI and in `playwright.config.ts` for a change that asks for WebKit at phone width. The 2026-09-18
text above is left as written.
