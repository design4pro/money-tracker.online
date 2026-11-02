import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { candidateRow } from '#/components/app/recurring/__tests__/harness'
import { toast } from '#/components/ui'
import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { dismissCandidate } from '#/server/fns/recurring'
import { Route } from '../../candidates'

import type * as RouterModule from '@tanstack/react-router'
import type { Catalogue } from '#/lib/i18n'
import type { ComponentType, ReactNode } from 'react'

/**
 * A refused dismiss on `/recurring/candidates` must still toast, refresh and
 * clear the busy row. The previous chain only `.then`ed success, so a refusal
 * was an unhandled rejection with no toast and no refresh (#705).
 */

const refresh = vi.fn(() => Promise.resolve())

vi.mock('#/server/fns/recurring', () => ({
  acceptCandidate: vi.fn(),
  detectRecurring: vi.fn(),
  dismissCandidate: vi.fn(),
  loadCandidates: vi.fn(),
}))
vi.mock('#/server/fns/accounts', () => ({ listAccounts: vi.fn() }))
vi.mock('#/server/fns/categories', () => ({ listCategories: vi.fn() }))
vi.mock('#/server/fns/payees', () => ({ listPayees: vi.fn() }))
vi.mock('../../../-lib/refresh', () => ({
  useDataRefresh: () => refresh,
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
  Link: ({ children }: { readonly children: ReactNode }) => (
    <a href="/recurring">{children}</a>
  ),
}))

const CandidateList = Route.options.component as ComponentType

function renderList() {
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({
    candidates: [candidateRow()],
    accounts: { accounts: [] },
    categories: [],
    payees: [],
  } as never)
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <CandidateList />
    </I18nProvider>,
  )
}

describe('Candidates list, a refused dismiss', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    refresh.mockClear()
  })

  it('shows the failure toast, refreshes and clears the busy row', async () => {
    let refuse: (error: unknown) => void = () => undefined
    vi.mocked(dismissCandidate).mockImplementation(
      () =>
        new Promise((_, reject) => {
          refuse = reject
        }),
    )
    vi.spyOn(toast, 'success')
    vi.spyOn(toast, 'error')
    renderList()

    const dismiss = screen.getByRole('button', {
      name: 'Dismiss the suggestion for Netflix',
    })
    await userEvent.click(dismiss)

    expect(dismissCandidate).toHaveBeenCalledExactlyOnceWith({
      data: { candidateId: 'cand-1' },
    })
    expect(dismiss.getAttribute('disabled')).not.toBeNull()

    refuse(new Error('already dismissed'))

    await waitFor(() => {
      expect(dismiss.getAttribute('disabled')).toBeNull()
    })
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      en['recurring.toast.failed'],
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
