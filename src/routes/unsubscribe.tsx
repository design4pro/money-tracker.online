import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'

import { Button, Card, CardBody, Link } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { pageHead } from '#/routes/-lib/page-title'
import { MAIN_CONTENT_ID } from './__root'
import {
  confirmUnsubscribe,
  readUnsubscribeLink,
  unsubscribeInputSchema,
} from '#/server/fns/unsubscribe'

import type { NotificationKind } from '#/lib/enums'
import type { MessageKey } from '#/lib/i18n'
import type { UnsubscribeOutcome } from '#/server/email/unsubscribe'
import type { UnsubscribeSubject } from '#/server/email/unsubscribe-token'

/**
 * `/unsubscribe?t=…` — where the "Stop these emails" link in a notification email lands.
 *
 * ## Public, and outside `_app`
 *
 * Nobody signs in to stop an email: an unsubscribe link that demands a login is a spam complaint.
 * The signed token is the whole authority, checked in `#/server/email/unsubscribe`, so this route
 * sits at the top level like `invite.$invitationId.tsx` and reads no session.
 *
 * ## Opening the link never changes anything
 *
 * Mail scanners prefetch links, so the loader only *reads* the token and renders **confirm**. The
 * one write is the button's `POST`, which re-renders **done**. Every link that does not work —
 * expired, tampered, another version, a workspace the person has left, a deployment with no
 * signing secret — renders the same **invalid** state, which does not say which check failed.
 *
 * ## After the button
 *
 * The result replaces the card in place, so focus moves to the new `h1` and a `role="status"`
 * region announces it; otherwise a screen reader would be left on a button that no longer exists.
 */

const searchSchema = z.object({
  t: z.string().optional().catch(undefined),
})

/** A kind named as a topic. Listed here rather than derived: the registry is server-only. */
const TOPIC_KEYS: Readonly<Record<NotificationKind, MessageKey>> = {
  'budget.threshold_crossed': 'notifications.kind.budgetThresholdCrossed.label',
  'budget.exceeded': 'notifications.kind.budgetExceeded.label',
  'recurring.due_soon': 'notifications.kind.recurringDueSoon.label',
  'recurring.overdue': 'notifications.kind.recurringOverdue.label',
  'goal.reached': 'notifications.kind.goalReached.label',
}

function topicKey(subject: UnsubscribeSubject): MessageKey {
  return subject === 'digest' ? 'unsubscribe.topic.digest' : TOPIC_KEYS[subject]
}

const INVALID: UnsubscribeOutcome = { ok: false }

export const Route = createFileRoute('/unsubscribe')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ t: search.t }),
  loader: async ({ deps }) => {
    // A missing or oversized token is invalid without a round trip, by the server function's own
    // schema.
    const parsed = unsubscribeInputSchema.safeParse({ t: deps.t })
    if (!parsed.success) return { token: null, outcome: INVALID }
    return {
      token: parsed.data.t,
      outcome: await readUnsubscribeLink({ data: parsed.data }),
    }
  },
  head: ({ matches }) => pageHead(matches, (t) => t('unsubscribe.meta.title')),
  component: UnsubscribeRoute,
})

type Result = 'done' | 'invalid'

function UnsubscribeRoute() {
  const t = useTranslate()
  const { token, outcome: read } = Route.useLoaderData()
  const [applied, setApplied] = useState<UnsubscribeOutcome | null>(null)
  const [isPending, setPending] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)

  const result: Result | null =
    applied === null ? null : applied.ok ? 'done' : 'invalid'

  useEffect(() => {
    if (result !== null) heading.current?.focus()
  }, [result])

  const outcome = applied ?? read
  const title = !outcome.ok
    ? t('unsubscribe.invalid.title')
    : result === 'done'
      ? t('unsubscribe.done.title')
      : t('unsubscribe.confirm.title')

  return (
    // `tabIndex={-1}` is what lets the document shell's skip link move focus here.
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="mx-auto flex min-h-dvh max-w-xl items-center px-4 py-10 outline-none"
    >
      {/* Mounted from the first render and never replaced, so the text that lands in it after the
          button is announced rather than arriving inside a region that did not exist yet. */}
      <p role="status" className="sr-only">
        {result === null ? '' : title}
      </p>
      <Card padding="lg" className="w-full">
        <CardBody className="flex flex-col items-start gap-4">
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-title font-bold text-ink outline-none"
          >
            {title}
          </h1>
          {!outcome.ok || token === null ? (
            <>
              <p className="max-w-[60ch] text-body text-ink-2">
                {t('unsubscribe.invalid.body')}
              </p>
              <Link
                href="/login"
                className="target-min inline-flex min-h-11 items-center"
              >
                {t('unsubscribe.invalid.signIn')}
              </Link>
            </>
          ) : result === 'done' ? (
            <p className="max-w-[60ch] text-body text-ink-2">
              {t('unsubscribe.done.body', {
                topic: t(topicKey(outcome.subject)),
                workspace: outcome.workspaceName,
              })}
            </p>
          ) : (
            <>
              <p className="max-w-[60ch] text-body text-ink-2">
                {t('unsubscribe.confirm.body', {
                  topic: t(topicKey(outcome.subject)),
                  workspace: outcome.workspaceName,
                })}
              </p>
              <Button
                variant="primary"
                size="lg"
                isPending={isPending}
                onPress={() => {
                  setPending(true)
                  void confirmUnsubscribe({ data: { t: token } })
                    .then(setApplied)
                    .catch(() => {
                      // A request that never got an answer says nothing about the link, so the
                      // button stays for another try rather than claiming the link is invalid.
                      setPending(false)
                    })
                }}
              >
                {t('unsubscribe.confirm.action')}
              </Button>
            </>
          )}
        </CardBody>
      </Card>
    </main>
  )
}
