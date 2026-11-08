/**
 * The typed line: the unit the passbook is built from, shared by the landing's page of it
 * (`src/routes/-ui/ledger-preview.tsx`) and the ledger inside the app, so the two are one book.
 *
 * Desktop rows are at least 52px (the redesign floor), so a ledger line is a 3.25rem box.
 * Type sits vertically centred in that box. A cell has no extra vertical padding on the wide
 * page, so a row stays exactly as many rules tall as it has lines. Compact mobile rows are a
 * separate 76px floor and may grow when an amount or account wraps.
 *
 * In `cn()` it goes **after** the size class: tailwind-merge drops a `leading-*` that precedes a
 * `text-*` size, since the size utility sets a line-height of its own.
 */
export const TYPED_LINE = 'block min-h-[3.25rem] leading-[3.25rem]'

/** One desktop ledger line, in pixels. Wide row heights are a multiple of it. */
export const LINE_PX = 52
