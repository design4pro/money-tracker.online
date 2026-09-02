import { formatPercent } from '#/lib/i18n'

import type { ChartCopy, DonutCopy } from '#/components/charts'
import type { Locale, Translate } from '#/lib/i18n'

/**
 * The dashboard's chart copy, built in one place.
 *
 * A chart takes its strings as props rather than reading the catalogue itself — that is what keeps
 * `src/components/charts/**` renderable from a fixture in a test. The cost of that decision is a
 * copy bundle per chart, and this module is where it is paid **once** so five widgets do not each
 * invent their own wording for "No reading".
 *
 * The share formatter is `formatPercent`, not `${percent}%`: Polish writes `12%` and English
 * writes `12%`, but the space, the sign and the numeral system are the locale's business and this
 * product has no business hard-coding any of them.
 */

/** The base bundle every chart needs. Widgets override `title` and the two empty-state lines. */
export function chartCopy(
  t: Translate,
  copy: {
    readonly title: string
    readonly categoryHeader: string
    readonly emptyTitle: string
    readonly emptyBody: string
  },
): ChartCopy {
  return { ...copy, noData: t('dashboard.chart.noData') }
}

/** The cash-flow chart: months across, money up. */
export function cashFlowCopy(t: Translate): ChartCopy {
  return chartCopy(t, {
    title: t('dashboard.widget.cashFlow'),
    categoryHeader: t('dashboard.cashFlow.month'),
    emptyTitle: t('dashboard.cashFlow.empty.title'),
    emptyBody: t('dashboard.cashFlow.empty.body'),
  })
}

/** The spending donut, including everything the `Other` group needs to stay reachable. */
export function spendingCopy(t: Translate, locale: Locale): DonutCopy {
  return {
    ...chartCopy(t, {
      title: t('dashboard.widget.spendingByCategory'),
      categoryHeader: t('transactions.field.category'),
      emptyTitle: t('dashboard.spending.empty.title'),
      emptyBody: t('dashboard.spending.empty.body'),
    }),
    otherLabel: t('dashboard.spending.other'),
    expandLabel: t('dashboard.spending.showOther'),
    collapseLabel: t('dashboard.spending.hideOther'),
    totalLabel: t('common.total'),
    amountHeader: t('common.amount'),
    shareHeader: t('dashboard.spending.share'),
    // The chart hands over whole percents that already sum to 100; dividing by 100 hands
    // `Intl` the ratio it expects without reintroducing a decimal into an amount.
    formatShare: (percent) => formatPercent(locale, percent / 100),
  }
}
