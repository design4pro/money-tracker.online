/**
 * The three emails a person receives before they have an account to speak of: confirm your address,
 * reset your password, join a household.
 *
 * They are the product's first impression and its worst failure mode at once. Nobody opts into a
 * password reset and nobody can opt out of one, so there is no unsubscribe here (spec A4) — the
 * layout takes none and the footer says only why the message arrived. Everything else is one
 * sentence and one thing to click, because a person reading this is locked out, impatient, and
 * looking for a button.
 *
 * ## It holds no copy and it formats nothing
 *
 * Every string comes from the catalogue through the translator the caller bound to the reader's
 * locale. That is the whole reason this file exists: the English sentences it replaces lived in
 * `src/server/auth/email.ts` as literals, which meant a Polish household got a Polish app and
 * English mail. `{app}` is filled from `app.name` rather than typed, so a rename lands everywhere.
 *
 * ## The link is a bearer credential
 *
 * `url` is a single-use token: whoever holds it holds the account. It goes into the message and
 * nowhere else — never a log line, never a `Preview`, never a `tag`. The one thing the copy adds is
 * saying out loud that it works once, because the alternative is somebody filing the message and
 * clicking it next week.
 */

import { directionOf } from '#/lib/i18n'

import { EmailAction, EmailLayout, EmailMuted, EmailText } from './layout'

import type { Locale, Translate } from '#/lib/i18n'
import type { ReactElement } from 'react'

/**
 * Which auth flow is asking for an email.
 *
 * Defined here rather than beside the sender because this is the module that knows there are
 * exactly three of them and what each one says; `src/server/auth/email.ts` re-exports it so its
 * public surface is unchanged.
 */
export type AuthEmailKind =
  'verify-email' | 'reset-password' | 'organization-invitation'

export interface AuthEmailProps {
  readonly kind: AuthEmailKind
  readonly locale: Locale
  /** Already resolved by the caller — a display name or the address' local part, never empty. */
  readonly recipientName: string
  /** The single-use link. */
  readonly url: string
  /** Only for `organization-invitation`. */
  readonly organizationName?: string
}

/**
 * The subject travels beside the element rather than inside it: it is a header on the envelope, and
 * the one piece of an email that is not part of the document.
 */
export interface AuthEmailDocument {
  readonly subject: string
  readonly element: ReactElement
}

interface AuthCopy {
  readonly subject: string
  readonly lead: string
  readonly action: string
}

/**
 * One arm per kind, calling `t` directly rather than switching on a key name, because the
 * catalogue's placeholders are part of each key's type: `{workspace}` is checked at the call site
 * that has a workspace, and a key looked up through a variable would check nothing.
 */
function copyFor(props: AuthEmailProps, t: Translate): AuthCopy {
  const app = t('app.name')

  switch (props.kind) {
    case 'verify-email':
      return {
        subject: t('email.auth.verifyEmail.subject', { app }),
        lead: t('email.auth.verifyEmail.lead', { app }),
        action: t('email.auth.verifyEmail.action'),
      }
    case 'reset-password':
      return {
        subject: t('email.auth.resetPassword.subject', { app }),
        lead: t('email.auth.resetPassword.lead'),
        action: t('email.auth.resetPassword.action'),
      }
    case 'organization-invitation': {
      // Both call sites pass the name; the generic noun is what the sentence reads as if one ever
      // does not, rather than an empty placeholder or a second English literal.
      const given = props.organizationName?.trim()
      const workspace =
        given === undefined || given === '' ? t('app.workspace.label') : given

      return {
        subject: t('email.auth.invitation.subject', { workspace, app }),
        lead: t('email.auth.invitation.lead', { workspace, app }),
        action: t('email.auth.invitation.action'),
      }
    }
  }
}

export function authEmail(
  props: AuthEmailProps,
  t: Translate,
): AuthEmailDocument {
  const { subject, lead, action } = copyFor(props, t)
  const app = t('app.name')

  return {
    subject,
    element: (
      <EmailLayout
        locale={props.locale}
        dir={directionOf(props.locale)}
        appName={app}
        // The lead, not the subject: the inbox already shows the subject, and repeating it wastes
        // the one line a reader gets before deciding whether to open the message.
        preview={lead}
        footerReason={t('email.layout.footer.reasonAccount', { app })}
      >
        <EmailText>
          {t('email.auth.greeting', { name: props.recipientName })}
        </EmailText>
        <EmailText>{lead}</EmailText>
        <EmailAction href={props.url}>{action}</EmailAction>
        <EmailMuted>{t('email.auth.singleUse')}</EmailMuted>
      </EmailLayout>
    ),
  }
}
