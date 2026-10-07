import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { parseDate } from '@internationalized/date'

import { MarkPaidEmpty, MarkPaidStatus } from '#/components/app/recurring'
import { ErrorPanel } from '#/components/app/shell'
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

import { recordPaymentSearch } from '../-lib/record-payment'

import type { RecordPaymentOrigin } from '../-lib/record-payment'
import type { PeriodView } from '#/server/repos/recurring'
import type { RecurringSeries, Transaction } from '#/server/db/types'

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
 * ## The way forward is a navigation
 *
 * When nothing fits, the picker offers to *record the payment*: it opens the entry form started
 * from the period, with a way back that reopens this dialog on the same period once the person has
 * saved. That is a link to a form and not a write - the person presses Save there, through the same
 * path every entry takes, and the new row then falls inside the window below.
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
 *
 * ## One live region says what changed
 *
 * The list arrives after the dialog opens and moves nothing, so a screen reader would hear
 * silence. {@link MarkPaidStatus} is mounted on the first render and announces loading, then the
 * count or the empty state; the visible loading line is hidden from assistive technology so
 * loading is not said twice.
 */

export interface MarkPaidDialogProps {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  /** The series the period belongs to: its id, and what the entry form is started from. */
  readonly series: Pick<
    RecurringSeries,
    'id' | 'direction' | 'accountId' | 'categoryId' | 'payeeId'
  >
  /** What the dialog reads of the period: its window and what the entry form is started with. */
  readonly period: Pick<
    PeriodView,
    'periodStart' | 'dueOn' | 'expectedAmountMinor' | 'expectedCurrencyCode'
  >
  /** Where the person was, so that saving the payment brings them back to it. */
  readonly origin: RecordPaymentOrigin
  readonly onSaved: () => void
}

/** How far either side of the due date the picker looks. See the docblock. */
const WINDOW_DAYS = 14

export function MarkPaidDialog({
  isOpen,
  onOpenChange,
  series,
  period,
  origin,
  onSaved,
}: MarkPaidDialogProps) {
  const t = useTranslate()
  const locale = useLocale()
  const navigate = useNavigate()

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
          seriesId: series.id,
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
              <MarkPaidStatus
                candidateCount={rows === null ? null : rows.length}
                hasFailed={failure !== null}
              />

              {failure === null ? null : (
                <ErrorPanel
                  title={t('recurring.toast.failed')}
                  body={t('recurring.error.body')}
                  detail={failure}
                />
              )}

              {rows === null ? (
                // Hidden from assistive technology: the status region above announces loading.
                <p
                  aria-hidden="true"
                  className="flex items-center gap-2 text-body text-ink-2"
                >
                  <Spinner aria-hidden="true" />
                  {t('recurring.candidates.loading')}
                </p>
              ) : rows.length === 0 ? (
                failure === null ? (
                  <MarkPaidEmpty
                    onRecord={() =>
                      void navigate({
                        to: '/transactions/new',
                        search: recordPaymentSearch(series, period, origin),
                      })
                    }
                  />
                ) : null
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
