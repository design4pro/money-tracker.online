/**
 * One notification email: the event name, a line that says to open the app, and a deep link.
 *
 * **This is not a money surface** (ADR 0035). The payload's amounts, payee / account / category
 * names and transaction rows stay in the in-app notification. The mail names the kind as a topic
 * and points at `APP_URL + deepLink`. `renderCopyParams` is not imported here on purpose.
 */

import { Heading } from '@react-email/components'

import { directionOf } from '#/lib/i18n'

import { EmailAction, EmailLayout, EmailText, emailStyles } from './layout'

import type { NotificationKind } from '#/lib/enums'
import type { Locale, Translate } from '#/lib/i18n'
import type { ReactElement } from 'react'
import type { EmailUnsubscribe } from './layout'

export interface NotificationEmailProps {
  readonly kind: NotificationKind
  readonly locale: Locale
  readonly actionHref: string
  readonly workspaceName: string
  /** Phase 4 signs this. Phase 2 leaves it off. */
  readonly unsubscribe?: EmailUnsubscribe
}

export interface NotificationEmailDocument {
  readonly subject: string
  readonly element: ReactElement
}

/** The kind as a topic, which is the event name the inbox is allowed to see. */
export function eventNameOf(kind: NotificationKind, t: Translate): string {
  switch (kind) {
    case 'budget.threshold_crossed':
      return t('notifications.kind.budgetThresholdCrossed.label')
    case 'budget.exceeded':
      return t('notifications.kind.budgetExceeded.label')
    case 'recurring.due_soon':
      return t('notifications.kind.recurringDueSoon.label')
    case 'recurring.overdue':
      return t('notifications.kind.recurringOverdue.label')
    case 'goal.reached':
      return t('notifications.kind.goalReached.label')
  }
}

export function notificationEmail(
  props: NotificationEmailProps,
  t: Translate,
): NotificationEmailDocument {
  const app = t('app.name')
  const eventName = eventNameOf(props.kind, t)
  const workspace =
    props.workspaceName.trim() === ''
      ? t('app.workspace.label')
      : props.workspaceName

  return {
    subject: eventName,
    element: (
      <EmailLayout
        locale={props.locale}
        dir={directionOf(props.locale)}
        appName={app}
        preview={eventName}
        footerReason={t('email.layout.footer.reason', { workspace, app })}
        unsubscribe={props.unsubscribe}
      >
        <Heading as="h2" className="email-ink" style={emailStyles.heading}>
          {eventName}
        </Heading>
        <EmailText>{t('email.notification.body', { app })}</EmailText>
        <EmailAction href={props.actionHref}>
          {t('email.notification.action', { app })}
        </EmailAction>
      </EmailLayout>
    ),
  }
}
