import { describe, expect, it, vi } from 'vitest'

import {
  createCatalogueLoader,
  createStoredTranslator,
  createTranslator,
  loadCatalogue,
} from '../catalogue'

import type { CatalogueImporter, CatalogueModule } from '../catalogue'
import type { Catalogue } from '../types'

function fixture(messages: Record<string, string>): CatalogueModule {
  return { default: messages }
}

describe('the loader', () => {
  it('evaluates the locale that was asked for and no other', async () => {
    const english = vi.fn<CatalogueImporter>(async () =>
      fixture({ 'nav.accounts': 'Accounts' }),
    )
    const polish = vi.fn<CatalogueImporter>(async () =>
      fixture({ 'nav.accounts': 'Konta' }),
    )
    const loader = createCatalogueLoader({
      './messages/en.ts': english,
      './messages/pl.ts': polish,
    })

    await expect(loader.loadCatalogue('pl')).resolves.toEqual({
      'nav.accounts': 'Konta',
    })
    expect(polish).toHaveBeenCalledTimes(1)
    expect(english).not.toHaveBeenCalled()
  })

  it('evaluates a locale once, however many times it is asked for', async () => {
    const polish = vi.fn<CatalogueImporter>(async () => fixture({ a: 'A' }))
    const loader = createCatalogueLoader({ './messages/pl.ts': polish })

    await loader.loadCatalogue('pl')
    await loader.loadCatalogue('pl')
    expect(polish).toHaveBeenCalledTimes(1)
  })

  it('shares one evaluation between concurrent requests for the same locale', async () => {
    let resolveImport: ((module: CatalogueModule) => void) | undefined
    const polish = vi.fn<CatalogueImporter>(
      async () =>
        new Promise<CatalogueModule>((resolve) => {
          resolveImport = resolve
        }),
    )
    const loader = createCatalogueLoader({ './messages/pl.ts': polish })

    const first = loader.loadCatalogue('pl')
    const second = loader.loadCatalogue('pl')
    resolveImport?.(fixture({ a: 'A' }))

    expect(await first).toBe(await second)
    expect(polish).toHaveBeenCalledTimes(1)
  })

  it('does not answer from the cache before a locale has been loaded', async () => {
    const loader = createCatalogueLoader({
      './messages/pl.ts': async () => fixture({ a: 'A' }),
    })
    expect(loader.peekCatalogue('pl')).toBeUndefined()
    await loader.loadCatalogue('pl')
    expect(loader.peekCatalogue('pl')).toEqual({ a: 'A' })
  })

  it('renders keys rather than throwing when a locale has no file at all', async () => {
    const loader = createCatalogueLoader({})
    const catalogue = await loader.loadCatalogue('pl')
    expect(catalogue).toEqual({})
    expect(createTranslator('pl', catalogue)('nav.accounts')).toBe(
      'nav.accounts',
    )
  })

  it('loads the catalogues this product actually ships', async () => {
    const polish = await loadCatalogue('pl')
    const english = await loadCatalogue('en')
    expect(polish['nav.accounts']).toBe('Konta')
    expect(english['nav.accounts']).toBe('Accounts')
  })
})

describe('the translator', () => {
  const catalogue: Catalogue = {
    'nav.accounts': 'Konta',
    'dashboard.greeting': 'Dobrze Cie widziec, {name}.',
    'accounts.count': {
      one: '{count} konto',
      few: '{count} konta',
      many: '{count} kont',
      other: '{count} konta',
    },
  }

  it('renders a plain key', () => {
    expect(createTranslator('pl', catalogue)('nav.accounts')).toBe('Konta')
  })

  it('renders a key with parameters', () => {
    expect(
      createTranslator('pl', catalogue)('dashboard.greeting', { name: 'Ada' }),
    ).toBe('Dobrze Cie widziec, Ada.')
  })

  it('picks the right Polish plural branch', () => {
    const t = createTranslator('pl', catalogue)
    expect(t('accounts.count', { count: 1 })).toBe('1 konto')
    expect(t('accounts.count', { count: 3 })).toBe('3 konta')
    expect(t('accounts.count', { count: 13 })).toBe('13 kont')
  })

  it('renders the key itself for a hole, never an English sentence', () => {
    // Unreachable while the parity gate is green; visible damage if it is not.
    expect(createTranslator('pl', {})('nav.accounts')).toBe('nav.accounts')
  })
})

describe('the stored-key renderer', () => {
  const render = createStoredTranslator('pl', {
    'notification.budget.exceeded': 'Budzet {name} zostal przekroczony.',
  })

  it('renders a key that only exists at run time', () => {
    expect(render('notification.budget.exceeded', { name: 'Zakupy' })).toBe(
      'Budzet Zakupy zostal przekroczony.',
    )
  })

  it('answers null for a key the catalogue does not carry', () => {
    expect(render('notification.deleted.long.ago')).toBeNull()
  })

  it('answers null for an inherited property, not the Object constructor', () => {
    expect(render('constructor')).toBeNull()
    expect(render('__proto__')).toBeNull()
    expect(render('toString')).toBeNull()
  })
})
