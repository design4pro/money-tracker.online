/**
 * Whether two objects hold the same values, one level deep.
 *
 * This is the comparison every unsaved-changes guard in the product asks: does the draft still
 * hold what it opened with? `Object.is` answers that for a primitive and gets it wrong for a
 * list, and both kinds sit side by side in the same draft — a budget's name next to its
 * thresholds, a filter set's free text next to its account ids. A React Aria `CheckboxGroup`
 * replaces its value wholesale on every toggle, so ticking an option off and back on hands the
 * comparison a fresh array holding the same members; read by identity that is a change that never
 * happened, and the guard then asks about work nobody did for the rest of the dialog's life.
 *
 * So an array value is compared member by member, and everything else by `Object.is`. **Order
 * inside an array counts**: every list this compares is built from a fixed reference order, so a
 * different order is something the user chose rather than noise, and over-reporting is the safe
 * direction for a guard anyway.
 *
 * The walk covers the union of both sides' keys, so a key one side does not have at all is still
 * compared — as `undefined`, which is what makes an absent key and an explicit `undefined` mean
 * the same thing here. Callers that also treat an empty list as "absent" normalise before
 * comparing; that rule belongs to the shape being compared, not to the comparison.
 *
 * One level deep, on purpose: no draft in this repository nests, and a recursive compare would
 * hide the cost of the first one that did.
 */
export function isSameShallow(a: object, b: object): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])

  for (const key of keys) {
    const left = (a as Record<string, unknown>)[key]
    const right = (b as Record<string, unknown>)[key]

    if (Array.isArray(left) && Array.isArray(right)) {
      if (
        left.length !== right.length ||
        left.some((value, index) => !Object.is(value, right[index]))
      ) {
        return false
      }
      continue
    }

    if (!Object.is(left, right)) return false
  }

  return true
}
