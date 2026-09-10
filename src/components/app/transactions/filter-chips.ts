/**
 * The active filters, written out as removable chips.
 *
 * A filter the reader cannot see is a filter they will blame on the data. Every narrowing in
 * {@link LedgerFilters} therefore has to be able to say its own name **with its value in it** —
 * "Account: Wallet, Cash", not "Account" — and to hand back the filter set with itself taken off.
 *
 * That "hand back" is why this is a pure function rather than a component: a chip's remove action
 * is a value, so it is testable without a render, and the caller writes it straight into the URL.
 */

import { formatCalendarDate } from '#/lib/i18n'
import { formatMoney, money } from '#/lib/money'

import type { Locale, Translate } from '#/lib/i18n'
import type { CurrencyCode, Minor } from '#/lib/money'
import type { LedgerFilters, NamedOption, TransactionReference } from './types'

export interface FilterChip {
  /** Stable across renders, so removing one chip does not re-key the rest. */
  readonly id: string
  /** Reads on its own, out of context — it is also the remove button's accessible name. */
  readonly label: string
  /** The filter set with this narrowing removed. */
  readonly next: LedgerFilters
}

export interface DescribeFiltersArgs {
  readonly filters: LedgerFilters
  readonly reference: TransactionReference
  readonly t: Translate
  readonly locale: Locale
}

/** How many narrowings are in force. Drives the count beside the Filters button. */
export function countActiveFilters(filters: LedgerFilters): number {
  const amountSet =
    filters.amountMinMinor !== undefined || filters.amountMaxMinor !== undefined
  const parts = [
    filters.text,
    filters.from,
    filters.to,
    filters.accountIds,
    filters.accountGroupIds,
    filters.categoryIds,
    filters.tagIds,
    filters.payeeIds,
    filters.direction,
    filters.paymentMethods,
    filters.hasAttachment,
  ]
  const named = parts.filter((part) => part !== undefined).length
  return named + (amountSet ? 1 : 0)
}

/**
 * Whether two filter sets narrow the ledger the same way.
 *
 * This is what the filter panel's unsaved-changes guard asks. It cannot use the `useIsDirty` hook
 * the form dialogs share, for two reasons the panel has and they do not: the panel outlives its own
 * open — it is mounted with the bar — so its baseline has to be re-taken at each open rather than at
 * first render; and half of {@link LedgerFilters} is arrays, which a per-key `Object.is` would call
 * changed on every keystroke that rebuilt one.
 *
 * The comparison walks the keys of both sides rather than a list written out here, so a filter added
 * to {@link LedgerFilters} later is compared without anybody remembering to come back. Order matters
 * inside an array: the panel builds its id lists from the reference order, so a difference in order
 * is a difference the panel did not produce, and over-reporting is the safe direction for a guard.
 */
export function isSameFilterView(a: LedgerFilters, b: LedgerFilters): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])

  for (const key of keys) {
    const left = a[key as keyof LedgerFilters]
    const right = b[key as keyof LedgerFilters]

    if (Array.isArray(left) && Array.isArray(right)) {
      if (
        left.length !== right.length ||
        left.some((value, index) => !Object.is(value, right[index]))
      ) {
        return false
      }
      continue
    }

    if (!Object.is(left, right)) return false
  }

  return true
}

function namesFor(
  ids: ReadonlyArray<string>,
  options: ReadonlyArray<NamedOption>,
  fallback: string,
): string {
  const index = new Map(options.map((option) => [option.id, option.name]))
  return ids.map((id) => index.get(id) ?? fallback).join(', ')
}

function withoutKeys(
  filters: LedgerFilters,
  keys: ReadonlyArray<keyof LedgerFilters>,
): LedgerFilters {
  const next: Record<string, unknown> = { ...filters }
  for (const key of keys) {
    delete next[key]
  }
  return next
}

/**
 * One chip per active narrowing, in the order the filter panel presents them.
 *
 * An id whose name is not in the reference set — a category filter carried in on a shared link
 * before the vocabulary has loaded — falls back to the localised "unknown" rather than printing a
 * raw id at somebody. The filter still works; only its label is provisional.
 */
export function describeFilters({
  filters,
  reference,
  t,
  locale,
}: DescribeFiltersArgs): ReadonlyArray<FilterChip> {
  const unknown = t('common.unknown')
  const chips: Array<FilterChip> = []

  if (filters.text !== undefined) {
    chips.push({
      id: 'text',
      label: t('transactions.chip.text', { value: filters.text }),
      next: withoutKeys(filters, ['text']),
    })
  }

  if (filters.from !== undefined || filters.to !== undefined) {
    const from =
      filters.from === undefined
        ? t('transactions.chip.anyDate')
        : formatCalendarDate(locale, filters.from, 'medium')
    const to =
      filters.to === undefined
        ? t('transactions.chip.anyDate')
        : formatCalendarDate(locale, filters.to, 'medium')
    chips.push({
      id: 'dates',
      label: t('transactions.chip.dates', { from, to }),
      next: withoutKeys(filters, ['from', 'to']),
    })
  }

  if (filters.accountIds !== undefined) {
    chips.push({
      id: 'accounts',
      label: t('transactions.chip.accounts', {
        value: namesFor(filters.accountIds, reference.accounts, unknown),
      }),
      next: withoutKeys(filters, ['accountIds']),
    })
  }

  if (filters.accountGroupIds !== undefined) {
    chips.push({
      id: 'accountGroups',
      label: t('transactions.chip.accountGroups', {
        value: namesFor(
          filters.accountGroupIds,
          reference.accountGroups,
          unknown,
        ),
      }),
      next: withoutKeys(filters, ['accountGroupIds']),
    })
  }

  if (filters.categoryIds !== undefined) {
    chips.push({
      id: 'categories',
      label: t('transactions.chip.categories', {
        value: namesFor(filters.categoryIds, reference.categories, unknown),
      }),
      next: withoutKeys(filters, ['categoryIds']),
    })
  }

  if (filters.payeeIds !== undefined) {
    chips.push({
      id: 'payees',
      label: t('transactions.chip.payees', {
        value: namesFor(filters.payeeIds, reference.payees, unknown),
      }),
      next: withoutKeys(filters, ['payeeIds']),
    })
  }

  if (filters.tagIds !== undefined) {
    chips.push({
      id: 'tags',
      label: t('transactions.chip.tags', {
        value: namesFor(filters.tagIds, reference.tags, unknown),
      }),
      next: withoutKeys(filters, ['tagIds']),
    })
  }

  if (filters.direction !== undefined) {
    chips.push({
      id: 'direction',
      label: t('transactions.chip.direction', {
        value:
          filters.direction === 'income'
            ? t('transactions.direction.income')
            : t('transactions.direction.expense'),
      }),
      next: withoutKeys(filters, ['direction']),
    })
  }

  if (filters.paymentMethods !== undefined) {
    chips.push({
      id: 'paymentMethods',
      label: t('transactions.chip.paymentMethods', {
        value: filters.paymentMethods
          .map((method) => t(PAYMENT_METHOD_KEY[method]))
          .join(', '),
      }),
      next: withoutKeys(filters, ['paymentMethods']),
    })
  }

  if (
    filters.amountMinMinor !== undefined ||
    filters.amountMaxMinor !== undefined
  ) {
    const currency = (filters.amountCurrency ??
      reference.baseCurrencyCode) as CurrencyCode
    const write = (value: number | undefined): string =>
      value === undefined
        ? t('transactions.chip.anyAmount')
        : formatMoney(locale, money(value as Minor, currency), {
            display: 'narrowSymbol',
          })
    chips.push({
      id: 'amount',
      label: t('transactions.chip.amount', {
        from: write(filters.amountMinMinor),
        to: write(filters.amountMaxMinor),
      }),
      next: withoutKeys(filters, [
        'amountCurrency',
        'amountMinMinor',
        'amountMaxMinor',
      ]),
    })
  }

  if (filters.hasAttachment !== undefined) {
    chips.push({
      id: 'hasAttachment',
      label: filters.hasAttachment
        ? t('transactions.chip.withReceipt')
        : t('transactions.chip.withoutReceipt'),
      next: withoutKeys(filters, ['hasAttachment']),
    })
  }

  return chips
}

/** The catalogue key for each payment method. Shared with the filter panel and the form. */
export const PAYMENT_METHOD_KEY = {
  cash: 'transactions.method.cash',
  card: 'transactions.method.card',
  transfer: 'transactions.method.transfer',
  direct_debit: 'transactions.method.directDebit',
  standing_order: 'transactions.method.standingOrder',
  other: 'transactions.method.other',
} as const
