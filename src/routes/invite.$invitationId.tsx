import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { Button, Card, CardBody, Link, toast } from '#/components/ui'
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
        throw redirect({
          to: '/login',
          search: { redirect: `/invite/${params.invitationId}` },
        })
      }
      throw error
    }
  },
  errorComponent: InvitationMissing,
  head: ({ matches, loaderData }) =>
    pageHead(matches, (t) =>
      loaderData === undefined
        ? undefined
        : t('invite.title', { workspace: loaderData.invitation.workspaceName }),
    ),
  component: InvitationRoute,
})

/**
 * Whether the loader failed because nobody is signed in.
 *
 * `AuthRequirementError` is raised on the server and reaches this loader through the server
 * function boundary, where `instanceof` does not survive the serialisation — the name and the
 * message do. Both are checked: the name is the reliable half, and the sentence is the fallback for
 * a client that flattens the error further.
 */
function isUnauthenticated(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    error.name === 'AuthRequirementError' ||
    /sign in to continue/i.test(error.message)
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
            .catch((error: Error) => {
              toast.error(error.message)
              setJoining(false)
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
