import { Card } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useLocale, useTranslate } from '#/lib/i18n'
import { formatMoney, makeMoney } from '#/lib/money'

import type { SeriesForecast } from '#/server/recurring/forecast'

/**
 * Spent this year, rest of year, next twelve months — three integer amounts, as text.
 *
 * Used on `/recurring` (rolled up per currency) and on a series detail (that series alone). The
 * guideline in `DESIGN.md` is what keeps the two call sites drawing the same three questions.
 */

export interface ForecastPanelProps {
  readonly forecasts: ReadonlyArray<SeriesForecast>
  readonly className?: string
}

const METRICS = ['spent', 'rest', 'next12'] as const

function amountOf(
  forecast: SeriesForecast,
  metric: (typeof METRICS)[number],
): number {
  if (metric === 'spent') return forecast.spentThisYearMinor
  if (metric === 'rest') return forecast.restOfYearMinor
  return forecast.next12MonthsMinor
}

export function ForecastPanel({ forecasts, className }: ForecastPanelProps) {
  const t = useTranslate()
  const locale = useLocale()

  if (forecasts.length === 0) {
    return (
      <Card padding="lg" className={className}>
        <h2 className="text-subtitle font-semibold text-ink">
          {t('recurring.forecast.title')}
        </h2>
        <p className="mt-1 text-body text-ink-2">
          {t('recurring.forecast.empty')}
        </p>
      </Card>
    )
  }

  return (
    <Card padding="lg" className={cn('flex flex-col gap-4', className)}>
      <div>
        <h2 className="text-subtitle font-semibold text-ink">
          {t('recurring.forecast.title')}
        </h2>
        <p className="mt-1 max-w-prose text-caption text-ink-2">
          {t('recurring.forecast.caption')}
        </p>
      </div>

      {forecasts.map((forecast) => (
        <div key={forecast.currencyCode} className="flex flex-col gap-3">
          <dl className="grid gap-3 sm:grid-cols-3">
            {METRICS.map((metric) => (
              <div key={metric} className="min-w-0">
                <dt className="text-caption text-ink-2">
                  {t(`recurring.forecast.${metric}`)}
                </dt>
                <dd className="mt-0.5 text-subtitle font-semibold tabular text-ink">
                  {formatMoney(
                    locale,
                    makeMoney(
                      amountOf(forecast, metric),
                      forecast.currencyCode,
                    ),
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {/*
            A visually-hidden table so the three numbers are tabular data for a screen reader,
            not three adjacent paragraphs. Colour is not carrying the meaning.
          */}
          <table className="sr-only">
            <caption>{t('recurring.forecast.title')}</caption>
            <thead>
              <tr>
                {METRICS.map((metric) => (
                  <th key={metric} scope="col">
                    {t(`recurring.forecast.${metric}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {METRICS.map((metric) => (
                  <td key={metric}>
                    {formatMoney(
                      locale,
                      makeMoney(
                        amountOf(forecast, metric),
                        forecast.currencyCode,
                      ),
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </Card>
  )
}
