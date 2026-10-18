import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

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
import { formatMoney, makeMoney, subtractMinor } from '#/lib/money'
import {
  loadInstalmentCandidates,
  markLoanInstalmentPaid,
} from '#/server/fns/loans'

import type { Transaction } from '#/server/db/types'
import type { InstalmentView } from '#/server/repos/loans'

/**
 * Linking an instalment to the transaction that settled it.
 *
 * The dialog never creates a transaction. When nothing fits it says *record the payment first*
 * and opens the entry form with the account, date and amount suggested.
 */

export interface SettleDialogProps {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  readonly loanId: string
  readonly accountId: string | null
  readonly instalment: Pick<
    InstalmentView,
    'sequence' | 'dueOn' | 'amountMinor' | 'currencyCode'
  >
  readonly onSaved: () => void
}

export function SettleDialog({
  isOpen,
  onOpenChange,
  loanId,
  accountId,
  instalment,
  onSaved,
}: SettleDialogProps) {
  const t = useTranslate()
  const locale = useLocale()
  const navigate = useNavigate()

  const [rows, setRows] = useState<ReadonlyArray<Transaction> | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setSelected(null)
    setFailure(null)
    void loadInstalmentCandidates({
      data: { loanId, sequence: instalment.sequence },
    })
      .then((page) => {
        if (!cancelled) setRows(page)
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
  }, [loanId, instalment.sequence])

  async function submit() {
    if (selected === null) return
    setIsSaving(true)
    setFailure(null)
    try {
      await markLoanInstalmentPaid({
        data: {
          loanId,
          sequence: instalment.sequence,
          transactionId: selected,
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

  const planned = formatMoney(
    locale,
    makeMoney(instalment.amountMinor, instalment.currencyCode),
  )

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
      <Dialog>
        {({ close }) => (
          <>
            <DialogHeader
              title={t('loans.markPaid.title')}
              description={t('loans.markPaid.body')}
              closeLabel={t('action.close')}
              onClose={close}
            />
            <DialogBody className="flex flex-col gap-4">
              <p role="status" className="sr-only">
                {rows === null
                  ? t('loans.markPaid.loading')
                  : t('loans.markPaid.candidateCount', { count: rows.length })}
              </p>

              {failure === null ? null : (
                <ErrorPanel
                  title={t('loans.toast.failed')}
                  body={t('loans.error.body')}
                  detail={failure}
                />
              )}

              {rows === null ? (
                <p
                  aria-hidden="true"
                  className="flex items-center gap-2 text-body text-ink-2"
                >
                  <Spinner aria-hidden="true" />
                  {t('loans.markPaid.loading')}
                </p>
              ) : rows.length === 0 ? (
                failure === null ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-body text-ink-2">
                      {t('loans.markPaid.empty')}
                    </p>
                    <Button
                      variant="secondary"
                      onPress={() =>
                        void navigate({
                          to: '/transactions/new',
                          search: {
                            direction: 'expense',
                            amount: instalment.amountMinor,
                            currency: instalment.currencyCode,
                            date: instalment.dueOn,
                            ...(accountId === null
                              ? {}
                              : { account: accountId }),
                          },
                        })
                      }
                    >
                      {t('loans.markPaid.record')}
                    </Button>
                  </div>
                ) : null
              ) : (
                <RadioGroup
                  label={t('loans.markPaid.field')}
                  value={selected ?? ''}
                  onChange={setSelected}
                >
                  {rows.map((row) => {
                    const variance = subtractMinor(
                      row.amountMinor,
                      instalment.amountMinor,
                    )
                    const varianceLabel =
                      variance === 0
                        ? t('loans.markPaid.variance.none')
                        : variance > 0
                          ? t('loans.markPaid.variance.over', {
                              amount: formatMoney(
                                locale,
                                makeMoney(variance, row.currencyCode),
                              ),
                            })
                          : t('loans.markPaid.variance.under', {
                              amount: formatMoney(
                                locale,
                                makeMoney(-variance, row.currencyCode),
                              ),
                            })
                    return (
                      <Radio
                        key={row.id}
                        value={row.id}
                        description={`${planned} · ${varianceLabel}`}
                      >
                        {`${formatCalendarDate(locale, row.bookedOn, 'medium')} · ${formatMoney(
                          locale,
                          makeMoney(row.amountMinor, row.currencyCode),
                        )}`}
                      </Radio>
                    )
                  })}
                </RadioGroup>
              )}

              <p className="text-caption text-ink-2">
                {t('loans.markPaid.never')}
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
                {t('loans.markPaid.confirm')}
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </Modal>
  )
}
