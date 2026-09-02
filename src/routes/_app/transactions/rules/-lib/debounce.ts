/**
 * The one timer between a keystroke and a preview request.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT THREE LINES IN A `useEffect`
 * ---------------------------------------------------------------------------
 *
 * A debounce has exactly one interesting property and it is the one that is easy to get wrong:
 * **the last value must always run**. A version that drops the final state leaves the preview
 * showing the second-to-last rule — a wrong number under a correct rule, which is the single worst
 * thing a preview can display, because it is confidently wrong rather than absent.
 *
 * Written as a plain object over `setTimeout`, it is testable with fake timers in Node and the
 * property is a **counted** one: N calls produce exactly one run, and that run carries the Nth
 * value. A hook would need a DOM to test and would pin the same property less directly.
 *
 * It also matters for the announcement. The preview's counts sit in a polite live region; without
 * the debounce a screen-reader user is read a new number on every keystroke, which is not
 * information, it is noise.
 */

export interface Debouncer<T> {
  /** Replaces any pending value and restarts the clock. */
  readonly schedule: (value: T) => void
  /** Runs the pending value immediately, if there is one. */
  readonly flush: () => void
  /** Forgets the pending value. Called on unmount, so a dead component makes no request. */
  readonly cancel: () => void
}

/** How long the editor waits after the last change before asking the server. */
export const PREVIEW_DEBOUNCE_MS = 400

export function createDebouncer<T>(
  delayMs: number,
  run: (value: T) => void,
): Debouncer<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { readonly value: T } | null = null

  function clear(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function fire(): void {
    // Read and clear before running: `run` may schedule again, and a handler that re-entered a
    // stale `pending` would run the previous value twice.
    const current = pending
    pending = null
    timer = null
    if (current !== null) run(current.value)
  }

  return {
    schedule(value: T): void {
      pending = { value }
      clear()
      timer = setTimeout(fire, delayMs)
    },
    flush(): void {
      clear()
      fire()
    },
    cancel(): void {
      clear()
      pending = null
    },
  }
}
