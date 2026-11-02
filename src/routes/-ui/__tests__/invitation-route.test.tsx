import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isRedirect } from '@tanstack/react-router'

import { toast } from '#/components/ui'
import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { acceptInvitation, loadInvitation } from '#/server/fns/members'

import { Route } from '../../invite.$invitationId'

import type * as RouterModule from '@tanstack/react-router'
import type * as UiModule from '#/components/ui'
import type { Catalogue } from '#/lib/i18n'
import type { FailureEnvelope } from '#/lib/failure-envelope'
import type { ComponentType } from 'react'

/**
 * How `/invite/$invitationId` tells "nobody is signed in" from every other refusal.
 *
 * It used to read the error's `name` and a regex over its `message`. The middleware makes both
 * constant, so the route reads the `unauthenticated` kind off the public envelope instead - the
 * legacy name stays as a second condition for one release. The server functions are doubled: what
 * is under test is the route's own branching, with errors shaped as the client rebuilds them.
 */

const router = vi.hoisted(() => ({
  invalidate: vi.fn(() => Promise.resolve()),
  navigate: vi.fn(() => Promise.resolve()),
}))

vi.mock('#/server/fns/members', () => ({
  acceptInvitation: vi.fn(),
  loadInvitation: vi.fn(),
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  useRouter: () => router,
}))
vi.mock('#/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof UiModule>()),
  toast: { success: vi.fn(), error: vi.fn() },
}))

const INVITATION_ID = 'inv-1'
const SIGN_IN = {
  to: '/login',
  search: { redirect: `/invite/${INVITATION_ID}` },
}

/** An error as the client rebuilds it from the wire: fixed message, the envelope as a property. */
function envelopeError(kind: FailureEnvelope['kind']) {
  const envelope = { v: 1, kind, message: { key: `failure.${kind}` } }
  return Object.assign(new Error('This could not be completed.'), { envelope })
}

async function loaderOutcome(error: Error) {
  vi.mocked(loadInvitation).mockRejectedValue(error)
  const loader = Route.options.loader as (ctx: {
    params: { invitationId: string }
  }) => Promise<unknown>
  return loader({ params: { invitationId: INVITATION_ID } }).then(
    () => null,
    (thrown: unknown) => thrown,
  )
}

describe('/invite/$invitationId, the loader', () => {
  it('redirects to sign in, back to this invitation, for an unauthenticated envelope', async () => {
    const thrown = await loaderOutcome(envelopeError('unauthenticated'))

    expect(isRedirect(thrown)).toBe(true)
    expect((thrown as { options: unknown }).options).toMatchObject(SIGN_IN)
  })

  it('still redirects for the legacy error name, for one release', async () => {
    const legacy = new Error('whatever the server said')
    legacy.name = 'AuthRequirementError'

    const thrown = await loaderOutcome(legacy)

    expect(isRedirect(thrown)).toBe(true)
    expect((thrown as { options: unknown }).options).toMatchObject(SIGN_IN)
  })

  it('rethrows a forbidden envelope instead of redirecting', async () => {
    const error = envelopeError('forbidden')

    expect(await loaderOutcome(error)).toBe(error)
  })

  it('no longer reads the sentence: a plain error saying "sign in" is rethrown', async () => {
    const error = new Error('Sign in to continue.')

    expect(await loaderOutcome(error)).toBe(error)
  })
})

describe('/invite/$invitationId, accepting', () => {
  const InvitationRoute = Route.options.component as ComponentType

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Route, 'useParams').mockReturnValue({
      invitationId: INVITATION_ID,
    } as never)
    vi.spyOn(Route, 'useLoaderData').mockReturnValue({
      invitation: {
        state: 'open',
        workspaceName: 'Home',
        invitedEmail: 'a@example.com',
      },
    } as never)
  })

  async function accept(error: Error) {
    vi.mocked(acceptInvitation).mockRejectedValue(error)
    render(
      <I18nProvider locale="en" messages={en as Catalogue}>
        <InvitationRoute />
      </I18nProvider>,
    )
    await userEvent.click(
      screen.getByRole('button', { name: en['invite.accept'] }),
    )
  }

  it('navigates to sign in for an unauthenticated envelope, with no toast', async () => {
    await accept(envelopeError('unauthenticated'))

    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith(SIGN_IN))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each(['forbidden', 'conflict', 'internal'] as const)(
    'toasts the sentence of a %s envelope, never its message',
    async (kind) => {
      await accept(envelopeError(kind))

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(en[`failure.${kind}`]),
      )
      expect(router.navigate).not.toHaveBeenCalled()
    },
  )

  it('toasts the internal sentence for a plain error, never its message', async () => {
    await accept(new Error('Network down'))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(en['failure.internal']),
    )
    expect(toast.error).not.toHaveBeenCalledWith('Network down')
    expect(router.navigate).not.toHaveBeenCalled()
  })
})
