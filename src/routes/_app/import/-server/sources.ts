import { createServerFn } from '@tanstack/react-start'

import { requireOrg } from '#/server/auth/guards'
import { IMPORT_SOURCES } from '#/lib/enums'
import { hasParser } from '#/server/import/registry'
import { IMPORT_MAX_BYTES } from '#/server/import/types'

import type { ImportSource } from '#/server/db/schema'

/**
 * Which formats this build can actually read, and what a file of each is called.
 *
 * ## Why the screen asks rather than lists
 *
 * `19-S2`'s brief is that the entry surface is organised by **where the data came from**, and that
 * the accepted extensions are read from the parser registry rather than written out beside the
 * upload control. `registry.ts` is a server module — an `import.meta.glob` over
 * `src/server/import/<source>/parse.ts` — so a browser cannot ask it directly, and this route-local
 * server function is the door. It composes two server modules and owns no SQL, which is the shape
 * `routes/_app/transactions/-server/list.ts` documents for this directory.
 *
 * A format landing in `19-S4` or `19-S5` is a new directory under `src/server/import/`, and it
 * appears here the moment that directory exists. Nothing in `index.tsx` is edited for it.
 *
 * ## The two tables, and why they are not the registry's job
 *
 * A parser sniffs bytes and returns text; it has no opinion about what a file of its format is
 * *called* on somebody's disk, and `ImportParser` has no member for one. So the extension and the
 * provenance group are stated here, **once, for all six ids the schema already commits to** —
 * `IMPORT_SOURCES` is the single home of the list and `Record<ImportSource, …>` makes both tables
 * exhaustive at compile time. Neither needs an edit when a parser lands; only `hasParser` decides
 * what is offered.
 */

/**
 * Where the data came from, which is how the screen is grouped.
 *
 * `file` is a statement out of a bank or a spreadsheet; `migration` is an export out of another
 * tracker. Sorting by format instead would put the weakest-signal case — a bare CSV nobody can
 * name — at the bottom of a list of acronyms.
 */
export type ImportProvenance = 'file' | 'migration'

const PROVENANCE_OF: Readonly<Record<ImportSource, ImportProvenance>> = {
  csv: 'file',
  ofx: 'file',
  qif: 'file',
  ynab: 'migration',
  wallet: 'migration',
  json_backup: 'migration',
}

/**
 * The file-name endings each format arrives with.
 *
 * Lower-case and leading-dot, which is the form both the `accept` attribute and the extension probe
 * below take. A tracker export is a container format — YNAB and Wallet both hand out CSV — so those
 * ids name the container rather than themselves.
 */
const EXTENSIONS_OF: Readonly<Record<ImportSource, ReadonlyArray<string>>> = {
  csv: ['.csv', '.txt', '.tsv'],
  ofx: ['.ofx', '.qfx'],
  qif: ['.qif'],
  ynab: ['.csv'],
  wallet: ['.csv'],
  json_backup: ['.json'],
}

/** One format the upload control may offer. */
export interface ImportSourceOption {
  readonly source: ImportSource
  readonly provenance: ImportProvenance
  readonly extensions: ReadonlyArray<string>
}

export interface ImportSourceCatalogue {
  readonly sources: ReadonlyArray<ImportSourceOption>
  /** The ceiling `import/types.ts` sets, so the hint under the control cannot state a stale one. */
  readonly maxBytes: number
}

/**
 * The formats this build has a parser for, in the order `IMPORT_SOURCES` states them.
 *
 * A format with no module is **absent** rather than listed-and-disabled: offering a control that
 * can only refuse is worse than not offering it, and `registry.ts` refuses such an upload anyway.
 *
 * `requireOrg()` guards it like every other server function in the product. Nothing here is
 * tenant data — it is what this build can read — but the door is the same door, and a handler that
 * skipped the guard because *this* payload is harmless is the one somebody widens later.
 */
export const loadImportSources = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ImportSourceCatalogue> => {
    await requireOrg()
    return {
      sources: IMPORT_SOURCES.filter((source) => hasParser(source)).map(
        (source) => ({
          source,
          provenance: PROVENANCE_OF[source],
          extensions: EXTENSIONS_OF[source],
        }),
      ),
      maxBytes: IMPORT_MAX_BYTES,
    }
  },
)
