/**
 * Synthetic props for every message this product sends, so a reviewer can look
 * at the HTML without triggering a send.
 *
 * Values are clearly fake: `example.test` URLs, "Ada", "Example household".
 * There are no token-like strings, no mailbox addresses, and no amounts — the
 * templates accept none (ADR 0035).
 */

import { NOTIFICATION_KIND_IDS } from '#/lib/enums'

import { AUTH_EMAIL_KINDS, authEmail } from './auth'
import { digestEmail } from './digest'
import { notificationEmail } from './notification'

import type { NotificationKind } from '#/lib/enums'
import type { Locale, Translate } from '#/lib/i18n'
import type { ReactElement } from 'react'
import type { AuthEmailKind } from './auth'

export type EmailPreviewFamily = 'auth' | 'notification' | 'digest'

export interface EmailPreviewDocument {
  readonly subject: string
  readonly element: ReactElement
}

export interface EmailPreviewFixture {
  readonly name: string
  readonly family: EmailPreviewFamily
  /** Deep-link / CTA URLs that the plain-text part must write out. */
  readonly ctaHrefs: ReadonlyArray<string>
  readonly build: (t: Translate, locale: Locale) => EmailPreviewDocument
}

const HOUSEHOLD = 'Example household'
const PERSON = 'Ada'
const VERIFY_HREF = 'https://example.test/verify'
const RESET_HREF = 'https://example.test/reset'
const INVITE_HREF = 'https://example.test/invite'
const STOP_EMAILS_HREF = 'https://example.test/stop-emails'

function notificationHref(kind: NotificationKind): string {
  switch (kind) {
    case 'budget.threshold_crossed':
    case 'budget.exceeded':
      return `https://example.test/app/budgets/${kind}`
    case 'recurring.due_soon':
    case 'recurring.overdue':
      return `https://example.test/app/recurring/${kind}`
    case 'goal.reached':
      return `https://example.test/app/goals/${kind}`
  }
}

function authFixture(kind: AuthEmailKind): EmailPreviewFixture {
  const href =
    kind === 'verify-email'
      ? VERIFY_HREF
      : kind === 'reset-password'
        ? RESET_HREF
        : INVITE_HREF

  return {
    name: kind,
    family: 'auth',
    ctaHrefs: [href],
    build(t, locale) {
      return authEmail(
        {
          kind,
          locale,
          recipientName: PERSON,
          url: href,
          ...(kind === 'organization-invitation'
            ? { organizationName: HOUSEHOLD }
            : {}),
        },
        t,
      )
    },
  }
}

function notificationFixture(kind: NotificationKind): EmailPreviewFixture {
  const href = notificationHref(kind)
  return {
    name: kind,
    family: 'notification',
    ctaHrefs: [href],
    build(t, locale) {
      return notificationEmail(
        {
          kind,
          locale,
          actionHref: href,
          workspaceName: HOUSEHOLD,
          unsubscribe: {
            href: STOP_EMAILS_HREF,
            label: t('email.layout.footer.unsubscribe'),
          },
        },
        t,
      )
    },
  }
}

export const AUTH_PREVIEW_FIXTURES = {
  'verify-email': authFixture('verify-email'),
  'reset-password': authFixture('reset-password'),
  'organization-invitation': authFixture('organization-invitation'),
} satisfies Record<AuthEmailKind, EmailPreviewFixture>

export const NOTIFICATION_PREVIEW_FIXTURES = {
  'budget.threshold_crossed': notificationFixture('budget.threshold_crossed'),
  'budget.exceeded': notificationFixture('budget.exceeded'),
  'recurring.due_soon': notificationFixture('recurring.due_soon'),
  'recurring.overdue': notificationFixture('recurring.overdue'),
  'goal.reached': notificationFixture('goal.reached'),
} satisfies Record<NotificationKind, EmailPreviewFixture>

const DIGEST_ITEMS = NOTIFICATION_KIND_IDS.map((kind) => ({
  kind,
  href: notificationHref(kind),
}))

export const DIGEST_PREVIEW_FIXTURE: EmailPreviewFixture = {
  name: 'digest',
  family: 'digest',
  ctaHrefs: DIGEST_ITEMS.map((item) => item.href),
  build(t, locale) {
    return digestEmail(
      {
        locale,
        workspaceName: HOUSEHOLD,
        items: DIGEST_ITEMS,
        unsubscribe: {
          href: STOP_EMAILS_HREF,
          label: t('email.layout.footer.unsubscribe'),
        },
      },
      t,
    )
  },
}

export const EMAIL_PREVIEW_FIXTURES: ReadonlyArray<EmailPreviewFixture> = [
  ...AUTH_EMAIL_KINDS.map((kind) => AUTH_PREVIEW_FIXTURES[kind]),
  ...NOTIFICATION_KIND_IDS.map((kind) => NOTIFICATION_PREVIEW_FIXTURES[kind]),
  DIGEST_PREVIEW_FIXTURE,
]
