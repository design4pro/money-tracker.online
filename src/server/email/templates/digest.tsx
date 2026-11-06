/**
 * The nightly summary: event names grouped by kind, each with a deep link.
 *
 * **This is not a money surface** (ADR 0035). The digest names what happened and points into the
 * app. It sums nothing and interpolates no payload.
 */

import { Heading, Link, Text } from '@react-email/components'

import { directionOf } from '#/lib/i18n/locales'
import { eventNameOf } from './notification'
import { EmailLayout, EmailMuted, emailStyles } from './layout'

import type { NotificationKind } from '#/lib/enums'
import type { Locale, Translate } from '#/lib/i18n'
import type { ReactElement } from 'react'
import type { EmailUnsubscribe } from './layout'

export interface DigestEmailItem {
  readonly kind: NotificationKind
  readonly href: string
}

export interface DigestEmailProps {
  readonly locale: Locale
  readonly workspaceName: string
  readonly items: ReadonlyArray<DigestEmailItem>
  readonly unsubscribe?: EmailUnsubscribe
}

export interface DigestEmailDocument {
  readonly subject: string
  readonly element: ReactElement
}

function groupItems(
  items: ReadonlyArray<DigestEmailItem>,
  t: Translate,
): ReadonlyArray<{
  readonly label: string
  readonly items: ReadonlyArray<DigestEmailItem>
}> {
  const groups: Array<{
    kind: NotificationKind
    label: string
    items: Array<DigestEmailItem>
  }> = []
  for (const item of items) {
    const last = groups.at(-1)
    if (last && last.kind === item.kind) {
      last.items.push(item)
      continue
    }
    groups.push({
      kind: item.kind,
      label: eventNameOf(item.kind, t),
      items: [item],
    })
  }
  return groups
}

export function digestEmail(
  props: DigestEmailProps,
  t: Translate,
): DigestEmailDocument {
  const app = t('app.name')
  const workspace =
    props.workspaceName.trim() === ''
      ? t('app.workspace.label')
      : props.workspaceName
  const heading = t('email.digest.heading')
  const groups = groupItems(props.items, t)

  return {
    subject: t('email.digest.subject', {
      count: props.items.length,
      workspace,
    }),
    element: (
      <EmailLayout
        locale={props.locale}
        dir={directionOf(props.locale)}
        appName={app}
        preview={heading}
        footerReason={t('email.layout.footer.reason', { workspace, app })}
        unsubscribe={props.unsubscribe}
      >
        <Heading as="h2" className="email-ink" style={emailStyles.heading}>
          {heading}
        </Heading>
        <EmailMuted>{t('email.digest.intro', { workspace })}</EmailMuted>
        {groups.map((group) => (
          <section key={group.label}>
            <Heading
              as="h3"
              className="email-ink"
              style={emailStyles.groupHeading}
            >
              {group.label}
            </Heading>
            {group.items.map((item) => (
              <Text
                key={item.href}
                className="email-ink"
                style={{ ...emailStyles.paragraph, margin: '0 0 8px' }}
              >
                <Link
                  className="email-link"
                  href={item.href}
                  style={emailStyles.link}
                >
                  {group.label}
                </Link>
              </Text>
            ))}
          </section>
        ))}
      </EmailLayout>
    ),
  }
}
