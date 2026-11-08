import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { UserMenu } from '../user-menu'

import type { Catalogue } from '#/lib/i18n'

vi.mock('#/lib/auth-client', () => ({
  signOut: vi.fn(),
}))

describe('UserMenu', () => {
  it('puts the visible initials inside the trigger accessible name', () => {
    render(
      <I18nProvider locale="en" messages={en as Catalogue}>
        <UserMenu
          user={{
            id: 'user_1',
            name: 'Demo Household',
            email: 'owner@example.test',
            image: null,
          }}
        />
      </I18nProvider>,
    )

    // WCAG 2.2 §2.5.3: the disc paints "DH", which is not a substring of the
    // person's name, so the aria-label has to mention the initials explicitly.
    expect(
      screen.getByRole('button', {
        name: 'Your account: Demo Household (DH)',
      }),
    ).toBeTruthy()
  })
})
