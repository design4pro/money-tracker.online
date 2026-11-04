/**
 * The typed line: the unit the passbook is built from, shared by the landing's page of it
 * (`src/routes/-ui/ledger-preview.tsx`) and the ledger inside the app, so the two are one book.
 *
 * The page is ruled at 2.5rem, so every line of type is a 2.5rem box and a row is a whole number
 * of rules tall. Type sits vertically centred in that box (`leading-10` on a 2.5rem pitch). A
 * cell has no vertical padding, so a row stays exactly as many rules tall as it has lines.
 *
 * In `cn()` it goes **after** the size class: tailwind-merge drops a `leading-*` that precedes a
 * `text-*` size, since the size utility sets a line-height of its own.
 */
export const TYPED_LINE = 'block leading-10'

/** One rule of the form, in pixels. Every row height is a multiple of it. */
export const LINE_PX = 40
