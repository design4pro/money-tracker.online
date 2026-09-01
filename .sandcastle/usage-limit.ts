/**
 * Waiting out a Claude usage limit instead of dying on it.
 *
 * When the subscription's session limit is reached, the agent CLI exits non-zero and the library
 * turns that into an `AgentError` whose message carries the CLI's own words:
 *
 *     claude-code exited with code 1:
 *     You've hit your session limit · resets 12:20am (UTC)
 *
 * Inside `workIssue` that rejection is caught by `Promise.allSettled` and costs one issue. At the
 * top level — planner, merger, auditor — it is an uncaught exception that kills the whole loop
 * mid-flight, which is how a run once ended with three issue branches cut and empty and its
 * merged work stranded, unpushed, on the operator's disk. Neither outcome is right: a usage limit
 * is not a failure, it is a wait.
 *
 * The matching is on the message text, not `instanceof`. `AgentError` is not exported from the
 * library's public surface, and what actually reaches a `catch` is Effect's `FiberFailure` wrapper
 * around it — binding to either would be a dependency on a private shape that a patch release is
 * free to change. A string that says "the agent exited and the reason it gave was a limit" is the
 * stable part.
 */

import { setTimeout as delay } from 'node:timers/promises'

import { recordStage, tokensOf } from './stage-log'

/** What the agent said about the limit it hit. */
export interface UsageLimit {
  /** When the limit lifts. */
  readonly resetsAt: Date
  /** False when no reset time could be read and `resetsAt` is the fallback guess. */
  readonly precise: boolean
}

/** No reset time in the message: wait this long and ask the API again rather than give up. */
export const BLIND_WAIT_MS = 60 * 60 * 1000

/** Come back after the reset, not on it — a clock a minute fast would spend the retry for nothing. */
export const WAKE_MARGIN_MS = 60 * 1000

/**
 * Longest single wait. Past this the run stops and the operator resumes it later with
 * `pnpm sandcastle --run <full id>`, which costs nothing: the work is on the branches.
 */
const MAX_WAIT_MS = Number(
  process.env.SANDCASTLE_LIMIT_WAIT_MAX_MS ?? 6 * 60 * 60 * 1000,
)

/** Consecutive waits one stage may sit through before the error is allowed to stand. */
const MAX_WAITS_PER_STAGE = 3

/** It came from an agent process, not from git, the coordinator or our own code. */
const AGENT_EXIT = /exited with code \d+/

/** …and the reason it gave was a limit rather than a bug. */
const LIMIT_REASONS = [
  /hit your (?:session|usage) limit/i,
  /usage limit reached/i,
  /rate.?limit/i,
  /\b429\b/,
]

/** `resets 12:20am (UTC)` — a wall clock, which is what the CLI prints today. */
const RESETS_AT_CLOCK = /resets\s+(\d{1,2}):(\d{2})\s*(am|pm)\s*\(UTC\)/i

/** `Claude AI usage limit reached|1756612800` — the older, unambiguous form. */
const RESETS_AT_EPOCH = /usage limit reached\|(\d{10,})/

function messageOf(error: unknown): string {
  if (error instanceof Error) return `${error.message}\n${error.stack ?? ''}`
  return String(error)
}

/**
 * The next moment the UTC wall clock reads `hour:minute`, strictly after `now`.
 *
 * `12:xxam` is midnight and `12:xxpm` is noon — the one mapping a naive `hour % 12` gets backwards,
 * and the exact one the observed message used.
 */
function nextUtcTime(
  now: Date,
  hour12: number,
  minute: number,
  meridiem: string,
): Date {
  const hour = (hour12 % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0)
  const at = new Date(now)
  at.setUTCHours(hour, minute, 0, 0)
  if (at.getTime() <= now.getTime()) at.setUTCDate(at.getUTCDate() + 1)
  return at
}

/**
 * Is this error a usage limit, and when does it lift?
 *
 * Both halves must match. An agent that exited non-zero because the build broke is a real failure
 * and must stay one; a message that merely mentions rate limits — a stack trace through an HTTP
 * client, an issue body quoted into a prompt — did not come from an agent exiting.
 */
export function parseUsageLimit(
  error: unknown,
  now: Date,
): UsageLimit | undefined {
  const message = messageOf(error)
  if (!AGENT_EXIT.test(message)) return undefined
  if (!LIMIT_REASONS.some((reason) => reason.test(message))) return undefined

  const clock = RESETS_AT_CLOCK.exec(message)
  if (clock !== null) {
    return {
      resetsAt: nextUtcTime(now, Number(clock[1]), Number(clock[2]), clock[3]!),
      precise: true,
    }
  }

  const epoch = RESETS_AT_EPOCH.exec(message)
  if (epoch !== null) {
    return { resetsAt: new Date(Number(epoch[1]) * 1000), precise: true }
  }

  // A limit we recognise but cannot time. Guessing an hour is strictly better than ending the run:
  // if the limit is still up when we come back, this simply happens again.
  return { resetsAt: new Date(now.getTime() + BLIND_WAIT_MS), precise: false }
}

/**
 * The wait itself, shared by every stage in flight.
 *
 * Two issue pipelines run at once and both hit the same limit within seconds of each other. One
 * timer, one log line, one wake-up: the second caller joins the first one's wait rather than
 * starting its own and hammering the same closed door on its own schedule.
 *
 * The timer deliberately belongs to no caller. Each stage carries its own `AbortSignal` — the
 * coordinator revokes a lease per issue, not per run — so binding the shared timer to whichever
 * stage happened to arrive first would make one issue's revocation abort a wait that others are
 * standing in. Callers watch their own signal against the shared timer instead, and the timer is
 * cancelled once the last of them has left.
 */
interface SharedWait {
  /** Resolves when the window is over. Never rejects: cancelling is not a caller's failure. */
  readonly done: Promise<void>
  /** Stops the timer when the last waiter leaves, so an all-aborted run does not idle for hours. */
  readonly cancel: AbortController
  waiters: number
}

let pending: SharedWait | undefined

/**
 * `promise`, but losing a race against `signal` — with the signal's own reason, so the caller sees
 * why its lease went rather than a timeout it never hit.
 */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason)
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort)
    })
  })
}

interface Clock {
  readonly now: () => Date
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
}

const REAL: Clock = {
  now: () => new Date(),
  sleep: async (ms, signal) => {
    await delay(ms, undefined, { signal })
  },
}

/**
 * Runs `thunk`, waiting out any usage limit it hits and then running it again.
 *
 * Retrying re-runs the stage from the top rather than resuming its agent session: the commits it
 * already made are on the branch and the prompts all start by reading the branch, so this is the
 * same semantics as resuming the whole run, only cheaper. Anything that is not a usage limit is
 * rethrown untouched — masking a real failure is the one thing this must never do.
 */
export async function withUsageLimit<T>(
  /** The stage's name, for the log line the operator will read hours later. */
  label: string,
  thunk: () => Promise<T>,
  options: {
    signal?: AbortSignal
    clock?: Clock
    /** What the timeline should say about this stage beyond its label. */
    meta?: StageMeta
  } = {},
): Promise<T> {
  const clock = options.clock ?? REAL
  const startedAt = clock.now().getTime()
  // Accumulated across every window this stage sits through, so `workMs` below is the time the
  // agent was actually running — the one number that tells a slow stage from a throttled one.
  let waitMs = 0

  const done = (
    outcome: 'ok' | 'error' | 'aborted',
    waits: number,
    extra: { error?: string; result?: unknown },
  ): void => {
    const endedAt = clock.now().getTime()
    const wallMs = endedAt - startedAt
    recordStage({
      kind: 'stage',
      label,
      issue: options.meta?.issue,
      attempt: options.meta?.attempt,
      model: options.meta?.model,
      effort: options.meta?.effort,
      startedAt,
      endedAt,
      wallMs,
      waitMs,
      workMs: wallMs - waitMs,
      waits,
      outcome,
      error: extra.error,
      tokens: tokensOf(extra.result),
    })
  }

  for (let waits = 0; ; waits++) {
    try {
      const result = await thunk()
      done('ok', waits, { result })
      return result
    } catch (error) {
      const limit = parseUsageLimit(error, clock.now())
      if (limit === undefined) {
        done(options.signal?.aborted === true ? 'aborted' : 'error', waits, {
          error: describe(error),
        })
        throw error
      }
      if (waits >= MAX_WAITS_PER_STAGE) {
        console.error(
          `  ! ${label}: usage limit hit ${waits + 1} times in a row — giving up rather than looping.`,
        )
        done('error', waits, { error: describe(error) })
        throw error
      }
      // Timed here rather than inside `waitForReset`, which can leave by throwing — a revoked
      // lease, or a window past SANDCASTLE_LIMIT_WAIT_MAX_MS — and a `return` after its `finally`
      // would never run in that case, losing the very minutes this is counting.
      const windowStart = clock.now().getTime()
      try {
        await waitForReset(
          label,
          limit,
          clock,
          options.signal,
          options.meta?.issue,
        )
      } catch (interrupted) {
        waitMs += clock.now().getTime() - windowStart
        // Either way this stage is over, and the timeline should still say how much of it was
        // spent waiting before that happened.
        done(options.signal?.aborted === true ? 'aborted' : 'error', waits, {
          error: describe(interrupted),
        })
        throw interrupted
      }
      waitMs += clock.now().getTime() - windowStart
    }
  }
}

/** What the timeline knows about a stage that its label does not carry. */
export interface StageMeta {
  readonly issue?: string
  readonly attempt?: number
  readonly model?: string
  readonly effort?: string
}

/** One line of the failure, short enough to keep the NDJSON readable. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n')[0]!.slice(0, 300)
}

async function waitForReset(
  label: string,
  limit: UsageLimit,
  clock: Clock,
  signal?: AbortSignal,
  issue?: string,
): Promise<void> {
  const startedAt = clock.now().getTime()
  // Nothing to wait for if this stage has already lost its issue: the retry would run an agent on
  // work another machine may hold by the time we wake.
  signal?.throwIfAborted()

  let wait = pending
  const joined = wait !== undefined
  if (wait === undefined) {
    const ms = limit.resetsAt.getTime() - clock.now().getTime() + WAKE_MARGIN_MS
    if (ms > MAX_WAIT_MS) {
      throw new Error(
        `Usage limit resets at ${limit.resetsAt.toISOString()}, ${Math.round(ms / 60_000)} minutes away — ` +
          `longer than SANDCASTLE_LIMIT_WAIT_MAX_MS (${Math.round(MAX_WAIT_MS / 60_000)} minutes). ` +
          `Resume this run after the reset with \`pnpm sandcastle --run <run id>\`; its work is on its branches.`,
      )
    }

    // Loud on purpose. A silent process is indistinguishable from a hung one, and this one also
    // holds its coordinator leases for the whole wait — the heartbeat keeps ticking, so other
    // machines stay locked out of these issues until it wakes. A resume needs that, visibly.
    console.log(
      `\n  ⏸ ${label}: usage limit. Waiting ${Math.max(1, Math.round(ms / 60_000))} min, until ` +
        `${limit.resetsAt.toISOString()}${limit.precise ? '' : ' (guessed — no reset time in the message)'}. ` +
        `This run keeps its issues claimed while it waits.`,
    )

    const cancel = new AbortController()
    wait = {
      waiters: 0,
      cancel,
      // Swallowed because the only thing that aborts this timer is the last waiter leaving, and
      // that is a cancellation nobody is left to hear.
      done: clock.sleep(Math.max(0, ms), cancel.signal).catch(() => {}),
    }
    pending = wait
  } else {
    console.log(
      `  … ${label}: usage limit — joining the wait already in flight`,
    )
  }

  wait.waiters++
  try {
    await abortable(wait.done, signal)
  } finally {
    wait.waiters--
    if (wait.waiters === 0) {
      if (pending === wait) pending = undefined
      // A no-op once the timer has fired; what it stops is the case where every waiter walked away.
      wait.cancel.abort()
    }
    // In the `finally`, so an aborted lease still leaves the window it sat in on the record —
    // otherwise the stage's own `waitMs` would be the only trace and `joined` would be lost.
    const endedAt = clock.now().getTime()
    recordStage({
      kind: 'wait',
      label,
      issue,
      startedAt,
      endedAt,
      ms: endedAt - startedAt,
      joined,
      precise: limit.precise,
      resetsAt: limit.resetsAt.getTime(),
    })
  }
  console.log(`  ▶ ${label}: limit window over — retrying.`)
}

/** Test seam: the gate is module state, and each test needs it empty and its timer stopped. */
export function resetUsageLimitGate(): void {
  pending?.cancel.abort()
  pending = undefined
}
