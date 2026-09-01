/**
 * Exact division and exact decimal scaling — the two places where money is
 * allowed to lose information, and the only two.
 *
 * **Everything here runs on `bigint`.** An amount times a `rate_e10` passes
 * 2^53 at four significant figures, so the intermediate cannot be a `number`
 * without silently rounding before the rounding step. `bigint` has no such
 * edge, and the result is narrowed back to a safe integer exactly once, by
 * `minorFromBigInt`.
 *
 * **Half-to-even is the house rule.** Half-up is biased: apply it to a long
 * run of amounts whose dropped digits are uniformly distributed and the total
 * drifts upward by half a minor unit per rounded value. Over a year of
 * currency-converted transactions that is a visible discrepancy between a
 * reported total and the sum of its rows. Half-to-even has no such bias, is
 * what IEEE 754 does by default, and is what `docs` calls `roundHalfToEven`.
 */

/** A denominator of zero would be a caller bug, not a data condition. */
function assertDenominator(denominator: bigint): void {
  if (denominator === 0n) {
    throw new RangeError('Division by zero in money arithmetic')
  }
}

/**
 * `numerator / denominator`, rounded half to even.
 *
 * Negative values round symmetrically about zero — `-2.5` and `2.5` both land
 * on the even neighbour — because an expense and the refund that reverses it
 * must cancel exactly.
 */
export function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  assertDenominator(denominator)
  const negative = numerator < 0n !== denominator < 0n
  const top = numerator < 0n ? -numerator : numerator
  const bottom = denominator < 0n ? -denominator : denominator

  const quotient = top / bottom
  const remainder = top % bottom
  const twice = remainder * 2n

  let magnitude = quotient
  if (twice > bottom || (twice === bottom && quotient % 2n === 1n)) {
    magnitude = quotient + 1n
  }
  return negative ? -magnitude : magnitude
}

/** `numerator / denominator`, rounded toward negative infinity. */
export function divideFloor(numerator: bigint, denominator: bigint): bigint {
  assertDenominator(denominator)
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  return remainder !== 0n && numerator < 0n !== denominator < 0n
    ? quotient - 1n
    : quotient
}

/** `^[+-]?\d+(\.\d*)?$` or `^[+-]?\.\d+$` — a plain decimal, no exponent, no separators. */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

/**
 * Scales a canonical decimal string to an integer number of minor units,
 * rounding the digits that do not fit half to even.
 *
 * The point is that the decimal point moves **in the string**. `1.005 * 100` is
 * `100.49999999999999` in IEEE 754, so a float scaling loses the penny that the
 * user typed; here `'1.005'` at two digits is `100` (half to even off `100.5`)
 * and `'1.015'` is `102`, both exactly.
 *
 * `null` for anything that is not a single decimal number. The caller decides
 * what to say about it — a form field shows a validation message, an import row
 * records an error and moves on.
 */
export function scaleDecimalString(
  text: string,
  digits: number,
): bigint | null {
  if (!DECIMAL.test(text)) {
    return null
  }
  const negative = text.startsWith('-')
  const unsigned =
    text.startsWith('-') || text.startsWith('+') ? text.slice(1) : text
  const point = unsigned.indexOf('.')
  const whole = point === -1 ? unsigned : unsigned.slice(0, point)
  const fraction = point === -1 ? '' : unsigned.slice(point + 1)

  const kept = fraction.slice(0, digits).padEnd(digits, '0')
  const dropped = fraction.slice(digits)
  const base = BigInt(`${whole === '' ? '0' : whole}${kept}`)

  const magnitude = base + roundingIncrement(base, dropped)
  return negative ? -magnitude : magnitude
}

/**
 * Whether the digits that did not fit push the kept value up by one, half to
 * even. `dropped` is the fraction's tail, already known to be digits only.
 */
function roundingIncrement(base: bigint, dropped: string): bigint {
  if (dropped === '') {
    return 0n
  }
  const first = dropped.charCodeAt(0)
  const FIVE = 53
  if (first > FIVE) {
    return 1n
  }
  if (first < FIVE) {
    return 0n
  }
  // Exactly one half only when every digit after the 5 is a zero; otherwise the
  // value is above the halfway mark and rounds up regardless of parity.
  const beyondHalf = /[1-9]/.test(dropped.slice(1))
  if (beyondHalf) {
    return 1n
  }
  return base % 2n === 0n ? 0n : 1n
}
