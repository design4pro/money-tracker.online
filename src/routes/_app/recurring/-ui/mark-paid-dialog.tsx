import { useEffect, useState } from 'react'
import { parseDate } from '@internationalized/date'

import { ErrorPanel } from '#/components/app/accounts'
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
  Radio,
  RadioGroup,
  Spinner,
} from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'
import { markPeriodPaid } from '#/server/fns/recurring'
import { loadTransactions } from '#/server/fns/transactions'

import type { PeriodView } from '#/server/repos/recurring'
import type { Transaction } from '#/server/db/types'

/**
 * Linking a period to the transaction that settled it.
 *
 * ## It never creates a transaction, and it says so
 *
 * This is the one sentence on the dialog that matters. A *"mark paid"* that minted money would put
 * a balance rebuild behind a button whose label says nothing about money moving, and would let a
 * mis-click add a payment nobody made. So the dialog offers rows that already exist, and when none
 * of them fits it says *record the payment first* rather than offering to do it here.
 *
 * ## The candidate window is the due date plus or minus a fortnight
 *
 * Wide enough that a bill paid early or chased late is in the list, narrow enough that the list is
 * readable. It is a **read**, so a person can always widen it by recording the payment and coming
 * back; there is no filter control here, because a picker with its own query builder is a second
 * transactions screen inside a dialog.
 *
 * ## A radio group, not a list box
 *
 * Picking exactly one thing from a short list, with the choice visible without opening anything,
 * is what a radio group is. Each option's label carries the date, the amount and the payee, so the
 * announcement a screen reader makes is enough to choose on without moving focus anywhere else.
 */

export interface MarkPaidDialogProps {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  readonly seriesId: string
  readonly period: PeriodView
  readonly onSaved: () => void
}

/** How far either side of the due date the picker looks. See the docblock. */
const WINDOW_DAYS = 14

export function MarkPaidDialog({
  isOpen,
  onOpenChange,
  seriesId,
  period,
  onSaved,
}: MarkPaidDialogProps) {
  const t = useTranslate()
  const locale = useLocale()

  const [rows, setRows] = useState<ReadonlyArray<Transaction> | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const due = parseDate(period.dueOn)
    void loadTransactions({
      data: {
        // Settled, real money only: a planned row has not happened and an adjustment is not a
        // payment. The same four decisions every read of `transactions` has to state out loud.
        policies: {
          planned: 'exclude',
          adjustments: 'exclude',
          transfers: 'exclude',
          completeness: 'any',
        },
        filters: {
          from: due.subtract({ days: WINDOW_DAYS }).toString(),
          to: due.add({ days: WINDOW_DAYS }).toString(),
        },
        sort: { field: 'bookedOn', direction: 'desc' },
        cursor: null,
        limit: 50,
      },
    })
      .then((page) => {
        if (!cancelled) setRows(page.rows)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFailure(error instanceof Error ? error.message : String(error))
          setRows([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [period.dueOn])

  async function submit() {
    if (selected === null) return
    setIsSaving(true)
    setFailure(null)
    try {
      await markPeriodPaid({
        data: {
          seriesId,
          periodStart: period.periodStart,
          transactionId: selected,
          matchSource: 'manual',
        },
      })
      onSaved()
      onOpenChange(false)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
      <Dialog>
        {({ close }) => (
          <>
            <DialogHeader
              title={t('recurring.markPaid.title')}
              description={t('recurring.markPaid.body')}
              closeLabel={t('action.close')}
              onClose={close}
            />

            <DialogBody className="flex flex-col gap-4">
              {failure === null ? null : (
                <ErrorPanel
                  title={t('recurring.toast.failed')}
                  body={t('recurring.error.body')}
                  detail={failure}
                />
              )}

              {rows === null ? (
                <p className="flex items-center gap-2 text-body text-ink-2">
                  <Spinner aria-hidden="true" />
                  {t('recurring.candidates.loading')}
                </p>
              ) : rows.length === 0 ? (
                <p className="text-body text-ink-2">
                  {t('recurring.markPaid.empty')}
                </p>
              ) : (
                <RadioGroup
                  label={t('recurring.markPaid.field')}
                  value={selected ?? ''}
                  onChange={setSelected}
                >
                  {rows.map((row) => (
                    <Radio
                      key={row.id}
                      value={row.id}
                      description={row.note ?? undefined}
                    >
                      {`${formatCalendarDate(locale, row.bookedOn, 'medium')} · ${formatMoney(
                        locale,
                        makeMoney(row.amountMinor, row.currencyCode),
                      )}`}
                    </Radio>
                  ))}
                </RadioGroup>
              )}

              <p className="text-caption text-ink-2">
                {t('recurring.markPaid.never')}
              </p>
            </DialogBody>

            <DialogFooter>
              <Button variant="secondary" onPress={close} isDisabled={isSaving}>
                {t('action.cancel')}
              </Button>
              <Button
                variant="primary"
                isPending={isSaving}
                isDisabled={selected === null}
                onPress={() => void submit()}
              >
                {t('recurring.markPaid.confirm')}
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </Modal>
  )
}
