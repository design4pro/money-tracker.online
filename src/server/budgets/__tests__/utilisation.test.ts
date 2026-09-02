/**
 * How full an envelope is — the integer comparison the meter, the badge and the alert all read.
 *
 * The assertions worth having here are the boundary ones: 79.999% must not fire an 80% threshold,
 * exactly 100% must read `over` rather than `approaching`, and an envelope with nothing available
 * must not divide by zero on its way to an answer.
 */

import { describe, expect, it } from 'vitest'

import { asMinor } from '#/lib/money'
import {
  DEFAULT_ALERT_THRESHOLDS,
  hasReachedThreshold,
  parseAlertThresholds,
  utilisationOf,
} from '../utilisation'

const LADDER = [50, 80, 100]

describe('hasReachedThreshold', () => {
  it('compares by multiplying, so a rounding step cannot fire it early', () => {
    // 1 599,99 of 2 000,00 is 79.9995% — a float division rounds this to 0.8 in a way that a
    // `>= 0.8` test would accept. The integer form must not.
    expect(hasReachedThreshold(1_599_99, 2_000_00, 80)).toBe(false)
    expect(hasReachedThreshold(1_600_00, 2_000_00, 80)).toBe(true)
  })

  it('is inclusive at the line', () => {
    expect(hasReachedThreshold(2_000_00, 2_000_00, 100)).toBe(true)
    expect(hasReachedThreshold(1_999_99, 2_000_00, 100)).toBe(false)
  })

  it('treats an empty envelope as spent the moment anything is spent', () => {
    expect(hasReachedThreshold(0, 0, 50)).toBe(false)
    expect(hasReachedThreshold(1, 0, 200)).toBe(true)
  })
})

describe('utilisationOf', () => {
  it('measures against limit plus carry, not against the limit alone', () => {
    // 2 200 spent against a 2 000 limit that opened with 300 carried in is 95.6%, not 110%.
    const reading = utilisationOf({
      limitMinor: asMinor(2_000_00),
      carriedInMinor: asMinor(300_00),
      spentMinor: asMinor(2_200_00),
      thresholds: LADDER,
    })
    expect(reading.availableMinor).toBe(2_300_00)
    expect(reading.remainingMinor).toBe(100_00)
    expect(reading.overspentMinor).toBe(0)
    expect(reading.state).toBe('approaching')
    expect(reading.crossedThreshold).toBe(80)
  })

  it('reports an overspend as a positive magnitude and a negative remainder', () => {
    const reading = utilisationOf({
      limitMinor: asMinor(1_200_00),
      carriedInMinor: asMinor(0),
      spentMinor: asMinor(1_392_00),
      thresholds: LADDER,
    })
    expect(reading.remainingMinor).toBe(-192_00)
    expect(reading.overspentMinor).toBe(192_00)
    expect(reading.state).toBe('over')
    expect(reading.crossedThreshold).toBe(100)
  })

  it('is over, not approaching, at exactly the line', () => {
    const reading = utilisationOf({
      limitMinor: asMinor(500_00),
      carriedInMinor: asMinor(0),
      spentMinor: asMinor(500_00),
      thresholds: LADDER,
    })
    expect(reading.state).toBe('over')
    expect(reading.remainingMinor).toBe(0)
  })

  it('is over even when no configured threshold reaches 100', () => {
    // A workspace that only asked to hear about 150% is still out of money at 100%.
    const reading = utilisationOf({
      limitMinor: asMinor(500_00),
      carriedInMinor: asMinor(0),
      spentMinor: asMinor(600_00),
      thresholds: [150],
    })
    expect(reading.state).toBe('over')
    expect(reading.crossedThreshold).toBeNull()
  })

  it('has no ratio when nothing was available, rather than a zero one', () => {
    const reading = utilisationOf({
      limitMinor: asMinor(1_000_00),
      carriedInMinor: asMinor(-1_500_00),
      spentMinor: asMinor(20_00),
      thresholds: LADDER,
    })
    expect(reading.availableMinor).toBe(0)
    expect(reading.ratio).toBeNull()
    expect(reading.state).toBe('over')
    expect(reading.overspentMinor).toBe(20_00)
  })

  it('keeps every returned figure an integer', () => {
    const reading = utilisationOf({
      limitMinor: asMinor(333_33),
      carriedInMinor: asMinor(66_67),
      spentMinor: asMinor(199_99),
      thresholds: LADDER,
    })
    for (const value of [
      reading.availableMinor,
      reading.remainingMinor,
      reading.overspentMinor,
    ]) {
      expect(Number.isInteger(value)).toBe(true)
    }
    expect(reading.availableMinor).toBe(400_00)
    expect(reading.remainingMinor).toBe(200_01)
  })
})

describe('parseAlertThresholds', () => {
  it('reads the stored ladder, deduped and sorted', () => {
    expect(parseAlertThresholds('[100,50,80,50]')).toEqual([50, 80, 100])
  })

  it('falls back to the default rather than crashing a screen', () => {
    for (const raw of ['', 'not json', '{}', '[]', '[0]', '[201]', '["80"]']) {
      expect(parseAlertThresholds(raw)).toEqual(DEFAULT_ALERT_THRESHOLDS)
    }
  })

  it('discards a partially valid ladder whole', () => {
    // Salvaging [80] out of [80, 900] would fire alerts nobody configured and silently drop one.
    expect(parseAlertThresholds('[80,900]')).toEqual(DEFAULT_ALERT_THRESHOLDS)
  })
})
