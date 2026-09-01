import { describe, expect, it } from 'vitest'

import { DEFAULT_LOCALE, LOCALE_TAGS, isSupportedLocale } from '../locales'
import { pluralCategories } from '../plural'

import type { CatalogueModule } from '../catalogue'
import type { Locale } from '../locales'
import type { Catalogue, Message } from '../types'

/**
 * The completeness gate.
 *
 * English is the schema and the compiler enforces the key set, but a type
 * cannot see a renamed placeholder, a plural branch Polish actually needs, an
 * empty string, or — worst of all — an English sentence sitting in the Polish
 * catalogue. Half-translated copy looks finished in a screenshot and is found
 * by a Polish reader. This test is the relation between the two files that the
 * type system has no way to express.
 *
 * The glob is eager and matches the layout the loader uses. If the two ever
 * disagree — the failure that once let a whole product ship English while its
 * parity test reported green — the first block below catches it, because it
 * asserts against the same shipped locales the registry declares.
 */

const modules = import.meta.glob<CatalogueModule>('../messages/*.ts', {
  eager: true,
})

/**
 * Keys whose value is legitimately word-for-word identical in Polish. Every
 * entry is a decision, so adding one is visible in review rather than a quiet
 * weakening of the untranslated check.
 *
 * A value with no *words* in it needs no entry — see `isUntranslatable`.
 */
const PROPER_NOUNS: ReadonlyArray<string> = [
  // The product name. It is not translated, in any language.
  'app.name',
  // Polish uses the same word for the noun. `action.import` is the verb and is
  // `Importuj`, which is why only this one is listed.
  'nav.import',
]

const TOKEN = /\{([A-Za-z0-9_]+)\}/g

/** Any letter in any script. */
const LETTER = /\p{L}/u

function branchesOf(message: Message): ReadonlyArray<string> {
  if (typeof message === 'string') {
    return [message]
  }
  return Object.values(message).filter(
    (branch): branch is string => branch !== undefined,
  )
}

/**
 * Whether a message has nothing in it that *can* be translated: every branch,
 * once its placeholders are removed, is punctuation, digits and spacing with
 * not one letter of any script in it.
 *
 * `notifications.badge` is `{count}+` and `common.range` is `{from} – {to}`.
 * Polish writes both exactly as English does, because a plus sign is a plus
 * sign. Without a structural exemption the only way to satisfy the check would
 * be to move the sign, shipping `+99` where the language shows `99+`.
 */
function isUntranslatable(message: Message): boolean {
  return !branchesOf(message).some((branch) =>
    LETTER.test(branch.replace(TOKEN, '')),
  )
}

function tokensOf(message: Message): ReadonlyArray<string> {
  const tokens = new Set<string>()
  for (const branch of branchesOf(message)) {
    for (const match of branch.matchAll(TOKEN)) {
      tokens.add(match[1])
    }
  }
  return [...tokens].toSorted()
}

/** Everything one locale can be wrong about, relative to English. */
interface ParityReport {
  readonly missing: ReadonlyArray<string>
  readonly orphans: ReadonlyArray<string>
  readonly shapeDrift: ReadonlyArray<string>
  readonly tokenDrift: ReadonlyArray<string>
  readonly pluralGaps: ReadonlyArray<string>
  readonly untranslated: ReadonlyArray<string>
  readonly blanks: ReadonlyArray<string>
}

function compare(
  source: Catalogue,
  target: Catalogue,
  locale: Locale,
  properNouns: ReadonlyArray<string> = PROPER_NOUNS,
): ParityReport {
  const sourceKeys = Object.keys(source).toSorted()
  const shared = sourceKeys.filter((key) => key in target)
  const categories = pluralCategories(locale)

  const pluralGaps: Array<string> = []
  for (const key of shared) {
    const message = target[key]
    if (typeof message === 'string') {
      continue
    }
    for (const category of categories) {
      if (message[category] === undefined) {
        pluralGaps.push(`${key}.${category}`)
      }
    }
  }

  return {
    missing: sourceKeys.filter((key) => !(key in target)),
    orphans: Object.keys(target)
      .toSorted()
      .filter((key) => !(key in source)),
    shapeDrift: shared.filter(
      (key) => typeof target[key] !== typeof source[key],
    ),
    tokenDrift: shared.filter(
      (key) =>
        tokensOf(source[key]).join(',') !== tokensOf(target[key]).join(','),
    ),
    pluralGaps,
    untranslated:
      locale === DEFAULT_LOCALE
        ? []
        : shared
            .filter((key) => !properNouns.includes(key))
            .filter((key) => !isUntranslatable(source[key]))
            .filter(
              (key) =>
                branchesOf(source[key]).join('\u0000') ===
                branchesOf(target[key]).join('\u0000'),
            ),
    blanks: shared.filter((key) =>
      branchesOf(target[key]).some((branch) => branch.trim().length === 0),
    ),
  }
}

/** `../messages/pl.ts` → `pl`. */
function localeOfPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.ts$/, '')
}

const catalogues = new Map<string, Catalogue>(
  Object.entries(modules).map(([path, module]) => [
    localeOfPath(path),
    module.default,
  ]),
)
const source = catalogues.get(DEFAULT_LOCALE) ?? {}

const NOTHING: ParityReport = {
  missing: [],
  orphans: [],
  shapeDrift: [],
  tokenDrift: [],
  pluralGaps: [],
  untranslated: [],
  blanks: [],
}

/**
 * The comparison is exercised against fixtures as well as against the shipped
 * files, because a gate nobody has watched fail is not a gate.
 */
describe('the comparison this gate makes', () => {
  const english: Catalogue = {
    'nav.accounts': 'Accounts',
    'dashboard.greeting': 'Hello {name}',
    'accounts.count': { one: '{count} account', other: '{count} accounts' },
  }

  it('passes a faithful translation', () => {
    expect(
      compare(
        english,
        {
          'nav.accounts': 'Konta',
          'dashboard.greeting': 'Witaj {name}',
          'accounts.count': {
            one: '{count} konto',
            few: '{count} konta',
            many: '{count} kont',
            other: '{count} konta',
          },
        },
        'pl',
      ),
    ).toEqual(NOTHING)
  })

  it('reports a key English carries and the translation does not', () => {
    expect(compare(english, { 'nav.accounts': 'Konta' }, 'pl').missing).toEqual(
      ['accounts.count', 'dashboard.greeting'],
    )
  })

  it('reports a key that exists only outside English', () => {
    expect(
      compare(
        { 'nav.accounts': 'Accounts' },
        { 'nav.accounts': 'Konta', 'nav.wymyslone': 'Wymyslone' },
        'pl',
      ).orphans,
    ).toEqual(['nav.wymyslone'])
  })

  it('reports a value left byte-identical to English', () => {
    expect(
      compare(
        { 'nav.accounts': 'Accounts' },
        { 'nav.accounts': 'Accounts' },
        'pl',
      ).untranslated,
    ).toEqual(['nav.accounts'])
  })

  it('does not report English for looking like itself', () => {
    expect(compare(english, english, 'en').untranslated).toEqual([])
  })

  it('does not report a value with no word in it to translate', () => {
    const signs: Catalogue = {
      'notifications.badge': '{count}+',
      'common.range': '{from} – {to}',
    }
    expect(compare(signs, signs, 'pl').untranslated).toEqual([])
  })

  it('still reports a lone English word, however short', () => {
    expect(
      compare({ 'common.no': 'No' }, { 'common.no': 'No' }, 'pl').untranslated,
    ).toEqual(['common.no'])
  })

  it('exempts a proper noun only when it is named on the allow-list', () => {
    const brand: Catalogue = { 'app.name': 'Money Tracker' }
    expect(compare(brand, brand, 'pl').untranslated).toEqual([])
    expect(compare(brand, brand, 'pl', []).untranslated).toEqual(['app.name'])
  })

  it('reads every branch of a plural before exempting it', () => {
    const message: Catalogue = {
      'x.left': { one: '{count}+', other: 'more than {count}' },
    }
    expect(compare(message, message, 'pl').untranslated).toEqual(['x.left'])
  })

  it('reports a renamed placeholder and a changed message shape', () => {
    const report = compare(
      english,
      {
        'nav.accounts': 'Konta',
        'dashboard.greeting': 'Witaj {imie}',
        'accounts.count': '{count} kont',
      },
      'pl',
    )
    expect(report.tokenDrift).toEqual(['dashboard.greeting'])
    expect(report.shapeDrift).toEqual(['accounts.count'])
  })

  it('reports the Polish plural branches a message is missing', () => {
    const report = compare(
      english,
      {
        'nav.accounts': 'Konta',
        'dashboard.greeting': 'Witaj {name}',
        'accounts.count': { one: '{count} konto', other: '{count} konta' },
      },
      'pl',
    )
    expect(report.pluralGaps).toEqual([
      'accounts.count.few',
      'accounts.count.many',
    ])
  })

  it('reports an empty message', () => {
    expect(
      compare({ 'nav.accounts': 'Accounts' }, { 'nav.accounts': '   ' }, 'pl')
        .blanks,
    ).toEqual(['nav.accounts'])
  })
})

describe('the shipped catalogues', () => {
  it('carries one file per shipped locale and nothing else', () => {
    expect([...catalogues.keys()].toSorted()).toEqual(
      [...LOCALE_TAGS].toSorted(),
    )
    for (const tag of catalogues.keys()) {
      expect(isSupportedLocale(tag), `${tag} is not a shipped locale`).toBe(
        true,
      )
    }
  })

  it('has an English catalogue with real copy in it', () => {
    expect(Object.keys(source).length).toBeGreaterThan(100)
  })

  for (const tag of LOCALE_TAGS) {
    describe(tag, () => {
      const catalogue = catalogues.get(tag) ?? {}
      const report = compare(source, catalogue, tag)

      it('carries every key English carries', () => {
        expect(report.missing).toEqual([])
      })

      it('carries no key English does not', () => {
        expect(report.orphans).toEqual([])
      })

      it('keeps every message the shape English gave it', () => {
        expect(report.shapeDrift).toEqual([])
      })

      it('keeps every placeholder English named', () => {
        expect(report.tokenDrift).toEqual([])
      })

      it('carries every plural branch this language actually needs', () => {
        expect(report.pluralGaps).toEqual([])
      })

      it('has no blank message', () => {
        expect(report.blanks).toEqual([])
      })

      it('has no English sentence left in it', () => {
        expect(report.untranslated).toEqual([])
      })
    })
  }
})

describe('the Polish catalogue', () => {
  const polish = catalogues.get('pl') ?? {}

  it('is written with real diacritics, not ASCII substitutes', () => {
    const withDiacritics = Object.values(polish)
      .flatMap((message) => branchesOf(message))
      .filter((branch) => /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(branch))
    // A catalogue this size cannot be idiomatic Polish without them.
    expect(withDiacritics.length).toBeGreaterThan(60)
  })

  it('never uses a stripped spelling of a word it also writes correctly', () => {
    const stripped = [
      'budzet',
      'kwote',
      'wiecej',
      'zaloguj sie',
      'jezyk',
      'przelacz',
    ]
    const offenders = Object.entries(polish).filter(([, message]) =>
      branchesOf(message).some((branch) =>
        stripped.some((word) => branch.toLowerCase().includes(word)),
      ),
    )
    expect(offenders.map(([key]) => key)).toEqual([])
  })
})
