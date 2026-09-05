import { AmountText, ConvertedAmount } from '#/components/app/transactions'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { asCurrencyCode, asMinor } from '#/lib/money'

import type {
  LedgerDirection,
  LedgerTransferKind,
} from '#/components/app/transactions'
import type { MessageKey } from '#/lib/i18n'

/**
 * Five rows of a ledger, on the page a visitor sees before they have one.
 *
 * The landing page's whole argument is that the arithmetic is right, and the only honest way to
 * make that argument is to run it. So this is not a picture of the product: it is
 * {@link AmountText} and {@link ConvertedAmount}, the same components the signed-in ledger uses,
 * handed static props. Every rule they carry comes with them — the U+2212 minus, the tabular
 * figures, the four tones with weight and glyph doing the work colour cannot, and the `sr-only`
 * sentence that names the currency in full.
 *
 * **The rows are invented and the page says so.** `PRODUCT.md` forbids fabricating evidence, and a
 * ledger fragment with no label is exactly the kind of thing a visitor could read as somebody's
 * real account. The caption under the table names it as an example, in both locales.
 *
 * The euro row is the point of the section. `refAmountMinor` is 118.42 zł because 27.40 € was
 * booked at 4.3218 on 14 March 2026 and frozen there; it is a literal here for the same reason it
 * is a stored column in the database — a figure recomputed today would be a different claim.
 */

interface PreviewRow {
  readonly id: string
  /** ISO calendar date. Formatted by the active locale, never concatenated. */
  readonly bookedOn: string
  readonly payee: MessageKey
  readonly category: MessageKey
  readonly amountMinor: number
  readonly currencyCode: string
  readonly direction: LedgerDirection
  readonly transferKind?: LedgerTransferKind
  /** Set only where the row's currency is not the workspace's base. */
  readonly refAmountMinor?: number
}

const ROWS: ReadonlyArray<PreviewRow> = [
  {
    id: 'groceries',
    bookedOn: '2026-03-14',
    payee: 'marketing.ledger.row.groceries',
    category: 'marketing.ledger.category.groceries',
    amountMinor: 2740,
    currencyCode: 'EUR',
    direction: 'expense',
    refAmountMinor: 11842,
  },
  {
    id: 'salary',
    bookedOn: '2026-03-12',
    payee: 'marketing.ledger.row.salary',
    category: 'marketing.ledger.category.income',
    amountMinor: 940000,
    currencyCode: 'PLN',
    direction: 'income',
  },
  {
    id: 'streaming',
    bookedOn: '2026-03-11',
    payee: 'marketing.ledger.row.streaming',
    category: 'marketing.ledger.category.subscriptions',
    amountMinor: 4300,
    currencyCode: 'PLN',
    direction: 'expense',
  },
  {
    id: 'savings',
    bookedOn: '2026-03-09',
    payee: 'marketing.ledger.row.savings',
    category: 'marketing.ledger.category.transfer',
    amountMinor: 120000,
    currencyCode: 'PLN',
    direction: 'expense',
    transferKind: 'internal',
  },
  {
    id: 'rent',
    bookedOn: '2026-03-05',
    payee: 'marketing.ledger.row.rent',
    category: 'marketing.ledger.category.housing',
    amountMinor: 325000,
    currencyCode: 'PLN',
    direction: 'expense',
  },
]

export function LedgerPreview() {
  const t = useTranslate()
  const locale = useLocale()

  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-card">
      <table className="w-full border-collapse">
        <caption className="sr-only">{t('marketing.ledger.caption')}</caption>
        <thead>
          <tr className="border-b border-border-subtle bg-surface-sunken">
            <th
              scope="col"
              className="hidden px-4 py-2 text-start text-micro tracking-label uppercase text-ink-2 sm:table-cell sm:px-6"
            >
              {t('common.date')}
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-start text-micro tracking-label uppercase text-ink-2 sm:px-6"
            >
              {t('common.description')}
            </th>
            <th
              scope="col"
              className="px-4 py-2 text-end text-micro tracking-label uppercase text-ink-2 sm:px-6"
            >
              {t('common.amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr
              key={row.id}
              className="border-b border-border-subtle last:border-b-0"
            >
              <td className="hidden px-4 py-3 align-top tabular text-caption whitespace-nowrap text-ink-2 sm:table-cell sm:px-6">
                {formatCalendarDate(locale, row.bookedOn, 'medium')}
              </td>
              <td className="px-4 py-3 align-top sm:px-6">
                {/* Below `sm` the date column is gone and the date rides here instead: three
                    columns inside 360px turns a ledger into a word-wrapped mess, and the design
                    system already stacks this row rather than squeezing it. `hidden` is
                    `display: none`, so only one of the two ever reaches the accessibility tree. */}
                <span className="block tabular text-caption text-ink-2 sm:hidden">
                  {formatCalendarDate(locale, row.bookedOn, 'medium')}
                </span>
                <span className="block text-label font-medium text-ink">
                  {t(row.payee)}
                </span>
                <span className="block text-caption text-ink-2">
                  {t(row.category)}
                </span>
              </td>
              <td className="px-4 py-3 text-end align-top sm:px-6">
                <AmountText
                  amountMinor={asMinor(row.amountMinor)}
                  currencyCode={asCurrencyCode(row.currencyCode)}
                  direction={row.direction}
                  transferKind={row.transferKind ?? 'none'}
                />
                {row.refAmountMinor === undefined ? null : (
                  <ConvertedAmount
                    refAmountMinor={asMinor(row.refAmountMinor)}
                    refCurrencyCode={asCurrencyCode('PLN')}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
