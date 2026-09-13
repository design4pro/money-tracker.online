import { useCallback, useEffect, useRef, useState } from 'react'

import { ErrorPanel } from '#/components/app/shell'
import {
  Badge,
  Button,
  Card,
  Cell,
  Column,
  Row,
  Skeleton,
  Table,
  TableBody,
  TableHeader,
  toast,
} from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'
import { loadRefunds, unlinkRefund } from '#/server/fns/refunds'

import { RefundDialog } from './refund-dialog'

import type { RefundSummary } from '#/server/repos/refunds'

/**
 * The refund panel: what came back, what this transaction ended up costing, and what it refunds.
 *
 * ## The effective amount is a sentence, because that arithmetic is the feature
 *
 * _"Original 240,00 zł, refunded 90,00 zł, effective 150,00 zł"_ — one sentence, all three figures,
 * already subtracted. Three chips beside each other would make every reader do the subtraction and
 * a screen-reader user do it from three separate announcements, and the subtraction is the entire
 * reason somebody opened this panel. The figures come from the repository, which is also where the
 * ceiling that keeps `effective` non-negative is enforced; this component prints them and computes
 * nothing.
 *
 * ## Two sections, because a transaction can be on either side of a refund
 *
 * A purchase has refunds *of* it. An income can *be* one. Both are true of the same row often
 * enough that a panel which handled only one of them would send people to the wrong screen, so the
 * panel shows what came back and, beneath it, what this row itself gives back — or the action that
 * says so, which opens {@link RefundDialog}.
 *
 * ## It owns its figures, and the host may only hand it a first paint
 *
 * The detail route reads the summary too — it needs the count for the collapsed section title,
 * before this component mounts — so it may pass that read in as {@link RefundPanelProps.initialSummary}
 * to save a second round trip. That seed is a first paint and nothing more: it is consumed once,
 * and from then on the panel's own reads are the only source. Without it the panel fetches on
 * mount, shows two skeleton rows while the request runs, and renders a retryable `ErrorPanel`
 * inside its own card when it fails — which is also the failure path for every refetch after a
 * write, seeded or not.
 */

export interface RefundPanelProps {
  /** The transaction whose detail screen this is. */
  readonly transactionId: string
  /**
   * The summary the host already read, used for the first paint instead of a second round trip.
   *
   * **First paint only.** The panel refetches after every link and unlink and keeps its own state
   * from then on, because the host's copy can be older than what the panel read after its own
   * write. Do not turn this into a controlled value: passing a fresher-looking object on a later
   * render will not update the panel, and making it do so would put the newest figures behind
   * whatever the route last cached. Omit it and the panel fetches on mount, which is the same
   * data by the same path.
   */
  readonly initialSummary?: RefundSummary
  /**
   * Called after a link or an unlink is written.
   *
   * Linking changes `refund_linked` on both rows, which is what `07-S1`'s delete refuses on, so the
   * host reloads the transaction behind the panel rather than leaving a stale Delete button on it.
   */
  readonly onChanged: () => void
}

export function RefundPanel({
  transactionId,
  initialSummary,
  onChanged,
}: RefundPanelProps) {
  const t = useTranslate()
  const locale = useLocale()

  const [summary, setSummary] = useState<RefundSummary | null>(
    initialSummary ?? null,
  )
  const [failure, setFailure] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const reload = useCallback(async () => {
    setFailure(null)
    try {
      setSummary(await loadRefunds({ data: { transactionId } }))
    } catch (error) {
      setSummary(null)
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }, [transactionId])

  // Which transaction the seed was for, so the fetch stays the fallback rather than a second
  // source: a seeded panel skips the mount read, and one whose subject changed under it without
  // remounting falls back to reading, because the seed it holds is for the previous row.
  const seededFor = useRef(initialSummary === undefined ? null : transactionId)

  useEffect(() => {
    if (seededFor.current === transactionId) return
    void reload()
  }, [reload, transactionId])

  // Pulled out of the JSX so the narrowing survives into the press handler below: a `null` check
  // on a property does not narrow inside a closure, and a `?? ''` to appease that would be a
  // fallback for a state the branch has already ruled out.
  const given = summary?.refundOf ?? null

  const money = (minor: number, currencyCode: string) =>
    formatMoney(locale, makeMoney(minor, currencyCode))

  const day = (date: string) => formatCalendarDate(locale, date, 'medium')

  async function unlink(refundId: string) {
    setIsBusy(true)
    try {
      await unlinkRefund({ data: { refundId } })
      toast.success(t('refunds.unlinked'))
      await reload()
      onChanged()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Card
      as="section"
      aria-labelledby="refund-panel-heading"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="refund-panel-heading"
          className="text-body font-semibold text-ink"
        >
          {t('refunds.title')}
        </h2>
        <p className="text-caption text-ink-2">{t('refunds.description')}</p>
      </div>

      {failure === null ? null : (
        <ErrorPanel
          title={t('refunds.error.title')}
          body={t('empty.error.body')}
          detail={failure}
          onRetry={() => void reload()}
        />
      )}

      {summary === null ? (
        failure === null ? (
          <>
            {/* Two rows, which is the shape of the table that replaces them. */}
            <Skeleton shape="text" lines={2} />
            <p role="status" className="sr-only">
              {t('refunds.loading')}
            </p>
          </>
        ) : null
      ) : (
        <>
          {/*
            The effective amount, always as one sentence and never as three chips. `role="status"`
            makes it re-announce after a link or an unlink, which are the two moments the figure
            changes under somebody.
          */}
          <p role="status" className="text-caption text-ink-2 tabular">
            {summary.received.length === 0
              ? t('refunds.empty')
              : t('refunds.effective', {
                  original: money(summary.amountMinor, summary.currencyCode),
                  refunded: money(summary.refundedMinor, summary.currencyCode),
                  effective: money(
                    summary.effectiveMinor,
                    summary.currencyCode,
                  ),
                })}
          </p>

          {summary.received.length === 0 ? null : (
            <Table aria-label={t('refunds.list.label')}>
              <TableHeader>
                <Column isRowHeader>{t('refunds.column.date')}</Column>
                <Column align="end">{t('refunds.column.amount')}</Column>
                <Column>{t('refunds.column.origin')}</Column>
                <Column>{t('refunds.column.actions')}</Column>
              </TableHeader>
              <TableBody>
                {summary.received.map(({ link, transaction }) => (
                  <Row key={link.id}>
                    <Cell numeric>{day(transaction.bookedOn)}</Cell>
                    <Cell align="end" numeric>
                      {money(link.amountMinor, link.currencyCode)}
                    </Cell>
                    <Cell>
                      <Badge tone={link.splitId === null ? 'neutral' : 'info'}>
                        {link.splitId === null
                          ? t('refunds.origin.whole')
                          : t('refunds.origin.line')}
                      </Badge>
                    </Cell>
                    <Cell>
                      <Button
                        variant="ghost"
                        size="sm"
                        isDisabled={isBusy}
                        // The visible word is "Unlink" on every row; the accessible name says
                        // which one, because a column of identical names is a column nobody can
                        // navigate.
                        aria-label={t('refunds.unlink.label', {
                          amount: money(link.amountMinor, link.currencyCode),
                          date: day(transaction.bookedOn),
                        })}
                        onPress={() => void unlink(link.id)}
                      >
                        {t('refunds.unlink')}
                      </Button>
                    </Cell>
                  </Row>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
            <h3 className="text-label font-semibold text-ink">
              {t('refunds.given.title')}
            </h3>

            {given === null ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  isDisabled={isBusy}
                  onPress={() => setIsDialogOpen(true)}
                >
                  {t('refunds.link')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-caption text-ink-2">
                  {given.original === null
                    ? t('refunds.given.external')
                    : t('refunds.given.transaction', {
                        amount: money(
                          given.original.amountMinor,
                          given.original.currencyCode,
                        ),
                        date: day(given.original.bookedOn),
                      })}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  isDisabled={isBusy}
                  onPress={() => void unlink(given.link.id)}
                >
                  {t('refunds.given.unlink')}
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {isDialogOpen ? (
        <RefundDialog
          isOpen={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          refundTransactionId={transactionId}
          onLinked={() => {
            toast.success(t('refunds.linked'))
            void reload()
            onChanged()
          }}
        />
      ) : null}
    </Card>
  )
}
