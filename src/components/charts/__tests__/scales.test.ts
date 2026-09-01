import { describe, expect, it } from 'vitest'

import {
  bandLayout,
  linearProjector,
  niceDomain,
  percentagesOf,
  thinIndices,
  ticksFor,
} from '../scales'

describe('niceDomain', () => {
  it('rounds a 0–100 range outwards to round numbers', () => {
    expect(niceDomain([0, 37, 94])).toEqual([0, 100])
  })

  it('keeps a small integer range integral rather than splitting it into halves', () => {
    const domain = niceDomain([0, 1, 3])
    expect(domain[0]).toBe(0)
    expect(ticksFor(domain, 4).every(Number.isInteger)).toBe(true)
  })

  it('spans zero when the readings do, so the zero rule lands inside the plot', () => {
    const [low, high] = niceDomain([-4200, 1500])
    expect(low).toBeLessThan(0)
    expect(high).toBeGreaterThan(0)
  })

  it('never produces a zero-height domain for a single reading', () => {
    const [low, high] = niceDomain([5000], { baseline: 'data' })
    expect(high).toBeGreaterThan(low)
  })

  it('never produces a zero-height domain for a flat series at zero', () => {
    const [low, high] = niceDomain([0, 0, 0], { baseline: 'data' })
    expect(high).toBeGreaterThan(low)
  })

  it('ignores gaps rather than counting them as zero', () => {
    expect(
      niceDomain([9000, null, 9500], { baseline: 'data' })[0],
    ).toBeGreaterThan(0)
  })

  it('answers a usable domain when there is nothing to draw at all', () => {
    const [low, high] = niceDomain([])
    expect(high).toBeGreaterThan(low)
  })

  it('includes zero by default, so a bar chart cannot start at its own minimum', () => {
    expect(niceDomain([8000, 9000])[0]).toBe(0)
  })
})

describe('linearProjector', () => {
  it('maps the domain onto an inverted pixel range', () => {
    const project = linearProjector([0, 100], [200, 0])
    expect(project(0)).toBe(200)
    expect(project(100)).toBe(0)
    expect(project(50)).toBe(100)
  })
})

describe('bandLayout', () => {
  it('leaves a gap between neighbouring bands and centres each one', () => {
    const band = bandLayout(4, 400)
    expect(band.band).toBeLessThan(band.step)
    expect(band.centre(0)).toBeCloseTo(band.at(0) + band.band / 2)
    expect(band.at(3)).toBeGreaterThan(band.at(0))
  })

  it('survives an empty axis without dividing by zero', () => {
    expect(Number.isFinite(bandLayout(0, 400).band)).toBe(true)
  })
})

describe('thinIndices', () => {
  it('keeps every label when they all fit', () => {
    expect(thinIndices(4, 7)).toEqual([0, 1, 2, 3])
  })

  it('always keeps the first and the last', () => {
    const kept = thinIndices(31, 5)
    expect(kept.at(0)).toBe(0)
    expect(kept.at(-1)).toBe(30)
    expect(kept.length).toBeLessThanOrEqual(6)
  })
})

describe('percentagesOf', () => {
  it('sums to exactly 100 where independent rounding would sum to 99', () => {
    // Three equal thirds: 33.33 each. Rounded independently that is 33 + 33 + 33 = 99.
    const shares = percentagesOf([1, 1, 1])
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100)
    expect(shares).toEqual([34, 33, 33])
  })

  it('gives the extra unit to the largest remainder, ties to the earlier slice', () => {
    const shares = percentagesOf([6000, 3000, 1000])
    expect(shares).toEqual([60, 30, 10])
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100)
  })

  it('sums to 100 for a seven-way split that rounds badly', () => {
    const shares = percentagesOf([1, 1, 1, 1, 1, 1, 1])
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100)
  })

  it('returns zeros rather than dividing by an empty whole', () => {
    expect(percentagesOf([0, 0])).toEqual([0, 0])
    expect(percentagesOf([])).toEqual([])
  })
})
