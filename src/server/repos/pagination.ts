/**
 * Keyset pagination.
 *
 * Every paged list in this product walks `desc(table.id)` and carries the last id it saw as the
 * cursor. Two consequences, both deliberate:
 *
 * - **There is no `OFFSET` anywhere in the product.** An `OFFSET 5000` makes SQLite count and throw
 *   away five thousand rows on every request, and it silently skips or repeats rows when something
 *   is inserted between two page loads — which for a transaction list being typed into is the
 *   normal case, not the edge case.
 * - **The cursor is the primary key and never an amount or a running balance.** Ids are minted
 *   base36-epoch-first, so they sort by creation time and the primary-key index *is* the sort index.
 *   A cursor derived from a sum changes meaning the moment somebody edits an amount, and the page
 *   after it silently skips rows.
 */

import { z } from 'zod'

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100

export interface CursorPage<TRow> {
  readonly items: ReadonlyArray<TRow>
  /** Pass back as `cursor` to fetch the next page; `null` when the list is exhausted. */
  readonly nextCursor: string | null
}

/**
 * Clamps a requested page size into `[1, MAX_PAGE_SIZE]`, defaulting when absent.
 *
 * Clamping rather than rejecting: a client asking for 1000 rows gets 100, which is a slow list
 * rather than a broken one. A non-integer or negative request is a client bug and lands on the
 * default rather than on `LIMIT NaN`.
 */
export function clampPageSize(requested?: number | null): number {
  if (
    requested === undefined ||
    requested === null ||
    !Number.isFinite(requested)
  ) {
    return DEFAULT_PAGE_SIZE
  }
  const whole = Math.trunc(requested)
  if (whole < 1) return DEFAULT_PAGE_SIZE
  return Math.min(whole, MAX_PAGE_SIZE)
}

/**
 * The page arguments a server function may accept from a client.
 *
 * The cursor is an opaque id and is length-bounded: it goes into a `WHERE id < ?` comparison, so an
 * over-long value costs nothing but is never something a caller should be able to send.
 */
export const pageInputSchema = z.object({
  cursor: z.string().trim().min(1).max(64).nullish(),
  limit: z.number().int().positive().max(MAX_PAGE_SIZE).optional(),
})

export type PageInput = z.infer<typeof pageInputSchema>
