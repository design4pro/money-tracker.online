import { CircleAlert } from 'lucide-react'

import { useTranslate } from '#/lib/i18n'

export interface FormErrorProps {
  /** The already-translated sentence. `authFailureMessage` produces it. */
  message: string
}

/**
 * The form-level refusal panel: what the server said no to, said once, above the fields.
 *
 * ## Why this is not a `FieldError`
 *
 * A field error belongs to a box the reader can fix. "That email address and password do not
 * match" belongs to *neither* box — putting it under the password field tells the reader their
 * password is wrong when the address might be, and putting it under both says it twice. Anything
 * the server rejected the pair for is rendered here; anything it rejected one field for is routed
 * into that field through the `Form`'s `validationErrors`.
 *
 * ## Why `role="alert"`
 *
 * It is mounted in response to a submission the reader made, at a point in the document they are
 * not looking at — focus is still in the form below. `role="alert"` is an assertive live region, so
 * the sentence is read out at the moment it appears rather than being discovered on the next Tab.
 * This is one of the few places assertiveness is right: the reader asked a question and this is the
 * answer.
 *
 * The colour is never the message. There is a heading, a sentence and a glyph; a reader who cannot
 * see the red still gets all three.
 */
export function FormError({ message }: FormErrorProps) {
  const t = useTranslate()

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-negative/30 bg-negative-soft px-4 py-3.5"
    >
      <CircleAlert
        aria-hidden="true"
        className="mt-px size-[1.125rem] shrink-0 text-negative"
      />
      <div className="min-w-0">
        <p className="text-label font-semibold text-negative">
          {t('auth.error.title')}
        </p>
        <p className="mt-1 text-caption text-negative">{message}</p>
      </div>
    </div>
  )
}
