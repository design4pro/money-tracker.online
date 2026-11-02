import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'
import { LEAKED_MESSAGE, wireFailure } from '#/lib/__tests__/wire-failure'
import { addAlias } from '#/server/fns/payees'
import { Route } from '../../$payeeId'

import type * as RouterModule from '@tanstack/react-router'
import type { Catalogue } from '#/lib/i18n'
import type { ComponentType } from 'react'

vi.mock('#/server/fns/payees', () => ({
  addAlias: vi.fn(),
  removeAlias: vi.fn(),
  getPayee: vi.fn(),
}))
vi.mock('#/server/fns/categories', () => ({ listCategories: vi.fn() }))
vi.mock('../../../-lib/refresh', () => ({
  useDataRefresh: () => () => Promise.resolve(),
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
}))

const PayeeDetail = Route.options.component as ComponentType

async function addRefusedWith(error: unknown, locale: 'en' | 'pl') {
  vi.mocked(addAlias).mockReset()
  vi.mocked(addAlias).mockRejectedValue(error)
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({
    detail: {
      payee: {
        id: 'payee-coffee',
        name: 'Coffee',
        defaultCategoryId: null,
        categorizationMode: 'hint',
        note: null,
        logoInitials: null,
        logoColor: null,
      },
      aliases: [],
    },
    categories: [],
  } as never)
  const messages = locale === 'pl' ? pl : en
  render(
    <I18nProvider locale={locale} messages={messages as Catalogue}>
      <PayeeDetail />
    </I18nProvider>,
  )
  await userEvent.type(
    screen.getByRole('textbox', { name: messages['payees.aliases.add'] }),
    'COFFEE SHOP',
  )
  await userEvent.click(
    screen.getByRole('button', { name: messages['action.add'] }),
  )
  expect(addAlias).toHaveBeenCalledWith({
    data: { payeeId: 'payee-coffee', name: 'COFFEE SHOP' },
  })
  return screen.findByRole('alert')
}

describe('Payee detail, a refused alias', () => {
  it.each(['en', 'pl'] as const)(
    'explains possible alias conflicts in %s without exposing server prose',
    async (locale) => {
      const alert = await addRefusedWith(wireFailure('conflict'), locale)
      expect(alert.textContent).toContain(
        locale === 'pl'
          ? 'Opis może już należeć do odbiorcy'
          : 'The text may already belong to a payee',
      )
      expect(alert.textContent).toContain(
        (locale === 'pl' ? pl : en)['payees.aliases.conflict'],
      )
      expect(alert.textContent).not.toContain(
        (locale === 'pl' ? pl : en)['failure.conflict'],
      )
      expect(document.body.textContent).not.toContain(LEAKED_MESSAGE)
      expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
        'COFFEE SHOP',
      )
    },
  )

  it.each([
    ['validation', wireFailure('validation'), en['failure.validation']],
    ['plain error', new Error(LEAKED_MESSAGE), en['failure.internal']],
  ])(
    'keeps the safe generic guidance for %s',
    async (_name, error, sentence) => {
      const alert = await addRefusedWith(error, 'en')
      expect(alert.textContent).toContain(sentence)
      expect(document.body.textContent).not.toContain(LEAKED_MESSAGE)
    },
  )
})
