import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { TextField as RACTextField } from 'react-aria-components/TextField'

import {
  Button,
  Description,
  FieldError,
  Input,
  Label,
  composeTw,
  fieldRow,
  resolveInvalid,
} from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

import type { TextFieldProps as RACTextFieldProps } from 'react-aria-components'
import type { ReactNode } from 'react'
import type { FieldErrorMessage } from '#/components/ui'

export interface PasswordFieldProps extends Omit<
  RACTextFieldProps,
  'children' | 'type' | 'className'
> {
  label: ReactNode
  description?: ReactNode
  errorMessage?: FieldErrorMessage
  /** Pinned to the end of the label row — the "forgotten your password?" link. */
  labelAction?: ReactNode
  className?: string
}

/**
 * A password box with a reveal toggle.
 *
 * ## Why the toggle exists at all
 *
 * A masked box is the single largest source of failed sign-ins, and the usual answer — "type it
 * twice" — doubles the typing without letting anyone *check* what they typed. Revealing is the
 * accessible answer: it is also how somebody with a motor impairment, a phone keyboard or dyslexia
 * verifies a 20-character passphrase. The toggle is a real `Button` with a real accessible name
 * that changes with the state, not an icon that a screen reader announces as "eye".
 *
 * Nothing here blocks paste. A field that refuses a paste is a field that refuses a password
 * manager, and a product that refuses password managers has argued its readers into short
 * passwords they can retype.
 *
 * ## Why it is not built on `TextField`
 *
 * `src/components/ui/text-field.tsx` marks its adornments `aria-hidden` on purpose — they are
 * decoration, and a focusable control inside a hidden subtree is a keyboard trap. The reveal button
 * is the opposite of decoration, so this field composes the same three parts (`Label`,
 * `Description`, `FieldError`) around its own control instead. React Aria's `TextField` container
 * still owns every id, so `aria-describedby` points at the description *and* the error, and
 * `aria-invalid` cannot disagree with the message under the box.
 *
 * The button is positioned over a padded input rather than placed inside a `FieldGroup`, because
 * that group clips its overflow and would take a bite out of the button's focus ring — and a focus
 * ring that is clipped is a focus indicator that fails WCAG 2.2 §2.4.11.
 */
export function PasswordField({
  label,
  description,
  errorMessage,
  labelAction,
  className,
  isRequired,
  isInvalid,
  ...props
}: PasswordFieldProps) {
  const t = useTranslate()
  const [revealed, setRevealed] = useState(false)

  return (
    <RACTextField
      {...props}
      // React re-mounts nothing when this flips: the browser swaps the input's masking in place,
      // so the caret position and the selection survive the toggle.
      type={revealed ? 'text' : 'password'}
      isRequired={isRequired}
      isInvalid={resolveInvalid(isInvalid, errorMessage)}
      className={composeTw(className, fieldRow)}
    >
      <Label isRequired={isRequired} action={labelAction}>
        {label}
      </Label>

      <div className="relative">
        <Input
          inputSize="lg"
          // Room for the 40px button plus the gap it sits in, so a long password never runs
          // underneath the toggle.
          className="pe-13"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <Button
          variant="ghost"
          shape="icon"
          size="sm"
          className="absolute end-1.5 top-1/2 -translate-y-1/2"
          label={revealed ? t('auth.password.hide') : t('auth.password.show')}
          icon={
            revealed ? (
              <EyeOff className="size-[1.125rem]" />
            ) : (
              <Eye className="size-[1.125rem]" />
            )
          }
          onPress={() => setRevealed((current) => !current)}
        />
      </div>

      <Description>{description}</Description>
      <FieldError>{errorMessage}</FieldError>
    </RACTextField>
  )
}
