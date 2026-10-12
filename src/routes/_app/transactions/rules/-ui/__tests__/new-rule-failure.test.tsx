import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { createRule } from '#/server/fns/rules'

import { Route } from '../../new'

import type * as RouterModule from '@tanstack/react-router'
import type { Catalogue } from '#/lib/i18n'
import type { FailureEnvelope } from '#/lib/failure-envelope'
import type { RuleEditorProps } from '../rule-editor'
import type { ComponentType } from 'react'

/**
 * What `/transactions/rules/new` shows when `createRule` refuses.
 *
 * The route decides between two screens from the failure's *kind*, read off the public envelope:
 * the locked-plan card for `feature_locked`, and the generic failure line for everything else. The
 * server function and the editor are doubled, because what is under test is the route's own
 * branching - the editor has its own tests and the envelope has its own wire proof.
 */

vi.mock('#/server/fns/rules', () => ({ createRule: vi.fn() }))
vi.mock('../../../-server/list', () => ({
  loadTransactionReference: vi.fn(),
}))
vi.mock('../../../../-lib/refresh', () => ({
  useDataRefresh: () => () => Promise.resolve(),
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
}))
vi.mock('../rule-editor', () => ({
  ruleEditorReference: () => ({ categories: [], payees: [], tags: [] }),
  RuleEditor: ({ saveError, onSave }: RuleEditorProps) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onSave({
            name: 'Coffee',
            matchMode: 'all',
            conditions: [],
            actions: [],
            runOn: ['manual_create'],
          } as never)
        }
      >
        save
      </button>
      {saveError === null ? null : <p data-testid="save-error">{saveError}</p>}
    </div>
  ),
}))

const NewRuleRoute = Route.options.component as ComponentType

/** An error as the client rebuilds it from the wire: fixed message, the envelope as a property. */
function envelopeError(kind: FailureEnvelope['kind']) {
  const envelope = {
    v: 1,
    kind,
    message: { key: `failure.${kind}` },
  }
  return Object.assign(new Error('This could not be completed.'), { envelope })
}

async function saveWith(error: Error) {
  vi.mocked(createRule).mockRejectedValue(error)
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({ reference: {} } as never)
  vi.spyOn(Route, 'useNavigate').mockReturnValue(vi.fn() as never)

  render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <NewRuleRoute />
    </I18nProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'save' }))
}

describe('/transactions/rules/new, a refused save', () => {
  beforeEach(() => {
    vi.mocked(createRule).mockReset()
  })

  it('shows the locked-plan card for a feature_locked envelope', async () => {
    await saveWith(envelopeError('feature_locked'))

    expect(
      await screen.findByRole('heading', {
        name: en['rules.empty.locked.title'],
      }),
    ).toBeTruthy()
    expect(screen.queryByTestId('save-error')).toBeNull()
  })

  it.each(['conflict', 'validation', 'quota', 'internal'] as const)(
    'shows the generic failure line, not the locked card, for a %s envelope',
    async (kind) => {
      await saveWith(envelopeError(kind))

      const line = await screen.findByTestId('save-error')
      expect(line.textContent).toBe('This could not be completed.')
      expect(
        screen.queryByRole('heading', { name: en['rules.empty.locked.title'] }),
      ).toBeNull()
    },
  )

  it('no longer reads the code out of a plain error message', async () => {
    await saveWith(new Error('FEATURE_LOCKED: automation is not on this plan'))

    await waitFor(() => expect(screen.getByTestId('save-error')).toBeTruthy())
    expect(
      screen.queryByRole('heading', { name: en['rules.empty.locked.title'] }),
    ).toBeNull()
  })
})
