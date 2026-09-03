/**
 * Finding the parser for a batch's `source`.
 *
 * ---------------------------------------------------------------------------
 * BY CONVENTION, NOT BY TABLE
 * ---------------------------------------------------------------------------
 *
 * A format lives at `src/server/import/<source>/parse.ts` and exports `parser`. That path **is**
 * the registration: this module globs for it, so adding OFX is adding a directory and editing
 * nothing. The alternative - a table of entries somebody has to remember to extend - would put
 * every new format back into this file, and three stages of one wave (`19-S4`'s two interchange
 * formats, `19-S5`'s two migrations) would be queueing to write to a file `19-S1` owns.
 *
 * **Why a glob, and why the pattern is a literal.** `src/lib/i18n/catalogue.ts` documents the
 * mechanism at length and this file is the same shape: `import.meta.glob` compiles to one
 * `() => import(…)` per matched file, so the module bodies are chunks that are fetched and
 * evaluated only when a source asks for one. A CSV upload never evaluates the OFX parser. The
 * pattern has to be a literal for the bundler to enumerate it at build time, which is exactly the
 * requirement that rules out `` import(`./${source}/parse.ts`) ``: a specifier built from a
 * variable makes the bundler emit the whole source tree.
 *
 * The *keys* of the glob are static, so {@link hasParser} answers without evaluating anything.
 *
 * ---------------------------------------------------------------------------
 * A MISSING PARSER IS A REFUSAL
 * ---------------------------------------------------------------------------
 *
 * `IMPORT_SOURCES` commits the database to six formats and the parsers land a wave at a time, so a
 * `source` with no directory is an ordinary state - and it is a **typed failure**, never a quiet
 * fallback to CSV. Reading a QIF file as comma-separated text produces rows, and rows that parse
 * are rows that get written: the failure mode of a fallback here is somebody's ledger.
 */

import { RepositoryError } from '#/server/repos/errors'

import type { ImportParser } from './types'

/** What a format's `parse.ts` must export for this module to find it. */
export interface ParserModule {
  readonly parser: ImportParser
}

/** How one format's module is reached. Lazy, always. */
export type ParserImporter = () => Promise<ParserModule>

/** Every format that has a module, keyed by its path relative to this one. */
const PARSER_MODULES: Readonly<Record<string, ParserImporter>> =
  import.meta.glob<ParserModule>('./*/parse.ts')

/** `./csv/parse.ts` → `'csv'`. */
function sourceOfPath(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 2] ?? ''
}

/** A file was uploaded for a format this build has no module for. */
export class UnsupportedImportSourceError extends RepositoryError {
  readonly source: string

  constructor(source: string) {
    super(
      `No import parser is registered for ${source}.`,
      'UNSUPPORTED_IMPORT_SOURCE',
    )
    this.source = source
  }
}

/** Reading `source` ids onto parsers. */
export interface ParserRegistry {
  /** Whether a module exists for `source`. Answers from the glob's keys, evaluating nothing. */
  readonly hasParser: (source: string) => boolean
  /** The parser for `source`, or {@link UnsupportedImportSourceError}. Never falls back. */
  readonly resolveParser: (source: string) => Promise<ImportParser>
}

/**
 * Builds a registry over a set of importers.
 *
 * The importers are a parameter for the reason `createCatalogueLoader` takes them: it is the only
 * way to exercise "a source whose module is absent" against a fixture, and the only way to assert
 * that resolving one format evaluated one module. Production passes the glob.
 */
export function createParserRegistry(
  modules: Readonly<Record<string, ParserImporter>> = PARSER_MODULES,
): ParserRegistry {
  /** Parsers already evaluated in this isolate, and the loads still in flight. */
  const resolved = new Map<string, ImportParser>()
  const pending = new Map<string, Promise<ImportParser>>()

  const importerFor = (source: string): ParserImporter | undefined => {
    for (const [path, load] of Object.entries(modules)) {
      if (sourceOfPath(path) === source) {
        return load
      }
    }
    return undefined
  }

  return {
    hasParser(source) {
      return importerFor(source) !== undefined
    },

    async resolveParser(source) {
      const ready = resolved.get(source)
      if (ready !== undefined) return ready
      const inFlight = pending.get(source)
      if (inFlight !== undefined) return inFlight

      const importer = importerFor(source)
      if (importer === undefined) {
        throw new UnsupportedImportSourceError(source)
      }

      const load = (async (): Promise<ImportParser> => {
        const { parser } = await importer()
        // The directory name and the parser's own id are two statements of the same fact, and a
        // build where they disagree would resolve `qif` onto the CSV parser. Cheaper to refuse.
        if (parser.source !== source) {
          throw new UnsupportedImportSourceError(source)
        }
        return parser
      })()

      pending.set(source, load)
      try {
        const parser = await load
        resolved.set(source, parser)
        return parser
      } finally {
        pending.delete(source)
      }
    },
  }
}

/** The registry over the shipped formats. */
export const { hasParser, resolveParser } = createParserRegistry()
