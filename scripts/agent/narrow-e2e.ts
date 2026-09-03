/**
 * Re-running the specs a fix was supposed to fix, before re-running all of them.
 *
 * e2e is 60% of the ladder's recorded time - 2h25m of 4h across twelve runs - and the fix loop
 * pays for it in full on every attempt, to learn something the failing specs alone could have
 * said. Narrowing that re-run with Playwright's `-g` turns a ~190 s rung into seconds while the
 * fix is still wrong, which is the common case: five of the recorded issues went red on two or
 * three consecutive attempts.
 *
 * The invariant that makes this safe is not "the narrowed run is accurate". It is that a narrowed
 * run may only ever SHORTEN THE PATH TO RED. Its green means "the specs that failed now pass",
 * which is not the same claim as "the branch is green" - a fix that repairs one spec and breaks
 * another would pass it - so `main.ts` never lets a narrowed run decide green, and never trusts a
 * red it cannot substantiate with spec names. What is left is a cheap early exit for the case the
 * loop hits most: the fix did not work, and the full suite would have spent three minutes saying
 * so.
 *
 * Kept out of `main.ts` for the reason `adopt.ts` is: the decisions here are string handling with
 * sharp edges - regex metacharacters in a test title, a quote reaching a shell - and they are worth
 * testing without a run.
 */

/** The shape `validate.sh` reports per failing spec; only the title matters here. */
export interface E2eFailure {
  readonly title: string
}

/**
 * Above this many failing specs, narrowing buys nothing: the regex grows past legibility and the
 * suite is broadly red anyway, which is the case where the full run is the informative one.
 */
export const MAX_NARROWED_SPECS = 10

/** Every character `-g` would read as syntax rather than as text. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The `-g` pattern for the next attempt, or `''` for "run the whole suite".
 *
 * Empty when the previous verdict named no specs - which is also what an e2e rung that never ran
 * looks like, since the ladder stops at the first red step, so a red vitest correctly asks for the
 * full ladder next time rather than for a narrowed e2e.
 *
 * Titles are matched as literal substrings of Playwright's full test name: unanchored, because the
 * reported title is the innermost one while `-g` sees the file and describe blocks in front of it.
 */
export function narrowedGrep(failed: ReadonlyArray<E2eFailure>): string {
  if (failed.length === 0 || failed.length > MAX_NARROWED_SPECS) return ''
  const titles = [
    ...new Set(failed.map((f) => f.title).filter((title) => title !== '')),
  ]
  if (titles.length === 0) return ''
  return titles.map(escapeRegExp).join('|')
}

/**
 * One shell word, whatever the text contains.
 *
 * The pattern is built from test titles, which are repo-authored but arbitrary - an apostrophe in
 * "the trip's tab is remembered" is enough - and it is interpolated into the command string
 * `sandbox.exec` hands to a shell. Single quotes suspend every expansion the shell has; the only
 * character they cannot carry is the single quote, which is closed, escaped and reopened.
 */
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`
}
