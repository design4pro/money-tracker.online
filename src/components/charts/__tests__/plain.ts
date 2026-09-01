/**
 * CLDR separates a currency symbol from its figure with a non-breaking space, and some locales use
 * a narrow one as the group separator. Normalising them keeps these assertions about the digits and
 * the separators — which is what the money cases are about — rather than about an invisible code
 * point.
 */
export function plain(value: string | null): string {
  return (value ?? '').replaceAll('\u00a0', ' ').replaceAll('\u202f', ' ')
}
