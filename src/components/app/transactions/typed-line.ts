/**
 * The typed line: the unit the passbook is built from, shared by the landing's page of it
 * (`src/routes/-ui/ledger-preview.tsx`) and the ledger inside the app, so the two are one book.
 *
 * The page is ruled at 2.5rem, so every line of type is a 2.5rem box and a row is a whole number
 * of rules tall. In that box the baseline would sit centred, 17px above the rule; a typewriter sets
 * its type on the line. Courier Prime's baseline lies half the box plus 0.22em below the box's top
 * (measured in the browser), so painting the box 1rem minus 0.22em lower puts the baseline 3px
 * above the rule at every size the table uses - and a transform moves paint rather than layout, so
 * a row stays exactly as many rules tall as it has lines.
 *
 * In `cn()` it goes **after** the size class: tailwind-merge drops a `leading-*` that precedes a
 * `text-*` size, since the size utility sets a line-height of its own.
 */
export const TYPED_LINE = 'block leading-10 translate-y-[calc(1rem-0.22em)]'

/** One rule of the form, in pixels. Every row height is a multiple of it. */
export const LINE_PX = 40
