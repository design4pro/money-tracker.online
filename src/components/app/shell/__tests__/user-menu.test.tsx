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

    // WCAG 2.2 §2.5.3 / axe 4.14: the disc paints "DH". That token is not in
    // the person's name, and parentheticals are stripped before the match, so
    // the initials have to appear as a bare word in the aria-label.
    expect(
      screen.getByRole('button', {
        name: 'Your account: Demo Household DH',
      }),
    ).toBeTruthy()
  })
})
