import { useId, useState } from 'react'

import { cn } from '#/lib/cn'
import {
  currencyName,
  currencySymbol,
  makeMoney,
  parseMoney,
  toAmountInputValue,
} from '#/lib/money'
import { TextField } from './text-field'

import type { ReactNode } from 'react'
import type { Locale } from '#/lib/i18n'
import type { Minor } from '#/lib/money'
import type { FieldErrorMessage } from './text-field'
import type { FieldSize } from './shared'

/**
 * The amount input, and the only one in the product.
 *
 * ## Why the value is never a float, decided by measurement rather than by argument
 *
 * This component replaces two that disagreed. One serialised through a canonical decimal string;
 * the other let React Aria's `NumberField` hand back a major-unit `number` and scaled that. Each
 * docblock treated the other's approach as the defect, and #106 settled it by measuring both —
 * the table is `./__tests__/money-field-conversion.test.ts`.
 *
 * The finding: both ended in `scaleDecimalString`, so they agreed on every amount a person can
 * put in a form, ties included. They parted company only at `MAX_MINOR`, and there the float
 * route was the wrong one — a minor unit low in each direction, and a thrown `MoneyOverflowError`
 * past the boundary where the string route reports `null`. So the string route is what survived.
 *
 * `parseMoney` moves the decimal point **inside the string** and returns integer minor units
 * directly; the field's own text is rebuilt from those integers by `toAmountInputValue`, which
 * pads and slices rather than dividing. There is no code path here that hands a consumer a float,
 * a string, or a number of major units. Both directions honour the currency's own `digits`, so a
 * JPY field treats `5000` as five thousand yen and a KWD field keeps three decimals — the scale
 * is read from the code and is never a parameter, because two sources for one truth is how a
 * hard-coded `100` gets in.
 *
 * ## What the reader is allowed to type
 *
 * Whatever their locale leads them to: `1 234,56` in Polish, `1,234.56` in English, a pasted
 * `12,34 zł`, accounting parentheses for a debit. `parseMoney` owns that list and this component
 * owns none of it. Text that is not a single amount reports itself as invalid rather than being
 * guessed at — a form that silently reads `1.2.3` as `123.4` is worse than one that refuses.
 *
 * ## The currency is written twice, and only one of them is read aloud
 *
 * The symbol stands as a trailing adornment inside the box, so an empty field already says what
 * it is asking for. `TextField` marks every adornment `aria-hidden`, which is right — a symbol is
 * ambiguous between currencies that share one. What a screen reader hears instead is the
 * currency's full name in the reader's own language, wired through `aria-describedby` beside the
 * field's own description and error.
 *
 * ## Resynchronising without an effect
 *
 * The typed text is state and the committed amount is a prop, so they can disagree for as long as
 * somebody is mid-keystroke (`1 234,` is not yet an amount). When the amount or the currency
 * changes from the outside — a form loading a different account, a currency picker moving from
 * PLN to JPY and changing the number of decimals — the text is rebuilt during render from the new
 * props. That is React's documented "adjust state when a prop changes" pattern and it costs one
 * extra render, where an effect would cost a paint with the stale text visible.
 */
export interface MoneyFieldProps {
  /**
   * Read as a prop rather than from context: this is the field a split editor renders a dozen of,
   * and the one whose output a test wants to assert against a named locale.
   */
  locale: Locale
  /** Integer minor units, or `null` for an empty field. */
  value: Minor | null
  onChange: (value: Minor | null) => void
  /** Decides the decimals, the parse rules and the symbol shown in the box. */
  currencyCode: string
  label: ReactNode
  description?: ReactNode
  /**
   * The caller's own message — a form rule, a server-side rejection. Shown whenever it is
   * present, and it flips the field invalid.
   */
  errorMessage?: FieldErrorMessage
  /**
   * What to say when the text in the box is not an amount at all. That is a condition only this
   * component can see, which is why it is a separate slot from {@link errorMessage} — but the
   * caller still owns the sentence, because the catalogue lives outside `components/ui`.
   */
  invalidMessage?: FieldErrorMessage
  isRequired?: boolean
  isDisabled?: boolean
  autoFocus?: boolean
  size?: FieldSize
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

export function MoneyField({
  locale,
  value,
  onChange,
  currencyCode,
  label,
  description,
  errorMessage,
  invalidMessage,
  isRequired = false,
  isDisabled = false,
  autoFocus = false,
  size,
  name,
  className,
}: MoneyFieldProps) {
  const [draft, setDraft] = useState<Draft>(() =>
    draftFor(locale, value, currencyCode),
  )
  const currencyId = useId()

  if (draft.fromValue !== value || draft.fromCurrency !== currencyCode) {
    setDraft(draftFor(locale, value, currencyCode))
  }

  const trimmed = draft.text.trim()
  const isUnparsable =
    trimmed !== '' && parseMoney(locale, trimmed, currencyCode) === null

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
    <>
      <TextField
        name={name}
        label={label}
        description={description}
        errorMessage={isUnparsable ? invalidMessage : errorMessage}
        isRequired={isRequired}
        isDisabled={isDisabled}
        isInvalid={isUnparsable || errorMessage !== undefined}
        autoFocus={autoFocus}
        size={size}
        value={draft.text}
        onChange={handleChange}
        // `decimal` rather than `numeric`: a phone keypad without a decimal separator makes a
        // fractional amount untypeable, which is most amounts.
        inputMode="decimal"
        autoComplete="off"
        suffix={currencySymbol(currencyCode)}
        aria-describedby={currencyId}
        className={cn('[&_input]:text-end [&_input]:tabular', className)}
      />
      <span id={currencyId} className="sr-only">
        {currencyName(currencyCode, locale)}
      </span>
    </>
  )
}
