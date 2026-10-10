/**
 * What day the server thinks it is, and the one place that decides.
 *
 * Every date-driven answer this product gives is a comparison between a stored day and *today*:
 * which budget period is open and how far through it we are, whether a recurring period is
 * upcoming or overdue, which month the dashboard opens on, what an account's balance is as of.
 * Before this module there were four identical `new Date().toISOString().slice(0, 10)` helpers -
 * in `fns/budgets`, `fns/goals`, `fns/recurring` and `repos/accounts` - each with a docblock
 * claiming that `today` was decided there and only there. Four owners of one concept is the
 * failure `docs/SPEC.md` §8 names, and the second implementation is the defect, not the duplicate.
 *
 * The day is UTC, matching `booked_on`'s own definition in `docs/MONEY.md` §6.1. The reader's
 * timezone is applied at render and only there: a day bucket that shifted with the viewer would
 * put the same transaction in two different months for two people looking at one workspace.
 *
 * ## The development-only pin, and why the browser suite cannot work without it
 *
 * The seed is anchored to a constant (`ANCHOR` in `scripts/seed/seed.mjs`) and reads no clock, so
 * the fixture itself never moves. The *comparison* does. Left to the wall clock, the relationship
 * between the fixture and today advances every midnight, and with it every budget bar, every due
 * badge and the month the dashboard lands on - so a spec that asserts a count, a total or an empty
 * state passes one evening and fails the next morning. A row leaving a list moves everything below
 * it.
 *
 * So a development request may name the day, and `x-mt-server-today` is how. Both browser projects
 * in `playwright.config.ts` send it on every request their context makes - the SSR document and the
 * server-function RPCs that follow it - so the whole render agrees about the day. This is the
 * contract `docs/plans/98-verification-protocol.md` §2.4 has specified all along.
 *
 * The guard is `import.meta.env.DEV`, which the production build folds to `false` and drops the
 * branch behind, so the header is inert against anything but a dev server. That is deliberate and
 * load-bearing rather than defensive: a header that could move the server's idea of today in
 * production is a header that can be used to read a budget period that has not opened yet.
 *
 * ## The second pin, which exists because the first one cannot follow the gate
 *
 * CI stopped serving the browser suite from `pnpm dev` - a dev server compiles the client graph per
 * route on first visit and that cost 69% of the suite's wall clock - so the gate now photographs a
 * build, where the branch above no longer exists. A screenshot of a screen that reads a clock still
 * has to be reproducible, so the day arrives the one way that keeps the property intact: folded in
 * at compile time by `vite.config.ts`, not accepted from a request.
 *
 * `__E2E_SERVER_TODAY__` is a Vite `define`. With `E2E_BUILD` unset it is replaced by the literal
 * `undefined`, the comparison below reads `undefined !== undefined`, and the branch is eliminated
 * from the bundle exactly as the header branch is. So the deployed worker has no second way to be
 * told what day it is - not a header, not a variable, not a flag - and the guarantee the paragraph
 * above describes is unchanged. What differs is only which artefact carries the pin: a bundle CI
 * builds for itself and never deploys.
 */

import { getRequestHeader } from '@tanstack/react-start/server'

/** The header a development request may pin the day with. Mirrored in `playwright.config.ts`. */
const SERVER_TODAY_HEADER = 'x-mt-server-today'

/** `YYYY-MM-DD`, and nothing else. A malformed pin is ignored rather than trusted. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The day an end-to-end build was compiled to believe in, or nothing at all everywhere else.
 *
 * Declared here rather than in a global `.d.ts` so the only file that may read it is the only file
 * that knows what it means. `vite.config.ts` replaces the identifier textually; nothing imports it.
 *
 * It is read through `typeof` because in one runner the identifier is not merely undefined, it is
 * **absent**: `vitest.config.ts` is a separate config and does not inherit `vite.config.ts`'s
 * `define`, so a bare reference is a `ReferenceError` rather than a falsy value - which is how 57
 * repository tests went red the first time this was written without it. `typeof` also keeps the
 * elimination: with the define in place the expression folds to a constant either way, and a plain
 * build carries neither the identifier nor the date.
 */
declare const __E2E_SERVER_TODAY__: string | undefined

/**
 * Today, as a UTC calendar date.
 *
 * An end-to-end build carries its day compiled in; under `pnpm dev` an `x-mt-server-today` header
 * wins; everywhere else, and always in production, this is the wall clock.
 */
export function serverToday(): string {
  if (typeof __E2E_SERVER_TODAY__ === 'string') return __E2E_SERVER_TODAY__
  if (import.meta.env.DEV) {
    const pinned = pinnedDay()
    if (pinned !== null) return pinned
  }
  return new Date().toISOString().slice(0, 10)
}

/** The furthest ahead of UTC any civil clock runs (Line Islands, Kiribati: UTC+14). */
const MAX_UTC_OFFSET_MS = 14 * 60 * 60 * 1000

/**
 * The latest calendar date it is, anywhere on Earth, at `now`.
 *
 * The ceiling for a booking date the server will accept. It is **not** {@link serverToday} plus a
 * day: `serverToday()` carries no hour, so "+1 day" would accept a date that has begun nowhere on
 * Earth for about ten hours of every UTC day. And it is not `serverToday()` itself, which would
 * refuse the own-today of a person in UTC+13 or UTC+14 for the hours their date is ahead of UTC's.
 *
 * Pure in `now`; the wall clock is read only by the default argument, so it is read when a schema
 * parses and never when the module loads. It ignores the development pins on purpose: a pinned
 * day moves a comparison, and this guard exists to refuse a date the real world has not reached.
 */
export function latestCalendarDayOnEarth(now: Date = new Date()): string {
  return new Date(now.getTime() + MAX_UTC_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * The pinned day, when there is a request carrying one.
 *
 * The `try` is not defensive padding. `getRequestHeader` reads an async-local store that only
 * exists while a request is being served, and this module is reached from paths where there is no
 * request at all - the cron handler, and any unit test that imports a repository. Letting it throw
 * would turn "nobody pinned anything" into a failed job.
 */
function pinnedDay(): string | null {
  try {
    const value = getRequestHeader(SERVER_TODAY_HEADER)
    return value !== undefined && ISO_DAY.test(value) ? value : null
  } catch {
    return null
  }
}
