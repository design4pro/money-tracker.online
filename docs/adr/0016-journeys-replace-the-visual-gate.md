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
