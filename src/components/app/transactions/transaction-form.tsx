import { useEffect, useMemo, useRef, useState } from 'react'
import { getLocalTimeZone, parseDate, today } from '@internationalized/date'
import { TriangleAlert } from 'lucide-react'

import {
  Button,
  Checkbox,
  ComboBox,
  ComboBoxItem,
  DatePicker,
  Form,
  FormActions,
  FormSection,
  MoneyField,
  Radio,
  RadioGroup,
  Select,
  SelectItem,
  TextAreaField,
} from '#/components/ui'
import { cn } from '#/lib/cn'
import { useLocale, useTranslate } from '#/lib/i18n'
import { currencyName } from '#/lib/money'

import { PAYMENT_METHOD_KEY } from './filter-chips'
import { LEDGER_PAYMENT_METHODS } from './types'

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type { DateValue } from 'react-aria-components'
import type { Translate } from '#/lib/i18n'
import type { CurrencyCode, Minor } from '#/lib/money'
import type {
  LedgerDirection,
  LedgerPaymentMethod,
  TransactionReference,
} from './types'

/**
 * The entry form — the single most-repeated action in the product, so the design brief is
 * keystrokes rather than completeness.
 *
 * ## Amount first, and focused
 *
 * Every entry starts with a number, so the amount is the first control in the DOM and takes focus
 * on mount when {@link TransactionFormProps.autoFocusAmount} is set. It is the product's one
 * {@link MoneyField}, which means the decimal separator is the reader's own (`12,50` in Polish,
 * `12.50` in English) and `inputmode="decimal"` brings up the numeric keypad on a phone. The value
 * it emits is `Minor` — branded integer minor units — so {@link TransactionFormProps.onSubmit}
 * cannot be handed a float even by accident.
 *
 * ## The currency is the account's, and is never a separate question
 *
 * A transaction is recorded in the currency of the account it belongs to. Asking for both is asking
 * the reader to keep two fields consistent, and the answer they give when the two disagree is wrong
 * in a way nothing downstream can detect. Changing the account changes the amount field's scale —
 * five thousand yen stays five thousand yen and does not become fifty.
 *
 * ## Repeat entry
 *
 * `Save and add another` keeps the date, account, category and payment method and clears the amount,
 * the payee and the note, then returns focus to the amount. Somebody entering a shoebox of receipts
 * types a number, presses Enter, types a number — which is the whole job. `Ctrl`/`⌘ + Enter` does
 * the same from anywhere in the form.
 *
 * ## Errors
 *
 * Validation is a pure function ({@link validateForm}) rather than a hook, so the rules are testable
 * without a render. Nothing is shown until the field has been left or the form submitted — a form
 * that reports "enter an amount" on the first keystroke is a form that is wrong more often than the
 * person filling it in. Entered values survive a server error; the panel is `role="alert"` and the
 * fields keep what they held.
 */

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

/** What the form holds. Money is `Minor`; there is no string or float anywhere in this shape. */
export interface TransactionFormValues {
  readonly direction: LedgerDirection
  readonly amountMinor: Minor | null
  readonly accountId: string
  /** `YYYY-MM-DD`, the calendar date the person chose. */
  readonly bookedOn: string
  readonly categoryId: string | null
  readonly payeeId: string | null
  readonly paymentMethod: LedgerPaymentMethod | null
  readonly note: string
  readonly isPlanned: boolean
}

/** Per-field messages, keyed by the field they belong under. Absent means valid. */
export type TransactionFormErrors = Partial<
  Record<'amountMinor' | 'accountId' | 'bookedOn' | 'note', string>
>

const NOTE_MAX = 500

/**
 * What the form measures a settled entry's date against.
 *
 * The server refuses a non-planned row dated after the latest calendar day on Earth
 * (`#/server/booking-rule`). The form never offers that day: every device-local day is at most
 * that one, so `today` is a cap the server always accepts, the form's own default stays valid east
 * of UTC, and `components` need no import from `server/`.
 */
export interface BookingWindow {
  /** `YYYY-MM-DD`: today on the reader's device, the last day a settled entry may carry. */
  readonly today: string
  /**
   * The date a settled row already holds when it was saved before the rule existed. The server
   * judges an update on the `(date, planned)` pair it changes, so leaving this date as it is
   * stays valid and anything else follows the cap.
   */
  readonly storedSettledOn?: string
}

/** Whether the entry is settled and dated past what {@link BookingWindow} allows. */
export function isBeyondBookingWindow(
  values: Pick<TransactionFormValues, 'bookedOn' | 'isPlanned'>,
  window: BookingWindow,
): boolean {
  return (
    !values.isPlanned &&
    values.bookedOn > window.today &&
    values.bookedOn !== window.storedSettledOn
  )
}

/** A blank entry for today, on the account the reader is most likely to mean. */
export function emptyFormValues(
  accountId: string,
  bookedOn: string,
): TransactionFormValues {
  return {
    direction: 'expense',
    amountMinor: null,
    accountId,
    bookedOn,
    categoryId: null,
    payeeId: null,
    paymentMethod: null,
    note: '',
    isPlanned: false,
  }
}

/**
 * Everything that would make the server refuse, checked here so it is said beside the field.
 *
 * The amount rule is the same one the schema states: a **positive integer**, because the sign lives
 * in `direction`. Zero is a rejection rather than a silently-dropped row.
 */
export function validateForm(
  values: TransactionFormValues,
  t: Translate,
  window: BookingWindow,
): TransactionFormErrors {
  const errors: TransactionFormErrors = {}

  if (values.amountMinor === null || values.amountMinor <= 0) {
    errors.amountMinor = t('transactions.form.error.amount')
  }
  if (values.accountId.trim() === '') {
    errors.accountId = t('transactions.form.error.account')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.bookedOn)) {
    errors.bookedOn = t('transactions.form.error.date', {
      example: '2026-03-15',
    })
  } else if (isBeyondBookingWindow(values, window)) {
    // Names the way out: this form has one (the planned checkbox), so the message says so.
    errors.bookedOn = t('transactions.form.error.dateFuture', {
      planned: t('transactions.planned'),
    })
  }
  if (values.note.length > NOTE_MAX) {
    errors.note = t('transactions.form.error.note', { max: NOTE_MAX })
  }

  return errors
}

/* -------------------------------------------------------------------------- */
/* The form                                                                    */
/* -------------------------------------------------------------------------- */

export interface TransactionFormProps {
  readonly values: TransactionFormValues
  readonly onChange: (values: TransactionFormValues) => void
  readonly reference: TransactionReference
  /** Save. `addAnother` asks the caller to keep the form open and reset it for the next entry. */
  readonly onSubmit: (options: { readonly addAnother: boolean }) => void
  readonly onCancel: () => void
  readonly isSubmitting: boolean
  /** A failure from the server, kept beside the values that produced it. */
  readonly serverError?: string
  /** Offer `Save and add another`. Off when editing — there is nothing to add another of. */
  readonly allowRepeat?: boolean
  readonly submitLabel: string
  readonly autoFocusAmount?: boolean
  /** Bumped by the caller after a repeat save, to pull focus back to the amount. */
  readonly resetToken?: number
  /**
   * Rendered directly under the amount - the template row on the entry route. A slot rather than
   * a prop of its own, because the form neither fetches templates nor knows what one is.
   */
  readonly afterAmount?: ReactNode
  /**
   * A sentence for the amount field's description, beside the conversion note when both apply. A
   * string rather than a reason: the form does not know where a starting amount came from, and
   * says whatever the caller words.
   */
  readonly amountNote?: string
  /**
   * The date a settled row being edited already holds, when it was saved before settled rows were
   * capped at today. Set by the detail route; the entry route has nothing stored. See
   * {@link BookingWindow.storedSettledOn}.
   */
  readonly storedSettledOn?: string
}

export function TransactionForm({
  values,
  onChange,
  reference,
  onSubmit,
  onCancel,
  isSubmitting,
  serverError,
  allowRepeat = false,
  submitLabel,
  autoFocusAmount = false,
  resetToken = 0,
  afterAmount,
  amountNote,
  storedSettledOn,
}: TransactionFormProps) {
  const t = useTranslate()
  const locale = useLocale()
  const [touched, setTouched] = useState(false)
  const amountRef = useRef<HTMLDivElement>(null)
  const dateRef = useRef<HTMLDivElement>(null)

  const localToday = today(getLocalTimeZone())
  const todayIso = localToday.toString()
  const bookingWindow = useMemo<BookingWindow>(
    () => ({ today: todayIso, storedSettledOn }),
    [todayIso, storedSettledOn],
  )
  const errors = useMemo(
    () => validateForm(values, t, bookingWindow),
    [t, values, bookingWindow],
  )
  const dateBeyondWindow = isBeyondBookingWindow(values, bookingWindow)
  // The date error is the one that does not wait for the field to be left or the form submitted:
  // it answers something the person just did (unticking "planned" under a future date), and a
  // refusal that appears only on Save would be a refusal with no visible cause.
  const shown: TransactionFormErrors = touched
    ? errors
    : dateBeyondWindow
      ? { bookedOn: errors.bookedOn }
      : {}

  // After a repeat save the amount is the only thing left to type, so the caret goes back to it.
  // Focusing the wrapper's input rather than remounting the field keeps the account and the date
  // exactly as they were, which is the point of the whole interaction.
  useEffect(() => {
    if (resetToken === 0) {
      return
    }
    // The next entry is a fresh form, so it starts untouched. Without this the cleared amount is
    // still measured against the rules the *previous* entry satisfied, and a blank box that
    // nobody has typed into yet opens reading "enter an amount greater than zero".
    setTouched(false)
    amountRef.current?.querySelector('input')?.focus()
  }, [resetToken])

  const account = reference.accounts.find(
    (entry) => entry.id === values.accountId,
  )
  const currencyCode: CurrencyCode =
    account?.currencyCode ?? reference.baseCurrencyCode
  const showsConversion = currencyCode !== reference.baseCurrencyCode
  // One description slot, one element per sentence: the field reads them together on focus.
  const amountNotes = [
    amountNote,
    showsConversion
      ? t('transactions.form.conversionNote', {
          currency: currencyName(currencyCode, locale),
          base: currencyName(reference.baseCurrencyCode, locale),
        })
      : undefined,
  ].filter((note): note is string => note !== undefined)

  const patch = (next: Partial<TransactionFormValues>) =>
    onChange({ ...values, ...next })

  const submit = (addAnother: boolean) => {
    setTouched(true)
    if (Object.keys(errors).length > 0) {
      // The amount comes first in the DOM, so the date only takes focus when it is the first
      // thing the refusal is about; otherwise the amount error is the one to fix first (WCAG 2.4.3).
      if (errors.amountMinor === undefined && errors.bookedOn !== undefined) {
        dateRef.current
          ?.querySelector<HTMLElement>('[role="spinbutton"]')
          ?.focus()
      }
      return
    }
    onSubmit({ addAnother })
  }

  /*
    `Ctrl`/`⌘ + Enter` cannot submit in the same tick it is pressed.

    React Aria's number field holds what is being typed as *text* and only parses it into a value
    when the field is left — or on a bare Enter, which is how the ordinary submit path always
    receives a committed amount. The accelerator `preventDefault()`s that Enter, so a number typed
    and never left was still uncommitted when the old code validated: the form refused with "enter
    an amount greater than zero" beside a box that visibly contained one, and the receipt was lost.

    So the accelerator blurs the focused field to force the parse, restores the caret, and records
    that a submit is owed. The blur's `onChange` and this flag land in one React batch, so the
    effect below runs on the first render that has the committed value.
  */
  const [pendingSubmit, setPendingSubmit] = useState<{
    readonly addAnother: boolean
  } | null>(null)

  useEffect(() => {
    if (pendingSubmit === null) {
      return
    }
    setPendingSubmit(null)
    // `submit` closes over this render's `values`, which is the committed one by now, so the
    // flag is the only dependency this effect may take: re-running it on `values` would resubmit.
    submit(pendingSubmit.addAnother)
  }, [pendingSubmit])

  return (
    <div
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
        // The repeat-entry accelerator. Bound on the wrapper rather than on the button so it fires
        // from the note box too, where a bare Enter has to keep inserting a newline. React Aria's
        // `Form` does not forward key handlers, hence the wrapper rather than a prop.
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          const active = document.activeElement
          if (active instanceof HTMLElement) {
            // Blur parses whatever the field is holding; focus puts the caret straight back, so
            // the round trip is invisible to the person typing.
            active.blur()
            active.focus()
          }
          setPendingSubmit({ addAnother: allowRepeat })
        }
      }}
    >
      <Form
        onSubmit={(event) => {
          event.preventDefault()
          submit(false)
        }}
        className={cn(
          'flex flex-col gap-6',
          // Below `lg` the actions are a sticky footer over the bottom bar, and `<html>` only
          // budgets scroll padding for the bar. The extra clearance lives on the controls
          // themselves, since focus scrolls the focused element and nothing else.
          'max-lg:[&_:is(input,textarea,button,[tabindex])]:scroll-mb-28',
        )}
      >
        {serverError === undefined ? null : (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-negative/40 bg-negative-soft px-4 py-3"
          >
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-negative"
            />
            <div className="min-w-0">
              <p className="text-label font-semibold text-ink">
                {t('transactions.form.error.title')}
              </p>
              <p className="mt-0.5 text-body text-ink-2">{serverError}</p>
            </div>
          </div>
        )}

        {/* ---- The three things every entry needs -------------------------- */}
        <div className="flex flex-col gap-4">
          <RadioGroup
            label={t('transactions.filter.direction')}
            orientation="horizontal"
            value={values.direction}
            onChange={(value) => patch({ direction: value as LedgerDirection })}
          >
            <Radio value="expense">{t('transactions.direction.expense')}</Radio>
            <Radio value="income">{t('transactions.direction.income')}</Radio>
          </RadioGroup>

          <div ref={amountRef}>
            {/*
              Not disabled while the save is in flight, unlike every other field here.

              The amount is the one control that is *always* focused when a save starts — it takes
              focus on arrival and the accelerator puts the caret straight back into it — and
              disabling a focused input makes the browser fire `blur` from inside React's commit
              phase. React Aria's number field commits its typed text from that handler with
              `flushSync`, which React refuses mid-commit: "flushSync was called from inside a
              lifecycle method". The reader also loses focus to `<body>` for the length of the round
              trip, which is the half of it that costs them a keystroke.

              Nothing is lost by leaving it live. The payload was snapshotted at `mutate` time, so a
              character typed during the round trip cannot reach the row being written, and the
              buttons carry `isPending` — which is how every other form in this codebase says
              "saving" without taking a field away from whoever is typing in it.
            */}
            <MoneyField
              locale={locale}
              label={t('transactions.field.amount')}
              value={values.amountMinor}
              currencyCode={currencyCode}
              onChange={(amountMinor) => patch({ amountMinor })}
              errorMessage={shown.amountMinor}
              invalidMessage={t('validation.amount.invalid')}
              size="lg"
              isRequired
              autoFocus={autoFocusAmount}
              description={
                amountNotes.length === 0
                  ? undefined
                  : amountNotes.map((note) => (
                      <span key={note} className="block">
                        {note}
                      </span>
                    ))
              }
            />
          </div>

          {afterAmount}

          <div className="grid gap-4 sm:grid-cols-2">
            <div ref={dateRef}>
              {/*
                A settled entry stops at today, a planned one may run ten years ahead. The cap
                is the larger of today and a legacy row's stored date, so that date can be shown
                rather than clamped. `isInvalid` makes the field render our message instead of
                React Aria's range default.
              */}
              <DatePicker
                label={t('transactions.field.date')}
                calendarLabel={t('transactions.filter.openCalendar')}
                isRequired
                isDisabled={isSubmitting}
                isInvalid={dateBeyondWindow ? true : undefined}
                errorMessage={shown.bookedOn}
                value={safeParseDate(values.bookedOn)}
                maxValue={
                  values.isPlanned
                    ? localToday.add({ years: 10 })
                    : (safeParseDate(
                        storedSettledOn !== undefined &&
                          storedSettledOn > todayIso
                          ? storedSettledOn
                          : todayIso,
                      ) ?? localToday)
                }
                onChange={(value: DateValue | null) => {
                  if (value !== null) {
                    patch({ bookedOn: value.toString() })
                  }
                }}
              />
              {/*
                The error mounts in the date field while focus is on the "planned" checkbox, so
                the field's own description is never read. This region is announced instead
                (WCAG 4.1.3); it stays mounted so a later change is announced. A message already
                present at mount (a prefilled future date) is not, and is read through the
                field's description on focus.
              */}
              <p role="status" className="sr-only">
                {dateBeyondWindow ? shown.bookedOn : ''}
              </p>
            </div>

            <Select
              label={t('transactions.field.account')}
              isRequired
              isDisabled={isSubmitting}
              errorMessage={shown.accountId}
              selectedKey={values.accountId === '' ? null : values.accountId}
              onSelectionChange={(key) => patch({ accountId: String(key) })}
            >
              {reference.accounts.map((option) => (
                <SelectItem
                  key={option.id}
                  id={option.id}
                  textValue={`${option.name} · ${option.currencyCode}`}
                >
                  {option.name} · {option.currencyCode}
                </SelectItem>
              ))}
            </Select>
          </div>
        </div>

        {/* ---- Everything else --------------------------------------------- */}
        <FormSection legend={t('transactions.form.details')}>
          <div className="grid gap-4 sm:grid-cols-2">
            {reference.categories.length === 0 ? null : (
              <ComboBox
                label={t('transactions.field.category')}
                toggleLabel={t('a11y.showSuggestions')}
                placeholder={t('transactions.form.categoryPlaceholder')}
                emptyState={t('transactions.filter.noMatches')}
                isDisabled={isSubmitting}
                items={reference.categories}
                selectedKey={values.categoryId}
                onSelectionChange={(key) =>
                  patch({ categoryId: key === null ? null : String(key) })
                }
              >
                {(option: { id: string; name: string }) => (
                  <ComboBoxItem id={option.id} textValue={option.name}>
                    {option.name}
                  </ComboBoxItem>
                )}
              </ComboBox>
            )}

            {reference.payees.length === 0 ? null : (
              <ComboBox
                label={t('transactions.field.payee')}
                toggleLabel={t('a11y.showSuggestions')}
                placeholder={t('transactions.form.payeePlaceholder')}
                emptyState={t('transactions.filter.noMatches')}
                isDisabled={isSubmitting}
                items={reference.payees}
                selectedKey={values.payeeId}
                onSelectionChange={(key) =>
                  patch({ payeeId: key === null ? null : String(key) })
                }
              >
                {(option: { id: string; name: string }) => (
                  <ComboBoxItem id={option.id} textValue={option.name}>
                    {option.name}
                  </ComboBoxItem>
                )}
              </ComboBox>
            )}

            <Select
              label={t('transactions.field.paymentMethod')}
              isDisabled={isSubmitting}
              selectedKey={values.paymentMethod ?? 'none'}
              onSelectionChange={(key) =>
                patch({
                  paymentMethod:
                    key === 'none' ? null : (key as LedgerPaymentMethod),
                })
              }
            >
              <SelectItem id="none" textValue={t('common.none')}>
                {t('common.none')}
              </SelectItem>
              {LEDGER_PAYMENT_METHODS.map((method) => (
                <SelectItem
                  key={method}
                  id={method}
                  textValue={t(PAYMENT_METHOD_KEY[method])}
                >
                  {t(PAYMENT_METHOD_KEY[method])}
                </SelectItem>
              ))}
            </Select>
          </div>

          <TextAreaField
            label={t('transactions.field.note')}
            placeholder={t('transactions.form.notePlaceholder')}
            rows={3}
            isDisabled={isSubmitting}
            errorMessage={shown.note}
            value={values.note}
            onChange={(note) => patch({ note })}
          />

          {/*
          A checkbox rather than a switch: this is a value the form will submit, not a setting that
          takes effect the moment it is flipped. The distinction is audible — a screen reader says
          "switch, on" for one and "checkbox, checked" for the other — so getting it wrong tells
          somebody the transaction has already been marked planned when it has not.
        */}
          <Checkbox
            isSelected={values.isPlanned}
            isDisabled={isSubmitting}
            onChange={(isPlanned) => patch({ isPlanned })}
            description={t('transactions.planned.help')}
          >
            {t('transactions.planned')}
          </Checkbox>
        </FormSection>

        {/*
          The hint stays out of the pinned footer: two lines of caption pinned to every scroll
          position would cost the phone a third of its form. It sits in flow above the actions
          below `lg` and drops back under the row from `lg`, where the row is in flow too.
        */}
        {allowRepeat ? (
          <p className="text-caption text-ink-2 lg:order-last lg:-mt-3 lg:text-end">
            {t('transactions.form.saveAndNewHint')}
          </p>
        ) : null}

        {/*
          On a phone the actions are a footer pinned above the bottom bar, so Save is under the
          thumb however long the form has grown, and it is the one full-width button: the two
          quieter actions share the row beneath it, so a thumb aimed at Save cannot land on
          "add another". The offset is the bar's own height - 64px of tabs, its one-pixel top rule
          and the safe-area inset it pads for - and the footer is sticky rather than fixed, so at
          the end of the form it settles into flow and never covers the last field. From `lg` the
          bar is gone and the row sits in flow as it always has.
        */}
        <div
          className={cn(
            'sticky bottom-[calc(4rem+1px+var(--safe-bottom))] border-t border-border-subtle bg-canvas py-3',
            'max-sm:-mx-4 max-sm:px-4',
            'lg:static lg:border-0 lg:bg-transparent lg:py-0',
          )}
        >
          <FormActions className="pt-0 lg:pt-2">
            <Button
              variant="ghost"
              isDisabled={isSubmitting}
              onPress={onCancel}
              className="max-lg:flex-1"
            >
              {t('action.cancel')}
            </Button>
            {allowRepeat ? (
              <Button
                variant="secondary"
                isPending={isSubmitting}
                onPress={() => submit(true)}
                className="max-lg:flex-[3]"
              >
                {t('transactions.form.saveAndNew')}
              </Button>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              isPending={isSubmitting}
              className="max-lg:order-first max-lg:w-full"
            >
              {submitLabel}
            </Button>
          </FormActions>
        </div>
      </Form>
    </div>
  )
}

/**
 * The stored date as a calendar value, or `null` when it is not one.
 *
 * `parseDate` throws on anything that is not `YYYY-MM-DD`, and the one place that can happen is a
 * value carried in from a URL. An empty date field plus the visible validation message is a better
 * answer than a blank screen.
 */
function safeParseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }
  try {
    return parseDate(value)
  } catch {
    return null
  }
}
