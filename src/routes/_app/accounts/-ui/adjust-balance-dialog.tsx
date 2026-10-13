import { useEffect, useId, useRef, useState } from 'react'
import { today } from '@internationalized/date'
import { Info } from 'lucide-react'

import { Amount, DirectionalAmount } from '#/components/app/accounts'
import { FailurePanel, FormModal } from '#/components/app/shell'
import {
  Button,
  Card,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Form,
  MoneyField,
  TextAreaField,
} from '#/components/ui'
import { failureOf } from '#/lib/failure'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { absMinor, formatMoney, makeMoney, subtractMinor } from '#/lib/money'
import {
  adjustAccountBalance,
  getAccountBalanceOn,
} from '#/server/fns/accounts'

import type { FailureEnvelope } from '#/lib/failure-envelope'
import type { CalendarDate } from '@internationalized/date'
import type { Minor } from '#/lib/money'
import type { Account } from '#/server/db/types'
import type { BalanceAdjustment } from '#/server/repos/accounts'

/**
 * Correcting a balance — the flow this whole area exists to get right.
 *
 * ## A correction is a transaction, and the person is told so three times
 *
 * Before: the dialog names what it is about to write — "An expense of 120,00 zł, booked on
 * 20 August 2026". After: it stays open and states what it actually wrote, with the direction
 * spelled as a word, an arrow and a sign. Throughout: a line saying the correction is an
 * ordinary transaction that will appear in the list, the exports and the reports.
 *
 * None of that is decoration. A person states a **target** and the system writes a **delta**, and
 * a flow that hides the delta is how the same correction gets applied twice.
 *
 * ## The preview reads the same number the write measures, for every date
 *
 * The delta is `target − balance on the booking date`, where the balance comes from
 * `getAccountBalanceOn`: the ledger sum {@link adjustAccountBalance} measures, never the cached
 * `currentBalanceMinor`, which is today's number and can lag. Today is read like any other day,
 * so the preview and the write cannot disagree. The subtraction is `subtractMinor`, integers all
 * the way, in the account's own currency.
 *
 * A read is keyed by its date: an answer for a date the person has since left is discarded, so a
 * slow first answer can never overwrite the preview of the date now selected. Until the balance
 * for the selected date has loaded the dialog shows a loading sentence instead of a delta and
 * recording is blocked, with the reason in visible text. A failed read is retryable and blocks
 * recording too: a button that worked without a preview would reintroduce the hidden delta.
 *
 * A booking date later than today is refused here, in the interface only: the picker says so, no
 * read starts for it and recording stays blocked. The server still accepts a future date (#657),
 * so this guard is a courtesy to the person typing, never the thing that keeps one out of the
 * ledger.
 *
 * ## Zero writes nothing
 *
 * Correcting a balance to what it already is returns `unchanged` and no row is created, because
 * a zero-amount transaction pollutes every list, count and export forever to record that nothing
 * happened. The dialog reports that outcome as an outcome rather than as a failure.
 */
export interface AdjustBalanceDialogProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  account: Account
  /** Called once a correction has been written, so the route can refresh its data. */
  onRecorded: (result: BalanceAdjustment) => void
}

/** The correction the dialog wrote, with the booking date as it was when the save was made. */
interface Recorded {
  readonly adjustment: BalanceAdjustment
  readonly bookedOn: CalendarDate
}

/** What the read for one date has come to. No entry for the selected date means it is loading. */
type BalanceRead =
  | {
      readonly date: string
      readonly status: 'loaded'
      readonly balanceMinor: Minor
    }
  | {
      readonly date: string
      readonly status: 'failed'
      readonly attempt: number
    }

export function AdjustBalanceDialog({
  isOpen,
  onOpenChange,
  account,
  onRecorded,
}: AdjustBalanceDialogProps) {
  const t = useTranslate()
  const locale = useLocale()

  const todayValue = today('UTC')
  const [targetMinor, setTargetMinor] = useState<Minor | null>(
    account.currentBalanceMinor,
  )
  const [bookedOn, setBookedOn] = useState<CalendarDate>(todayValue)
  const [note, setNote] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<FailureEnvelope | null>(null)
  const [result, setResult] = useState<Recorded | null>(null)

  const [read, setRead] = useState<BalanceRead | null>(null)
  const [attempt, setAttempt] = useState(0)
  const blockedId = useId()
  const statusRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const refocusStatus = useRef(false)

  const currency = account.currencyCode
  const bookedOnIso = bookedOn.toString()
  const bookedOnText = formatCalendarDate(locale, bookedOn, 'long')
  const isToday = bookedOnIso === todayValue.toString()
  const isFuture = bookedOn.compare(todayValue) > 0

  // One read per date, and per retry. The cleanup is what discards an answer for a date the
  // person has left; the `read.date` comparison below is what stops the render in between from
  // showing the previous date's figure beside the new date.
  useEffect(() => {
    let isCurrent = true
    // Leaving a date drops its answer: going A -> B -> A before B settles must not show the first
    // A figure as if it were the new read. A retry keeps its date, so the failed read it is
    // retrying stays.
    setRead((previous) => (previous?.date === bookedOnIso ? previous : null))
    // A date the person cannot record against is not read: its loading sentence would compete
    // with the error the picker is already showing.
    if (isFuture) {
      return
    }
    getAccountBalanceOn({
      data: { accountId: account.id, on: bookedOnIso },
    }).then(
      ({ balanceMinor }) => {
        if (isCurrent) {
          setRead({ date: bookedOnIso, status: 'loaded', balanceMinor })
        }
      },
      () => {
        if (isCurrent) {
          setRead({ date: bookedOnIso, status: 'failed', attempt })
        }
      },
    )
    return () => {
      isCurrent = false
    }
  }, [account.id, bookedOnIso, isFuture, attempt])

  const balance = read?.date === bookedOnIso ? read : null
  const isRetrying = balance?.status === 'failed' && balance.attempt !== attempt
  const loadedBalanceMinor =
    balance?.status === 'loaded' ? balance.balanceMinor : null
  const canRecord = !isFuture && loadedBalanceMinor !== null
  const blockedKey = isFuture
    ? 'accounts.adjust.preview.blockedFuture'
    : balance?.status === 'failed' && !isRetrying
      ? 'accounts.adjust.preview.blockedFailed'
      : 'accounts.adjust.preview.blocked'

  // When a retry succeeds the button that was pressed unmounts, and the focus scope would hand
  // focus to whatever it likes. The status container is where the answer now is, so focus goes
  // there - unless the person tabbed somewhere else while waiting (the button's `onBlur` clears
  // the flag when focus moves to a real element; an unmount has no `relatedTarget`).
  useEffect(() => {
    if (balance?.status === 'loaded' && refocusStatus.current) {
      refocusStatus.current = false
      statusRef.current?.focus()
    } else if (balance?.status === 'failed') {
      refocusStatus.current = false
    }
  }, [balance])

  // Pressing Record unmounts the button that was pressed, and the browser hands focus to the
  // header's Close button - nowhere near the outcome, which is plain text with no live region
  // of its own. Focus goes to the result card, so the outcome is read out once and keyboard focus
  // starts from it (WCAG 2.4.3, 4.1.3).
  useEffect(() => {
    if (result !== null) {
      resultRef.current?.focus()
    }
  }, [result])

  const deltaMinor =
    targetMinor !== null && loadedBalanceMinor !== null
      ? subtractMinor(targetMinor, loadedBalanceMinor)
      : null

  // The `result === null` guard is what stops a *completed* money write being offered for
  // discard: once the adjustment is written the footer swaps to a single Done, and pressing it
  // must not ask about work that is already in the ledger.
  //
  // The comparison is against the opening balance rather than against `null`, because
  // `targetMinor` is seeded with `account.currentBalanceMinor` above. `targetMinor !== null`
  // would be true from the first render, so a pristine open would raise the alert on the scrim,
  // Escape, the X and Cancel alike.
  //
  // `!isToday` is the third field. The spec's expression named only the amount and the note; a
  // reader who moved the booking date and nothing else would have been read as pristine, and
  // under-reporting is the direction this guard is not allowed to fail in.
  const isDirty =
    result === null &&
    (targetMinor !== account.currentBalanceMinor || note !== '' || !isToday)

  async function submit() {
    // Enter in the amount field submits the form even while the button is disabled, so the
    // handler refuses by itself: no balance for this date yet means no delta to write against,
    // and a future date is not one to record.
    if (targetMinor === null || !canRecord) {
      return
    }
    // The picker stays editable while the save is in flight; the card states what was written.
    const writtenOn = bookedOn
    setIsSaving(true)
    setFailure(null)
    try {
      const written = await adjustAccountBalance({
        data: {
          accountId: account.id,
          targetMinor,
          bookedOn: writtenOn.toString(),
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        },
      })
      setResult({ adjustment: written, bookedOn: writtenOn })
      onRecorded(written)
    } catch (error) {
      setFailure(failureOf(error))
    } finally {
      setIsSaving(false)
    }
  }

  function retry() {
    refocusStatus.current = true
    setAttempt((value) => value + 1)
  }

  return (
    <FormModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="md"
      isDirty={isDirty}
    >
      <Dialog>
        {({ close }) => (
          <>
            <DialogHeader
              title={t('accounts.balance.adjust')}
              description={t('accounts.adjust.body')}
              closeLabel={t('action.close')}
              onClose={close}
            />

            <Form
              onSubmit={(event) => {
                event.preventDefault()
                if (result === null && !isSaving) {
                  void submit()
                }
              }}
              className="contents"
            >
              <DialogBody className="flex flex-col gap-5">
                {failure === null ? null : (
                  <FailurePanel
                    failure={failure}
                    placement="after-action"
                    title={t('accounts.adjust.error.title')}
                  />
                )}

                <div className="flex items-baseline justify-between gap-4 rounded-lg bg-surface-sunken px-4 py-3">
                  <span className="text-micro tracking-label uppercase text-ink-2">
                    {t('accounts.detail.balanceToday')}
                  </span>
                  <Amount
                    locale={locale}
                    amountMinor={account.currentBalanceMinor}
                    currencyCode={currency}
                    tone="value"
                  />
                </div>

                {result === null ? (
                  <>
                    <MoneyField
                      locale={locale}
                      name="targetMinor"
                      label={t('accounts.adjust.field.target')}
                      currencyCode={currency}
                      value={targetMinor}
                      onChange={setTargetMinor}
                      invalidMessage={t('validation.amount.invalid')}
                      isRequired
                    />

                    {/* The future is closed off: a balance cannot be corrected to what it
                        will be, and the repository would have to invent a rate for a day that
                        has not happened. */}
                    <DatePicker
                      label={t('accounts.adjust.field.date')}
                      calendarLabel={t('common.date')}
                      value={bookedOn}
                      maxValue={todayValue}
                      errorMessage={
                        isFuture ? t('validation.date.future') : undefined
                      }
                      onChange={(value) => {
                        if (value !== null) {
                          refocusStatus.current = false
                          setBookedOn(value)
                        }
                      }}
                    />

                    <TextAreaField
                      name="note"
                      label={t('accounts.adjust.field.note')}
                      description={t('accounts.adjust.field.note.help')}
                      value={note}
                      onChange={setNote}
                      maxLength={500}
                      rows={2}
                    />

                    <Card
                      variant="inset"
                      padding="sm"
                      className="flex flex-col gap-2"
                    >
                      <p className="text-micro tracking-label uppercase text-ink-2">
                        {t('accounts.adjust.preview.title')}
                      </p>
                      {/* Always mounted, and its content swaps in one render per date change, so
                          the announcement is one sentence rather than a stutter of fragments.
                          `tabIndex={-1}` lets focus land here when a retry removes its button. */}
                      <div
                        ref={statusRef}
                        role="status"
                        tabIndex={-1}
                        className="focus-ring flex flex-col gap-2 rounded-md"
                      >
                        {renderPreview()}
                      </div>
                      {balance?.status === 'failed' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="self-start"
                          isPending={isRetrying}
                          onPress={retry}
                          onBlur={(event) => {
                            if (event.relatedTarget !== null) {
                              refocusStatus.current = false
                            }
                          }}
                        >
                          {t('action.retry')}
                        </Button>
                      ) : null}
                      <p className="flex items-start gap-2 text-caption text-ink-2">
                        <Info
                          aria-hidden="true"
                          className="mt-px size-3.5 shrink-0"
                        />
                        <span>{t('accounts.balance.adjust.help')}</span>
                      </p>
                    </Card>
                    {canRecord ? null : (
                      // A disabled button leaves the tab order, so its reason is plain text in
                      // reading order, just before the footer, and the button points at it.
                      <p id={blockedId} className="text-caption text-ink-2">
                        {t(blockedKey, {
                          date: bookedOnText,
                          retry: t('action.retry'),
                        })}
                      </p>
                    )}
                  </>
                ) : (
                  <Card variant="inset" padding="sm">
                    <div
                      ref={resultRef}
                      role="status"
                      tabIndex={-1}
                      className="focus-ring flex flex-col gap-2 rounded-md"
                    >
                      <p className="text-micro tracking-label uppercase text-ink-2">
                        {t('accounts.adjust.result.title')}
                      </p>
                      {renderResult(result)}
                    </div>
                  </Card>
                )}
              </DialogBody>

              <DialogFooter>
                {result === null ? (
                  <>
                    <Button variant="ghost" onPress={close}>
                      {t('action.cancel')}
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      isPending={isSaving}
                      isDisabled={!canRecord}
                      aria-describedby={canRecord ? undefined : blockedId}
                    >
                      {t('accounts.adjust.action')}
                    </Button>
                  </>
                ) : (
                  <Button variant="primary" onPress={close}>
                    {t('action.done')}
                  </Button>
                )}
              </DialogFooter>
            </Form>
          </>
        )}
      </Dialog>
    </FormModal>
  )

  function renderPreview() {
    // A retry in flight reads as loading, so a second failure swaps the sentence back and the
    // status region announces it.
    if (isFuture) {
      return null
    }
    if (balance === null || isRetrying) {
      return (
        <p className="text-body text-ink-2">
          {t('accounts.adjust.preview.loading', { date: bookedOnText })}
        </p>
      )
    }
    if (balance.status === 'failed') {
      return (
        <p className="text-body text-ink">
          {t('accounts.adjust.preview.error', { date: bookedOnText })}
        </p>
      )
    }
    if (targetMinor === null) {
      return (
        <p className="text-body text-ink-2">
          {t('validation.amount.required')}
        </p>
      )
    }
    if (deltaMinor === null || deltaMinor === 0) {
      return (
        <p className="text-body text-ink-2">
          {t('accounts.adjust.preview.none', {
            date: bookedOnText,
            amount: formatMoney(locale, makeMoney(targetMinor, currency)),
          })}
        </p>
      )
    }
    const direction = deltaMinor > 0 ? 'income' : 'expense'
    const magnitude = absMinor(deltaMinor)
    return (
      <>
        {/* The sentence below says the same in words; inside the live region the figure would be
            read out a second and third time. */}
        <div aria-hidden="true">
          <DirectionalAmount
            locale={locale}
            direction={direction}
            amountMinor={magnitude}
            currencyCode={currency}
            label={t(`transactions.direction.${direction}`)}
            size="lg"
          />
        </div>
        <p className="text-body text-ink">
          {t(`accounts.adjust.preview.${direction}`, {
            amount: formatMoney(locale, makeMoney(magnitude, currency)),
            date: bookedOnText,
          })}
        </p>
      </>
    )
  }

  function renderResult({
    adjustment: written,
    bookedOn: writtenOn,
  }: Recorded) {
    const writtenOnText = formatCalendarDate(locale, writtenOn, 'long')
    if (written.status === 'unchanged') {
      return (
        <p className="text-body text-ink">
          {t('accounts.adjust.result.unchanged', {
            date: writtenOnText,
            amount: formatMoney(
              locale,
              makeMoney(written.balanceMinor, currency),
            ),
          })}
        </p>
      )
    }
    return (
      <>
        <DirectionalAmount
          locale={locale}
          direction={written.direction}
          amountMinor={written.amountMinor}
          currencyCode={currency}
          label={t(`transactions.direction.${written.direction}`)}
          size="lg"
        />
        <p className="text-body text-ink">
          {t(`accounts.adjust.result.${written.direction}`, {
            amount: formatMoney(
              locale,
              makeMoney(written.amountMinor, currency),
            ),
            date: writtenOnText,
          })}
        </p>
      </>
    )
  }
}
