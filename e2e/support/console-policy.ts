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
 * **The single entry cannot fire on the surface that gates a merge, and that is the point.**
 * `.github/actions/e2e-env/action.yml` serves a production build through `vite preview`, so in CI
 * the document loads hashed `/assets/*` and nothing else. The pattern below only matches a URL a
 * *development* server publishes — `/src/…` is the source tree, anything under `/@` is one of
 * Vite's own namespaces (`/@vite/`, `/@id/`, `/@fs/`, `/@react-refresh`), `/node_modules/…` is an
 * unbundled dependency — on a loopback host with a port. So the tolerance exists for the local
 * `pnpm e2e` path against `pnpm dev`, and the bar CI holds is the absolute one.
 *
 * That asymmetry is deliberate and is the rule for anything added here: an entry earns its place by
 * being something the *engine* says, on the dev-server path, that a built application cannot
 * produce. An entry that could fire in CI is the application talking, and the fix is the
 * application.
 *
 * Nothing has yet been observed to fire this in this repository. It is here because the same
 * advisory is a known Vite dev-server behaviour and a developer meeting it should find the reason
 * written down rather than a red suite; if it turns out never to fire, deleting it costs nothing.
 */
export const TOLERATED_CONSOLE_WARNINGS: readonly ToleratedConsoleWarning[] = [
  {
    why:
      "the browser's resource loader reporting that a Vite dev-server URL was speculatively " +
      'preloaded and not used — a path that exists only under `pnpm dev`, never in the build CI ' +
      'serves, and a warning whose arrival depends on how long the page stayed open rather than ' +
      'on what the page rendered',
    match:
      /^The resource https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/(?:src\/|node_modules\/|@)\S* was preloaded using link preload but not used within a few seconds from the window's load event\./,
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
