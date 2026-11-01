/**
 * The Firma/Prywatne dimension (`business` | `personal`).
 *
 * New tables in this product store `book` as a column (loans first). A parallel PR will put the
 * same column on `recurring_series` and teach cron a Warsaw civil day; that PR should import from
 * here rather than copy a second tuple or rewrite this schema.
 *
 * The SQL `CHECK` is generated from {@link BOOKS} in `#/lib/enums`, which is the one home for
 * closed vocabularies. This file exists so a caller that only needs the union does not reach for
 * the schema module.
 */

export { BOOKS } from './enums'
export type { Book } from './enums'
