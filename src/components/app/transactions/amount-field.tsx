import { useId } from 'react'

import { NumberField } from '#/components/ui'
import { useLocale } from '#/lib/i18n'
import {
  currencyName,
  minorFromBigInt,
  minorUnitDigits,
  scaleDecimalString,
} from '#/lib/money'

import type { ReactNode } from 'react'
import type { CurrencyCode, Minor } from '#/lib/money'

/**
 * The amount field — the most-used control in the product, and the one place a decimal is allowed
 * to exist on the way in.
 *
 * ## The conversion is exact in both directions, and neither direction multiplies
 *
 * React Aria's `NumberField` speaks decimal `number`, because that is what a person types. This
 * component is the boundary where that becomes an integer count of minor units, and it crosses the
 * boundary **through a string**:
 *
 * - **In:** the typed value is serialised to the decimal the person actually typed — `Intl` writes
 *   the shortest string that round-trips, so `1.015` stays `'1.015'` rather than becoming its
 *   binary residue `1.01499999999999990…` — and handed to `scaleDecimalString`, which moves the
 *   point in the string and rounds half to even. The float route, `Math.round(1.015 * 100)`, is
 *   `101`, because `1.015 * 100` is `101.49999999999999` in IEEE 754: the half that was typed
 *   rounds the wrong way and a penny is lost. Ties then break as they do everywhere else in the
 *   money layer, to even, so `0.125` is `12` rather than `Math.round`'s `13`.
 * - **Out:** the stored integer is divided by the currency's scale once, immediately before the
 *   formatter renders it, and the quotient is never read back. That is the same single float moment
 *   `src/lib/money/format.ts` documents, and it is exact for every amount a household reaches.
 *
 * `'en-US'` is hard-coded in the serialiser and is not a display locale: it is a canonical decimal
 * writer whose output (`.` for the point, no grouping) is exactly what `scaleDecimalString`'s
 * grammar accepts. What the *reader* sees is formatted by React Aria in their own locale, from
 * `formatOptions` below — `1 234,56` in Polish, `1,234.56` in English — and parsed back with the
 * matching rules, which is the whole reason not to use `<input type="number">`.
 *
 * ## The currency is written once, at the end of the box
 *
 * The code stands as a trailing adornment inside the field - typed, tabular, in the second ink -
 * so an empty box already says what it is asking for, and the figure is formatted as a plain
 * decimal rather than carrying a symbol of its own: `12,50 | PLN`, never `12,50 zł PLN`. The
 * adornment is decoration to assistive tech; what a screen reader hears is the currency's full
 * name, wired through `aria-describedby` beside the field's own description and error.
 *
 * ## Digits come from the currency, never from a constant
 *
 * A JPY amount has none and a KWD amount has three. `minorUnitDigits` is the only source, so
 * `5000` typed into a yen field is five thousand yen rather than fifty.
 */

/**
 * A double written out as a plain decimal, with no exponent and no separators.
 *
 * `String(1e21)` is `'1e+21'`, which `scaleDecimalString` correctly refuses; `Intl` never produces
 * exponent form. The 20 fraction digits are the maximum the API guarantees and are never all used:
 * `Intl` formats from the shortest representation that round-trips to the same double, which is the
 * decimal the person typed. The rounding to the currency's own scale then happens once, half to
 * even, in `scaleDecimalString`.
 */
const PLAIN_DECIMAL = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 20,
  useGrouping: false,
})

/** The integer minor units a typed decimal stands for, or `null` when there is no number. */
export function toMinor(
  value: number,
  currencyCode: CurrencyCode,
): Minor | null {
  if (!Number.isFinite(value)) {
    return null
  }
  const scaled = scaleDecimalString(
    PLAIN_DECIMAL.format(value),
    minorUnitDigits(currencyCode),
  )
  return scaled === null ? null : minorFromBigInt(scaled)
}

/**
 * The decimal a stored amount is shown as. `NaN` is React Aria's empty value, so an unset field
 * renders blank rather than as a zero somebody has to delete before typing.
 */
export function toInputValue(
  amountMinor: Minor | null,
  currencyCode: CurrencyCode,
): number {
  if (amountMinor === null) {
    return Number.NaN
  }
  return amountMinor / 10 ** minorUnitDigits(currencyCode)
}

export interface AmountFieldProps {
  readonly label: ReactNode
  readonly value: Minor | null
  readonly currencyCode: CurrencyCode
  readonly onChange: (value: Minor | null) => void
  readonly description?: ReactNode
  readonly errorMessage?: string
  readonly isRequired?: boolean
  readonly isDisabled?: boolean
  readonly autoFocus?: boolean
  readonly className?: string
}

export function AmountField({
  label,
  value,
  currencyCode,
  onChange,
  description,
  errorMessage,
  isRequired = false,
  isDisabled = false,
  autoFocus = false,
  className,
}: AmountFieldProps) {
  const digits = minorUnitDigits(currencyCode)
  const locale = useLocale()
  const currencyId = useId()

  return (
    <>
      <NumberField
        // Remounting on a currency change is deliberate: React Aria caches the parsed text against
        // the format it was typed under, and a field that switches from yen to dinar mid-edit would
        // otherwise keep showing the old scale.
        key={currencyCode}
        label={label}
        description={description}
        errorMessage={errorMessage}
        isRequired={isRequired}
        isDisabled={isDisabled}
        isInvalid={errorMessage !== undefined}
        autoFocus={autoFocus}
        hideStepper
        size="lg"
        className={className}
        value={toInputValue(value, currencyCode)}
        onChange={(next) => onChange(toMinor(next, currencyCode))}
        // The sign lives in `direction`; a negative amount is not representable here.
        minValue={0}
        formatOptions={{
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }}
        suffix={<span className="tabular">{currencyCode}</span>}
        aria-describedby={currencyId}
      />
      <span id={currencyId} className="sr-only">
        {currencyName(currencyCode, locale)}
      </span>
    </>
  )
}
