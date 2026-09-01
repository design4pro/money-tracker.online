import { resolveMessage } from './interpolate'

import type { Locale } from './locales'
import type {
  Catalogue,
  Message,
  MessageCatalogueSource,
  MessageKey,
  MessageParams,
  Translate,
  TranslateArgs,
  TranslateStored,
} from './types'

/**
 * Loading one locale's messages, and reading keys out of them.
 *
 * **Why a glob.** `import.meta.glob('./messages/*.ts')` is lazy, so Vite
 * compiles it to one `() => import(…)` per matched file and emits one chunk per
 * locale, inlining none of them into the entry. A request needs exactly one
 * locale, and behind these thunks V8 compiles and evaluates only that one,
 * keeping the other catalogue out of a cold isolate's startup budget. The
 * pattern has to be a literal for that to work, which is the same requirement
 * that rules out `` import(`./messages/${locale}.ts`) ``: a specifier built from
 * a variable makes the bundler emit the whole source tree.
 */

/** A catalogue file: one flat object of dotted keys, default-exported. */
export interface CatalogueModule {
  readonly default: MessageCatalogueSource
}

/** How one catalogue file is reached. Lazy, always. */
export type CatalogueImporter = () => Promise<CatalogueModule>

/** Every catalogue file, keyed by its path relative to this module. */
const CATALOGUE_MODULES: Readonly<Record<string, CatalogueImporter>> =
  import.meta.glob<CatalogueModule>('./messages/*.ts')

/** `./messages/pl.ts` → `'pl'`. */
function localeOfPath(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1)
  return file.replace(/\.ts$/, '')
}

/** Everything one catalogue cache offers. */
export interface CatalogueLoader {
  /** The messages for one locale. Evaluates that locale's file and no other. */
  readonly loadCatalogue: (locale: Locale) => Promise<Catalogue>
  /** A catalogue already loaded in this isolate, if there is one. */
  readonly peekCatalogue: (locale: Locale) => Catalogue | undefined
}

/**
 * Builds a loader over a set of catalogue importers.
 *
 * The importers are a parameter so the cache can be exercised against fixtures
 * — including "loading `pl` evaluated `pl` and nothing else", which is the whole
 * point of the thunks and cannot be asserted against the shipped glob.
 * Production passes the glob.
 */
export function createCatalogueLoader(
  modules: Readonly<Record<string, CatalogueImporter>> = CATALOGUE_MODULES,
): CatalogueLoader {
  /**
   * Resolved catalogues, and the loads still in flight. The in-flight map
   * matters on the server: a burst of concurrent requests for the same locale
   * shares one module evaluation instead of racing.
   */
  const resolved = new Map<Locale, Catalogue>()
  const pending = new Map<Locale, Promise<Catalogue>>()

  const importerFor = (locale: Locale): CatalogueImporter | undefined => {
    for (const [path, load] of Object.entries(modules)) {
      if (localeOfPath(path) === locale) {
        return load
      }
    }
    return undefined
  }

  return {
    async loadCatalogue(locale) {
      const ready = resolved.get(locale)
      if (ready !== undefined) {
        return ready
      }
      const inFlight = pending.get(locale)
      if (inFlight !== undefined) {
        return inFlight
      }
      const load = (async (): Promise<Catalogue> => {
        const importer = importerFor(locale)
        // A shipped locale with no file is a build-time hole the parity gate
        // fails on. At run time it must not take the page down: an empty
        // catalogue renders keys, which is visible damage rather than a crash.
        const messages =
          importer === undefined ? {} : (await importer()).default
        return messages
      })()
        .then((catalogue) => {
          resolved.set(locale, catalogue)
          return catalogue
        })
        .finally(() => {
          pending.delete(locale)
        })
      pending.set(locale, load)
      return load
    },
    peekCatalogue(locale) {
      return resolved.get(locale)
    },
  }
}

const shipped = createCatalogueLoader()

/** The messages for one locale. Evaluates that locale's file and no other. */
export const loadCatalogue = shipped.loadCatalogue

/** A catalogue already loaded in this isolate, if there is one. */
export const peekCatalogue = shipped.peekCatalogue

/**
 * `t()`'s public signature already proved the shape of the params object; this
 * narrows the erased rest-tuple element back to it without a cast.
 */
function isParams(value: unknown): value is MessageParams {
  return typeof value === 'object' && value !== null
}

/**
 * Binds a catalogue and a locale into a renderer for keys that only exist at
 * run time — the `title_key` / `body_key` / params triple a `notifications` row
 * carries in D1. `null` when the catalogue has no such key; never an English
 * fallback.
 *
 * This is also the whole runtime of `createTranslator` below, which is why it is
 * the function the tests drive: `t()` differs from it by its signature and by
 * nothing else.
 */
export function createStoredTranslator(
  locale: Locale,
  catalogue: Catalogue,
): TranslateStored {
  return (key, params) => {
    // Presence is decided by `Object.hasOwn` rather than by indexing: a
    // catalogue is a plain object literal, so `catalogue['constructor']`
    // answers with the `Object` constructor and `catalogue['__proto__']` with
    // `Object.prototype`. This function's key comes out of D1.
    const message: Message | undefined = Object.hasOwn(catalogue, key)
      ? catalogue[key]
      : undefined
    return message === undefined
      ? null
      : resolveMessage(message, locale, params)
  }
}

/**
 * Binds a catalogue and a locale into the `t()` a screen calls.
 *
 * There is no English fallback branch: `MessageKey` is derived from
 * `messages/en.ts`, so a key that does not exist is a compile error. A key that
 * typechecks but is missing from *this* locale's file cannot happen while the
 * parity gate is green; if it ever does, the key itself is rendered — visible
 * damage a reviewer catches, rather than an English sentence that looks
 * finished, and never a thrown error that takes the page down.
 */
export function createTranslator(
  locale: Locale,
  catalogue: Catalogue,
): Translate {
  const render = createStoredTranslator(locale, catalogue)
  return <TKey extends MessageKey>(
    key: TKey,
    ...args: TranslateArgs<TKey>
  ): string => {
    const first: unknown = args[0]
    return render(key, isParams(first) ? first : undefined) ?? key
  }
}
