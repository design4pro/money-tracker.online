/**
 * JSON the MCP tools return. Amounts stay integer minors; Dates become ISO
 * strings. No client-side money formatting.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

/** True when the payload contains a decimal number token such as `12.5`. */
export function jsonHasDecimalNumber(payload: string): boolean {
  return /(?<![A-Za-z0-9_-])\d+\.\d+/.test(payload)
}

export function assertIntegerMinors(value: JsonValue, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertIntegerMinors(entry, `${path}[${index}]`)
    })
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (
      key.endsWith('Minor') &&
      typeof child === 'number' &&
      !Number.isInteger(child)
    ) {
      throw new Error(`${path}.${key} is not an integer minor`)
    }
    assertIntegerMinors(child, `${path}.${key}`)
  }
}
