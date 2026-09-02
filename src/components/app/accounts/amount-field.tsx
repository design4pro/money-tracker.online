import { useState } from 'react'

import { TextField } from '#/components/ui'
import { cn } from '#/lib/cn'
import {
  currencySymbol,
  makeMoney,
  parseMoney,
  toAmountInputValue,
} from '#/lib/money'

import type { ReactNode } from 'react'
import type { FieldErrorMessage } from '#/components/ui'
import type { Locale } from '#/lib/i18n'
import type { Minor } from '#/lib/money'

/**
 * The amount input, and the only one on this surface.
 *
 * ## Why this is a text field and not a `NumberField`
 *
 * React Aria's `NumberField` is excellent and hands back a **decimal `number`** — which is a
 * major-unit float, the one representation this product does not allow an amount to take
 * (`docs/MONEY.md`). Turning `12.34` into `1234` needs a multiplication by `10 ** digits`, and
 * that multiplication is exactly where `1.005 → 100.49999999999999` comes from.
 *
 * So the value is never a float at any point in this component's life. `parseMoney` moves the
 * decimal point **inside the string** and returns integer minor units directly; the field's own
 * text is rebuilt from those integers by `toAmountInputValue`, which pads and slices a string
 * rather than dividing. Both directions honour the currency's own `digits`, so a JPY field
 * treats `5000` as five thousand yen and a KWD field keeps three decimals.
 *
 * ## What the reader is allowed to type
 *
 * Whatever their locale leads them to: `1 234,56` in Polish, `1,234.56` in English, a pasted
 * `12,34 zł`, accounting parentheses for a debit. `parseMoney` owns that list and this component
 * owns none of it. Text that is not a single amount reports itself as invalid rather than being
 * guessed at — a form that silently reads `1.2.3` as `123.4` is worse than one that refuses.
 *
 * ## Resynchronising without an effect
 *
 * The typed text is state and the committed amount is a prop, so they can disagree for as long
 * as somebody is mid-keystroke (`1 234,` is not yet an amount). When the amount or the currency
 * changes from the outside — the form loading a different account, a currency picker moving from
 * PLN to JPY and changing the number of decimals — the text is rebuilt during render from the
 * new props. That is React's documented "adjust state when a prop changes" pattern and it costs
 * one extra render, where an effect would cost a paint with the stale text visible.
 */
export interface AmountFieldProps {
  locale: Locale
  /** Integer minor units, or `null` for an empty field. */
  value: Minor | null
  onChange: (value: Minor | null) => void
  /** Decides the decimals, the parse rules and the symbol shown in the box. */
  currencyCode: string
  label: ReactNode
  description?: ReactNode
  /** Shown when the text is not an amount. The caller owns the sentence. */
  invalidMessage?: FieldErrorMessage
  isRequired?: boolean
  isDisabled?: boolean
  /** Field name, so a server-side rejection can be routed back to this field by `Form`. */
  name?: string
  className?: string
}

interface Draft {
  /** What is in the box. */
  readonly text: string
  /** The props the box was last built from, so a change to either rebuilds it. */
  readonly fromValue: Minor | null
  readonly fromCurrency: string
}

function draftFor(
  locale: Locale,
  value: Minor | null,
  currencyCode: string,
): Draft {
  return {
    text:
      value === null
        ? ''
        : toAmountInputValue(locale, makeMoney(value, currencyCode)),
    fromValue: value,
    fromCurrency: currencyCode,
  }
}

export function AmountField({
  locale,
  value,
  onChange,
  currencyCode,
  label,
  description,
  invalidMessage,
  isRequired = false,
  isDisabled = false,
  name,
  className,
}: AmountFieldProps) {
  const [draft, setDraft] = useState<Draft>(() =>
    draftFor(locale, value, currencyCode),
  )

  if (draft.fromValue !== value || draft.fromCurrency !== currencyCode) {
    setDraft(draftFor(locale, value, currencyCode))
  }

  const trimmed = draft.text.trim()
  const parsed =
    trimmed === '' ? null : parseMoney(locale, trimmed, currencyCode)
  const isInvalid = trimmed !== '' && parsed === null

  function handleChange(text: string) {
    const next =
      text.trim() === '' ? null : parseMoney(locale, text, currencyCode)
    setDraft({ text, fromValue: next, fromCurrency: currencyCode })
    // Unparsable text commits nothing: the last good amount stays, and the field reports
    // itself invalid so the form's submit can refuse rather than write a guess.
    if (text.trim() === '' || next !== null) {
      onChange(next)
    }
  }

  return (
    <TextField
      name={name}
      label={label}
      description={description}
      errorMessage={invalidMessage}
      isRequired={isRequired}
      isDisabled={isDisabled}
      isInvalid={isInvalid}
      value={draft.text}
      onChange={handleChange}
      // `decimal` rather than `numeric`: a phone keypad without a decimal separator makes a
      // fractional amount untypeable, which is most amounts.
      inputMode="decimal"
      autoComplete="off"
      suffix={currencySymbol(currencyCode)}
      className={cn('[&_input]:text-end [&_input]:tabular', className)}
    />
  )
}
