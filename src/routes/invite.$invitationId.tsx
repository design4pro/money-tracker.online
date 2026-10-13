import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { Button, Card, CardBody, Link, Skeleton, toast } from '#/components/ui'
import { failureOf, readFailure } from '#/lib/failure'
import { useTranslate } from '#/lib/i18n'
import { acceptInvitation, loadInvitation } from '#/server/fns/members'

import type { InvitationView } from '#/server/repos/members'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/invite/$invitationId` — the screen an invited person lands on.
 *
 * ## Outside `_app`, deliberately
 *
 * The acceptor is not a member of the workspace yet, so the guarded application shell cannot render
 * for them: it resolves a workspace from the session, and the one in the link is not it. This route
 * sits at the top level and requires only a signed-in **account**.
 *
 * ## Signing in first is part of the flow, not an error
 *
 * Somebody invited by email may not have an account at all. An unauthenticated visit redirects to
 * `/login` carrying this path as the return target — the same `safeRedirect` contract the auth
 * screens already honour — so registering and coming back is one continuous path rather than a dead
 * end with a link to copy.
 *
 * ## Every state has its own sentence
 *
 * Expired, withdrawn, already used, already a member, and **wrong account** — the last of which
 * names the address the invitation was issued to, because that is the only fact that lets somebody
 * recover from it. An id that was never issued is a 404 from the server function rather than a
 * state here: a screen that renders "not valid" for any id is an oracle for guessing them.
 */

export const Route = createFileRoute('/invite/$invitationId')({
  loader: async ({ params }) => {
    try {
      return {
        invitation: await loadInvitation({
          data: { invitationId: params.invitationId },
        }),
      }
    } catch (error) {
      // An unauthenticated visitor is sent to sign in and brought back here, rather than being
      // told the invitation is broken — which it is not.
      if (isUnauthenticated(error)) {
        throw redirect(signInTarget(params.invitationId))
      }
      throw error
    }
  },
  pendingComponent: InvitationSkeleton,
  errorComponent: InvitationMissing,
  head: ({ matches, loaderData }) =>
    pageHead(matches, (t) =>
      loaderData === undefined
        ? undefined
        : t('invite.title', { workspace: loaderData.invitation.workspaceName }),
    ),
  component: InvitationRoute,
})

/** The sign-in screen, carrying this invitation as the return target (`safeRedirect` contract). */
function signInTarget(invitationId: string) {
  return {
    to: '/login',
    search: { redirect: `/invite/${invitationId}` },
  } as const
}

/**
 * Whether the loader failed because nobody is signed in.
 *
 * The server's failure middleware replaces the error with one whose name and message are fixed, so
 * the answer is the `unauthenticated` kind of its public envelope (`readFailure`). The error's name
 * stays as a second condition for one release, for a Worker that predates the middleware; the
 * message regex is gone, because the sentence is no longer the server's to vary.
 *
 * A banned account is refused with a 403 by the same user guard, which classifies as `forbidden`:
 * it no longer takes the sign-in redirect, because signing in again cannot help it.
 */
function isUnauthenticated(error: unknown): boolean {
  if (readFailure(error)?.kind === 'unauthenticated') return true
  return error instanceof Error && error.name === 'AuthRequirementError'
}

/**
 * The invitation card while the loader is in flight.
 *
 * This screen is reached by someone who has just followed a link out of their mail — often having
 * signed in on the way, so the loader runs on the client and is the slowest thing between them and
 * a decision. Until now the route declared nothing and they watched the login screen instead.
 *
 * It borrows {@link InvitationFrame}'s own geometry rather than restating it, so the card does not
 * move when the workspace name lands. `Skeleton` is `aria-hidden`, and the one `role="status"`
 * paragraph carries the announcement.
 */
function InvitationSkeleton() {
  const t = useTranslate()
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl items-center px-4 py-10">
      <Card padding="lg" className="w-full">
        <CardBody className="flex flex-col items-start gap-4">
          <p role="status" className="sr-only">
            {t('invite.loading')}
          </p>
          <Skeleton shape="block" className="h-8 w-64 rounded-md" />
          <Skeleton shape="text" lines={2} className="w-full max-w-[60ch]" />
          <Skeleton shape="block" className="h-10 w-40 rounded-md" />
        </CardBody>
      </Card>
    </main>
  )
}

function InvitationMissing() {
  const t = useTranslate()
  return (
    <InvitationFrame title={t('invite.notFound')}>
      <Link href="/dashboard">{t('invite.goToApp')}</Link>
    </InvitationFrame>
  )
}

function InvitationRoute() {
  const t = useTranslate()
  const { invitation } = Route.useLoaderData()
  const params = Route.useParams()
  const router = useRouter()
  const [isJoining, setJoining] = useState(false)

  if (invitation.state !== 'open') {
    return (
      <InvitationFrame
        title={t('invite.title', { workspace: invitation.workspaceName })}
      >
        <p className="text-body text-ink-2">
          <ClosedState view={invitation} />
        </p>
        <Link href="/dashboard">{t('invite.goToApp')}</Link>
      </InvitationFrame>
    )
  }

  return (
    <InvitationFrame
      title={t('invite.title', { workspace: invitation.workspaceName })}
      description={t('invite.body')}
    >
      <p className="text-caption text-ink-2">
        {t('invite.invitedAs', { email: invitation.invitedEmail })}
      </p>
      <Button
        variant="primary"
        isPending={isJoining}
        onPress={() => {
          setJoining(true)
          void acceptInvitation({ data: { invitationId: params.invitationId } })
            .then(() => {
              toast.success(
                t('invite.joined', { workspace: invitation.workspaceName }),
              )
              // A full document load: the session's active workspace and the whole shell around it
              // are resolved on the server, and a client-side navigation would leave the reader
              // inside their previous workspace's already-fetched data.
              window.location.assign('/dashboard')
            })
            .catch((error: unknown) => {
              setJoining(false)
              // The session ended between loading this card and pressing the button: sign in and
              // come back, as the loader does, rather than toasting a sentence with no way on.
              if (readFailure(error)?.kind === 'unauthenticated') {
                void router.navigate(signInTarget(params.invitationId))
                return
              }
              toast.error(t(failureOf(error).message.key))
              void router.invalidate()
            })
        }}
      >
        {t('invite.accept')}
      </Button>
    </InvitationFrame>
  )
}

/** The sentence for an invitation that cannot be accepted as it stands. */
function ClosedState({ view }: { view: InvitationView }) {
  const t = useTranslate()
  switch (view.state) {
    case 'expired':
      return <>{t('invite.state.expired')}</>
    case 'revoked':
      return <>{t('invite.state.revoked')}</>
    case 'accepted':
      return <>{t('invite.state.accepted')}</>
    case 'already-member':
      return <>{t('invite.state.alreadyMember')}</>
    case 'wrong-account':
      return <>{t('invite.state.wrongAccount', { email: view.invitedEmail })}</>
    case 'open':
      return null
  }
}

function InvitationFrame({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl items-center px-4 py-10">
      <Card padding="lg" className="w-full">
        <CardBody className="flex flex-col items-start gap-4">
          {/* The page's own `h1` rather than the card header's heading: `CardHeader` starts at
              level 2, and this screen has no heading above it to be second to. */}
          <h1 className="text-title font-bold text-ink">{title}</h1>
          {description === undefined ? null : (
            <p className="max-w-[60ch] text-body text-ink-2">{description}</p>
          )}
          {children}
        </CardBody>
      </Card>
    </main>
  )
}
