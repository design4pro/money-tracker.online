/**
 * Application-minted row ids.
 *
 * The convention is stated verbatim in `./schema.ts`'s docblock and is load-bearing for
 * pagination: **base36 epoch-milliseconds + `nanoid(16)`, 25 characters, lexicographically
 * sortable by creation time**. Because the id sorts by time, keyset pagination runs on the primary
 * key rather than on a secondary index, and "newest first" costs no extra column.
 *
 * The timestamp half is left-padded to a fixed nine characters. Without the pad, ids minted either
 * side of a base36 digit boundary compare wrongly as strings — which is the whole property the
 * scheme exists for — and the pad keeps the total width at exactly 25 until the year 5188.
 *
 * Better Auth mints its own ids for its own tables (`nanoid(24)`, see `src/server/auth/config.ts`);
 * this function is for the product schema.
 */

import { nanoid } from 'nanoid'

/** Width of the base36 timestamp half. Nine base36 digits hold epoch-ms past the year 5000. */
const TIMESTAMP_LENGTH = 9

/** Width of the random half. */
const RANDOM_LENGTH = 16

/** Total id width, asserted by `src/server/db/__tests__/conventions.test.ts`. */
export const ID_LENGTH = TIMESTAMP_LENGTH + RANDOM_LENGTH

/**
 * Mints a 25-character, creation-time-sortable id.
 *
 * Two ids minted in the same millisecond differ in their random half; two minted in different
 * milliseconds compare in mint order as plain strings.
 */
export function newId(): string {
  const stamp = Date.now().toString(36).padStart(TIMESTAMP_LENGTH, '0')
  return `${stamp}${nanoid(RANDOM_LENGTH)}`
}
