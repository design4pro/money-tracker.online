/**
 * Which console output fails a run, and which the browser is merely muttering.
 *
 * Split out of the fixture so it can be exercised without a browser: nothing here imports
 * Playwright, so the tolerance table and the classifier are reachable from the vitest `tooling`
 * project. `./console.ts` re-exports the whole surface, so a spec never needs both imports.
 *
 * `docs/SPEC.md` §2.10 asks for **zero console errors or warnings**. Until ADR 0016 nothing in this
 * repository enforced that: the browser suite never attached a listener, so the clause was a
 * statement of intent with no instrument pointed at it. This module is the instrument.
 */

/** Where one console message lands: fails the run, is let through, or is noise. */
export type ConsoleVerdict = 'fatal' | 'tolerated' | 'ignored'

/** One narrowly-scoped exception to "a warning fails the run". */
export interface ToleratedConsoleWarning {
  /** Why this is the browser talking rather than the application. */
  readonly why: string
  readonly match: RegExp
}

/** Which console output failed the run, and which was deliberately let through. */
export interface ConsoleReport {
  readonly fatal: readonly string[]
  readonly tolerated: readonly string[]
}

/**
 * The complete list of console warnings a spec does not fail on.
 *
 * Everything not matched here stays fatal, on every route, with no exception:
 *
 * - every `pageerror`, which is an uncaught exception;
 * - every `console.error`, React's included;
 * - every `console.assert`;
 * - every `console.warn` not matched below — which is every React hydration and key warning, every
 *   deprecation notice, every failed-resource warning, and anything the application writes itself.
 *
 * Message types this suite has never read — `log`, `info`, `debug`, `trace` — stay ignored.
 *
 * A React hydration report cannot reach this list at all: React 19 surfaces a mismatch as an
 * uncaught error through `window.reportError` and, in development, as a `console.error`, and
 * `classifyConsoleMessage()` answers `fatal` for both before the table is consulted. A
 * warning-only tolerance is structurally incapable of swallowing one.
 *
 * ## What earns a place here
 *
 * One thing only: **a message the browser's own resource loader emits about its own bookkeeping,
 * whose arrival depends on how long the page stayed open rather than on what the page rendered.**
 * Anything the application says - a React warning, a deprecation, a failed request, a thrown error
 * - is the application talking, and the fix is the application, not this array.
 *
 * That test is narrower than it sounds, because a timing verdict cannot carry a correctness one.
 * "You preloaded something and had not used it a few seconds later" is true or false about the
 * clock; it is never the shape a hydration mismatch, a missing key or a 500 arrives in. Each entry
 * is anchored at `^` and matches the advisory's whole sentence, so a warning that merely quotes one
 * is still fatal.
 *
 * ## The entry below was widened once, and the reason is measured
 *
 * It first shipped restricted to a Vite dev-server URL, on the reasoning that CI serves a
 * production build through `vite preview` and therefore could not produce it. **The first CI run of
 * this suite falsified that**, in both engines at once:
 *
 * - chromium said it about `/fonts/inter-latin.woff2` and `/fonts/bricolage-grotesque-latin.woff2`,
 *   which `src/routes/__root.tsx` preloads correctly - `as="font"`, `type="font/woff2"`,
 *   `crossorigin` - and `src/styles/tokens.css` then asks for by the same absolute path;
 * - mobile-safari said it about `/assets/_app-*.js`, `useDrop`, `copy` and `eye-off`, which are
 *   Vite's own `modulepreload` hints for route chunks, in its own wording ("preloaded for nothing").
 *
 * The distribution is what settles it. Of the 133 chromium tests that ran, **131 passed**, and the
 * two that did not were the two longest - one of them **flaky**, green on retry. A page that closes before the
 * browser's few-second timer never hears the advisory at all, which is the signature of a clock,
 * not of a defect: the same document, rendered identically, is green or red depending on how long
 * the test kept it open.
 *
 * So the scope was wrong and the class was right. Whether those four chunks and two faces are
 * preloaded to any purpose is a real performance question and it is not this file's - the answer
 * lives in a build measurement, not in a browser advisory that fires on a stopwatch.
 */
export const TOLERATED_CONSOLE_WARNINGS: readonly ToleratedConsoleWarning[] = [
  {
    why:
      "the browser's resource loader reporting that something was speculatively preloaded and " +
      'not used within a few seconds - a stopwatch verdict emitted by chromium and WebKit alike, ' +
      "about the framework's own build output as readily as about the document shell, and one " +
      'whose arrival depends on how long a test kept the page open',
    // The sentence is identical in both engines; only the advice after it differs, so the pattern
    // stops before it. `\S+` keeps the URL from swallowing the rest of an unrelated message.
    match:
      /^The resource \S+ was preloaded using link preload but not used within a few seconds from the window's load event\./,
  },
]

/** Where one console message lands. `type` is Playwright's `ConsoleMessage.type()`. */
export function classifyConsoleMessage(message: {
  readonly type: string
  readonly text: string
}): ConsoleVerdict {
  if (message.type === 'error' || message.type === 'assert') return 'fatal'
  if (message.type !== 'warning') return 'ignored'
  return TOLERATED_CONSOLE_WARNINGS.some((rule) =>
    rule.match.test(message.text),
  )
    ? 'tolerated'
    : 'fatal'
}

/**
 * The failure message a spec sees, or `undefined` when the run was clean.
 *
 * Built here rather than in the fixture so its exact wording is asserted by a unit test: a message
 * that does not name the offending text is a red run somebody has to reproduce locally to read.
 */
export function describeConsoleFailure(
  report: ConsoleReport,
): string | undefined {
  if (report.fatal.length === 0) return undefined
  const lines = report.fatal.map((entry) => `  - ${entry}`).join('\n')
  const tolerated =
    report.tolerated.length === 0
      ? ''
      : `\n\n${String(report.tolerated.length)} tolerated warning(s) were let through; see TOLERATED_CONSOLE_WARNINGS.`
  return (
    `The browser wrote ${String(report.fatal.length)} console message(s) this run. ` +
    `docs/SPEC.md §2.10 asks for zero.\n\n${lines}${tolerated}`
  )
}
