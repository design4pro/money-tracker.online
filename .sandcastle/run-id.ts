/**
 * Which run this invocation is.
 *
 * The run id is the only thing a run owns end to end: its integration branch `sandcastle/run-<id>`,
 * its issue branches, its artifact directory and its lock all key on it. Same id = same run =
 * resume; a new id is a run that shares nothing. That makes "what is this run called" a decision
 * worth naming once, in one place, rather than three regexes inline in the startup sequence.
 *
 * Two shapes are accepted, and the difference between them is the day:
 *
 * - `--run 2` — run 2 of TODAY. What an operator resuming a run they started this morning types.
 * - `--run 20260830-4` — run 4 of the 30th, whenever "now" happens to be. Without this, a run that
 *   died overnight is unreachable the next morning: the id would be rebuilt from today's date, so
 *   `--run 4` would cut a fresh branch and a fresh worktree and leave the previous day's committed,
 *   validated, unpushed work orphaned on disk.
 *
 * Allocation (no `--run` at all) is deliberately only ever about today. A bare `pnpm sandcastle` is
 * always a NEW run that shares nothing, so resuming stays something the operator asks for by name.
 */

/** A resolved run id, split into the parts the lock loop needs. */
export interface ResolvedRun {
  /** `YYYYMMDD`. Today's date unless the operator named another day. */
  readonly day: string
  /** The number to start looking for a free lock at. */
  readonly number: string
  /**
   * Did the operator name this run? It decides what a live lock means: an explicit id belongs to
   * one run and a conflict is an error, whereas an allocated one may simply walk to the next
   * number.
   */
  readonly explicit: boolean
}

const NUMBER = /^[1-9][0-9]*$/
const FULL_ID = /^([0-9]{8})-([1-9][0-9]*)$/
/** A full id with the run number dropped — `--run 20260830`. See the guard below. */
const DAY_ONLY = /^[0-9]{8}$/

export function resolveRun(
  /** The `--run` value, or `SANDCASTLE_RUN`. Empty allocates. */
  requested: string,
  /** Today, as `YYYYMMDD` — injected so this is testable without a clock. */
  today: string,
  /** Run numbers already cut today, ascending. Only consulted when allocating. */
  takenToday: ReadonlyArray<number>,
): ResolvedRun {
  if (requested === '') {
    return {
      day: today,
      number: String((takenToday.at(-1) ?? 0) + 1),
      explicit: false,
    }
  }

  // Checked before the plain-number branch, which would otherwise swallow it: eight digits is a
  // valid `[1-9][0-9]*`, so `--run 20260830` — a full id with the run number forgotten — would
  // quietly become run twenty-million-odd OF TODAY, on a branch that resembles nothing. The one
  // mistake this shape invites has to cost a startup error.
  if (DAY_ONLY.test(requested)) {
    throw new Error(
      `--run takes a run number or a full run id. ${requested} names a day but no run on it — ` +
        `did you mean \`--run ${requested}-1\`?`,
    )
  }

  if (NUMBER.test(requested)) {
    return { day: today, number: requested, explicit: true }
  }

  const full = FULL_ID.exec(requested)
  if (full === null) {
    throw new Error(
      `--run takes a run number or a full run id (got ${JSON.stringify(requested)}). ` +
        `Examples: \`pnpm sandcastle --run 2\` for run 2 of today, ` +
        `\`pnpm sandcastle --run ${today}-2\` for run 2 of a named day.`,
    )
  }

  const day = full[1]!
  const number = full[2]!
  // A day that has not happened is always a typo, and it is the one typo that costs something: it
  // would cut a run whose branch `runNumbersToday()` never lists, so tomorrow's allocation would
  // hand out the same number again and two runs would share one integration branch. A past day that
  // never existed is harmless by comparison — it just starts from `origin/develop` like any new run.
  if (day > today) {
    throw new Error(
      `--run ${requested} names ${day}, which is after today (${today}). ` +
        `A run id can only name a day that has already started.`,
    )
  }

  return { day, number, explicit: true }
}
