import { Badge } from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { RATE_IDENTITY, formatRateE10 } from '#/lib/money'

import { AmountText, ConvertedAmount } from './amount-text'
import { PAYMENT_METHOD_KEY } from './filter-chips'

import type { ReactNode } from 'react'
import type { LedgerRow } from './types'

/**
 * One transaction, read rather than edited.
 *
 * ## The conversion is quoted, never recomputed
 *
 * `refAmountMinor` and `rateE10` were fixed when the row was written, at the booking date's rate,
 * and this screen prints both of them as they stand. Working the conversion out again here would
 * produce a second opinion about a historical fact — and on a day when the rate has moved, a detail
 * screen that disagrees with the list it was opened from.
 *
 * ## Empty sections say so
 *
 * No tags, no receipt and no refund each render one line rather than disappearing. A screen whose
 * shape depends on what a row happens to have is a screen a reader has to re-learn on every visit,
 * and "is the receipt missing or is the section missing?" is not a question worth making anybody
 * ask. Those three sections are stubs owned by plans `08` and `11`; the line each shows now is the
 * same line it will show when it has nothing to list.
 */

export interface DetailSummaryProps {
  readonly row: LedgerRow
  readonly accountName: string
  readonly categoryName: string | null
  readonly payeeName: string | null
  /** Epoch-ms. Shown in the reader's own timezone, because it is an instant rather than a date. */
  readonly createdAtMs: number
  readonly timeZone: string
}

function Field({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-micro tracking-label uppercase text-ink-2">
        {label}
      </dt>
      <dd className="text-body text-ink">{children}</dd>
    </div>
  )
}

export function DetailSummary({
  row,
  accountName,
  categoryName,
  payeeName,
  createdAtMs,
  timeZone,
}: DetailSummaryProps) {
  const t = useTranslate()
  const locale = useLocale()
  const converted = row.currencyCode !== row.refCurrencyCode

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label={t('transactions.detail.summary')}
        className="rounded-lg border border-border-subtle bg-surface p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-title font-semibold text-ink">
              {payeeName ?? row.note ?? t('common.unknown')}
            </h2>
            <p className="mt-1 text-body text-ink-2">
              {formatCalendarDate(locale, row.bookedOn, 'full')}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {row.isPlanned ? (
                <Badge tone="info" size="sm">
                  {t('transactions.planned')}
                </Badge>
              ) : null}
              {row.isBalanceAdjustment ? (
                <Badge tone="warning" size="sm">
                  {t('transactions.balanceAdjustment')}
                </Badge>
              ) : null}
              {row.excludeFromStats ? (
                <Badge tone="neutral" size="sm">
                  {t('transactions.excludedFromTotals')}
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="text-end">
            <AmountText
              amountMinor={row.amountMinor}
              currencyCode={row.currencyCode}
              direction={row.direction}
              isPlanned={row.isPlanned}
              transferKind={row.transferKind}
              className="text-title"
            />
            {converted ? (
              <ConvertedAmount
                refAmountMinor={row.refAmountMinor}
                refCurrencyCode={row.refCurrencyCode}
                className="mt-1 text-body"
              />
            ) : null}
          </div>
        </div>

        <p className="mt-4 text-caption text-ink-2">
          {converted || row.rateE10 !== RATE_IDENTITY
            ? t('transactions.detail.rate', {
                rate: formatRateE10(
                  locale,
                  row.rateE10,
                  row.currencyCode,
                  row.refCurrencyCode,
                ),
                date: formatCalendarDate(locale, row.bookedOn, 'medium'),
              })
            : t('transactions.detail.identityRate')}
        </p>
      </section>

      <dl className="grid gap-5 rounded-lg border border-border-subtle bg-surface p-5 sm:grid-cols-2">
        <Field label={t('transactions.field.account')}>{accountName}</Field>
        <Field label={t('transactions.field.category')}>
          {categoryName ?? t('common.none')}
        </Field>
        <Field label={t('transactions.field.payee')}>
          {payeeName ?? t('common.none')}
        </Field>
        <Field label={t('transactions.field.paymentMethod')}>
          {row.paymentMethod === null
            ? t('common.none')
            : t(PAYMENT_METHOD_KEY[row.paymentMethod])}
        </Field>
        <Field label={t('transactions.field.note')}>
          {row.note ?? t('common.none')}
        </Field>
        <Field label={t('common.createdAt')}>
          {t('transactions.detail.recordedAt', {
            datetime: new Intl.DateTimeFormat(locale, {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone,
            }).format(new Date(createdAtMs)),
          })}
        </Field>
      </dl>

      <div className="grid gap-3 sm:grid-cols-3">
        <p className="rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3 text-caption text-ink-2">
          {t('transactions.detail.noTags')}
        </p>
        <p className="rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3 text-caption text-ink-2">
          {t('transactions.detail.noAttachments')}
        </p>
        <p className="rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3 text-caption text-ink-2">
          {t('transactions.detail.noRefunds')}
        </p>
      </div>
    </div>
  )
}
