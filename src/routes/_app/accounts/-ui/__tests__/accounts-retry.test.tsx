import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { Route } from '../../index'

import type * as RouterModule from '@tanstack/react-router'
import type { ComponentType } from 'react'

const invalidate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  useRouter: () => ({ invalidate }),
}))
vi.mock('#/server/fns/accounts', () => ({
  archiveAccount: vi.fn(),
  listAccountGroups: vi.fn(),
  listAccounts: vi.fn(),
  restoreAccount: vi.fn(),
}))

it('retries the failed Accounts loader instead of only clearing its boundary', async () => {
  const ErrorComponent = Route.options.errorComponent as ComponentType<{
    reset: () => void
  }>
  const reset = vi.fn()
  render(
    <I18nProvider locale="en" messages={en}>
      <ErrorComponent reset={reset} />
    </I18nProvider>,
  )
  await userEvent.click(
    screen.getByRole('button', { name: en['action.retry'] }),
  )
  expect(invalidate).toHaveBeenCalledOnce()
  expect(reset).not.toHaveBeenCalled()
})
