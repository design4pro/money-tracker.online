import { useState } from 'react'
import { today } from '@internationalized/date'
import { Info } from 'lucide-react'

import { Amount, DirectionalAmount } from '#/components/app/accounts'
import { ErrorPanel, FormModal } from '#/components/app/shell'
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
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { absMinor, formatMoney, makeMoney, subtractMinor } from '#/lib/money'
import { adjustAccountBalance } from '#/server/fns/accounts'

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
 * ## The preview is exact for today and honest about any other day
 *
 * The delta for today is `target − currentBalanceMinor`: two integers the screen already holds,
 * subtracted with `subtractMinor`. For an earlier date the delta is measured against the balance
 * **at the end of that day**, which only the repository can read — so the dialog says exactly
 * that instead of showing a number computed against the wrong day. Guessing there would be worse
 * than not previewing at all: it would name a figure, and the figure would be wrong precisely on
 * the accounts that have moved since.
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
  const [failure, setFailure] = useState<string | null>(null)
  const [result, setResult] = useState<BalanceAdjustment | null>(null)

  const currency = account.currencyCode
  const bookedOnIso = bookedOn.toString()
  const bookedOnText = formatCalendarDate(locale, bookedOn, 'long')
  const isToday = bookedOnIso === todayValue.toString()

  // Exact only for today, and deliberately absent for any other day — see the docblock.
  const deltaMinor =
    targetMinor !== null && isToday
      ? subtractMinor(targetMinor, account.currentBalanceMinor)
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
    if (targetMinor === null) {
      return
    }
    setIsSaving(true)
    setFailure(null)
    try {
      const written = await adjustAccountBalance({
        data: {
          accountId: account.id,
          targetMinor,
          bookedOn: bookedOnIso,
          ...(note.trim() === '' ? {} : { note: note.trim() }),
        },
      })
      setResult(written)
      onRecorded(written)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
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
                  <ErrorPanel
                    title={t('accounts.adjust.error.title')}
                    body={t('empty.error.body')}
                    detail={failure}
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
                      onChange={(value) => {
                        if (value !== null) {
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
                      {renderPreview()}
                      <p className="flex items-start gap-2 text-caption text-ink-2">
                        <Info
                          aria-hidden="true"
                          className="mt-px size-3.5 shrink-0"
                        />
                        <span>{t('accounts.balance.adjust.help')}</span>
                      </p>
                    </Card>
                  </>
                ) : (
                  <Card
                    variant="inset"
                    padding="sm"
                    className="flex flex-col gap-2"
                  >
                    <p className="text-micro tracking-label uppercase text-ink-2">
                      {t('accounts.adjust.result.title')}
                    </p>
                    {renderResult(result)}
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
    if (targetMinor === null) {
      return (
        <p className="text-body text-ink-2">
          {t('validation.amount.required')}
        </p>
      )
    }
    if (!isToday) {
      return (
        <p className="text-body text-ink-2">
          {t('accounts.adjust.preview.past', { date: bookedOnText })}
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
        <DirectionalAmount
          locale={locale}
          direction={direction}
          amountMinor={magnitude}
          currencyCode={currency}
          label={t(`transactions.direction.${direction}`)}
          size="lg"
        />
        <p className="text-body text-ink">
          {t(`accounts.adjust.preview.${direction}`, {
            amount: formatMoney(locale, makeMoney(magnitude, currency)),
            date: bookedOnText,
          })}
        </p>
      </>
    )
  }

  function renderResult(written: BalanceAdjustment) {
    if (written.status === 'unchanged') {
      return (
        <p className="text-body text-ink">
          {t('accounts.adjust.result.unchanged', {
            date: bookedOnText,
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
            date: bookedOnText,
          })}
        </p>
      </>
    )
  }
}
