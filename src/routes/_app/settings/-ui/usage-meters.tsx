import { Meter } from '#/components/ui'
import { QUOTA_METRICS, UNLIMITED } from '#/lib/plans'
import { useLocale, useTranslate } from '#/lib/i18n'
import { formatNumber } from '#/lib/i18n/format'

import type { PlanLimits, QuotaMetric } from '#/lib/plans'
import type { MessageKey } from '#/lib/i18n'

/**
 * One labelled bar per metered resource, with the numbers **always in text**.
 *
 * A bar alone encodes a quantity in a length, which is unreadable to a screen reader, unreliable at
 * a glance and invisible to somebody who cannot distinguish the fill from the track. The caption
 * carries "12 of 25" as words beside every bar, and the bar is the redundant channel rather than
 * the only one (`docs/SPEC.md` §2 clause 9, and clause 8 for the tabular figures).
 *
 * The counts are the resolver's own (`EffectiveLimits.usage`) and are never recomputed here: the
 * number a person reads and the number the repository enforces against have to be the same one.
 */

const METRIC_LABEL: Readonly<Record<QuotaMetric, MessageKey>> = {
  members: 'billing.usage.metric.members',
  accounts: 'billing.usage.metric.accounts',
  currencies: 'billing.usage.metric.currencies',
  budgets: 'billing.usage.metric.budgets',
  goals: 'billing.usage.metric.goals',
  rules: 'billing.usage.metric.rules',
  recurringSeries: 'billing.usage.metric.recurringSeries',
  transactions: 'billing.usage.metric.transactions',
  importsPerMonth: 'billing.usage.metric.importsPerMonth',
  storageBytes: 'billing.usage.metric.storageBytes',
}

/** Bytes are the one metric a bare integer would be unreadable as. */
const MEGABYTE = 1024 * 1024

export interface UsageMetersProps {
  readonly limits: PlanLimits
  readonly usage: Readonly<Record<QuotaMetric, number>>
}

export function UsageMeters({ limits, usage }: UsageMetersProps) {
  const t = useTranslate()
  const locale = useLocale()

  return (
    <ul className="flex flex-col gap-5">
      {QUOTA_METRICS.map((metric) => {
        const limit = limits[metric]
        const used = usage[metric]
        const isUnlimited = limit === UNLIMITED
        const format = (value: number) =>
          metric === 'storageBytes'
            ? `${formatNumber(locale, Math.round(value / MEGABYTE))} MB`
            : formatNumber(locale, value)

        return (
          <li key={metric}>
            <Meter
              label={t(METRIC_LABEL[metric])}
              // An unlimited metric still gets a bar so the list does not gap: its value is the
              // count against itself, which reads as full and says nothing misleading beside a
              // caption that states there is no limit.
              value={isUnlimited ? 0 : used}
              minValue={0}
              maxValue={isUnlimited ? 1 : Math.max(limit, used, 1)}
              showValue={false}
              tone="neutral"
              caption={
                <span className="tabular-nums">
                  {isUnlimited
                    ? t('billing.usage.unlimited', { used: format(used) })
                    : t('billing.usage.value', {
                        used: format(used),
                        limit: format(limit),
                      })}
                </span>
              }
            />
          </li>
        )
      })}
    </ul>
  )
}
