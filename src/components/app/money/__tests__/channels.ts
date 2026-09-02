/**
 * Reading the two channels an amount is rendered in.
 *
 * Every money figure in the product is drawn once and spoken once: an
 * `aria-hidden` span carrying `−43,81 zł` and an `sr-only` span carrying
 * "minus 43,81 złotego polskiego". `textContent` concatenates them, so a test
 * that asserts on it is asserting on a string neither channel actually
 * produces. These two split them apart, and asserting on both is what keeps the
 * spoken half from quietly disappearing.
 *
 * Non-breaking and narrow spaces are normalised for the same reason
 * `charts/__tests__/plain.ts` does it: the assertions are about digits and
 * separators, not about which invisible code point CLDR chose this year.
 */

function normalise(value: string): string {
  return value.replaceAll('\u00a0', ' ').replaceAll('\u202f', ' ')
}

function textOf(node: Element, selector: string): string {
  return normalise(
    [...node.querySelectorAll(selector)]
      .map((element) => element.textContent)
      .join(''),
  )
}

/** What a sighted reader sees. */
export function drawn(node: Element): string {
  return textOf(node, '[aria-hidden="true"]')
}

/** What a screen reader is given. */
export function reading(node: Element): string {
  return textOf(node, '.sr-only')
}
