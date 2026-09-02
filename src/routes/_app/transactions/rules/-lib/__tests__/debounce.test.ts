import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PREVIEW_DEBOUNCE_MS, createDebouncer } from '../debounce'

/**
 * The one property a preview debounce has to keep: **the last value always runs**.
 *
 * Every assertion here is a **count** or an identity, never an elapsed time. A test that measured
 * how long something took would pass on a laptop and flake on a two-core runner, and would be
 * pinning the machine rather than the behaviour.
 */
describe('the preview debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('collapses a burst of keystrokes into one run carrying the last value', () => {
    const seen: Array<string> = []
    const debouncer = createDebouncer<string>(PREVIEW_DEBOUNCE_MS, (value) =>
      seen.push(value),
    )

    for (const value of ['Ż', 'Ża', 'Żab', 'Żabk', 'Żabka']) {
      debouncer.schedule(value)
      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 1)
    }
    expect(seen).toEqual([])

    vi.advanceTimersByTime(1)
    expect(seen).toEqual(['Żabka'])
  })

  it('runs once per settled value, not once per change', () => {
    const seen: Array<number> = []
    const debouncer = createDebouncer<number>(100, (value) => seen.push(value))

    debouncer.schedule(1)
    vi.advanceTimersByTime(100)
    debouncer.schedule(2)
    debouncer.schedule(3)
    vi.advanceTimersByTime(100)

    expect(seen).toEqual([1, 3])
  })

  it('cancel forgets the pending value, so an unmounted editor makes no request', () => {
    const seen: Array<number> = []
    const debouncer = createDebouncer<number>(100, (value) => seen.push(value))

    debouncer.schedule(1)
    debouncer.cancel()
    vi.advanceTimersByTime(1_000)

    expect(seen).toEqual([])
  })

  it('flush runs the pending value now and leaves nothing behind', () => {
    const seen: Array<number> = []
    const debouncer = createDebouncer<number>(100, (value) => seen.push(value))

    debouncer.schedule(7)
    debouncer.flush()
    expect(seen).toEqual([7])

    // A second flush with nothing pending is a no-op rather than a repeat of the last value.
    debouncer.flush()
    vi.advanceTimersByTime(1_000)
    expect(seen).toEqual([7])
  })
})
