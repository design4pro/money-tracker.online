import { Select, SelectItem } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

import {
  DASHBOARD_PERIODS,
  PERIOD_LABEL_KEYS,
  isDashboardPeriod,
} from './period'

import type { DashboardPeriod } from './period'

/**
 * The one control that changes what every panel is counting.
 *
 * It is a `Select` rather than a row of chips: five options is already past the point where a
 * segmented control stops fitting a 360px viewport, and React Aria's Select brings the
 * `combobox`/`listbox` announcement pair, type-ahead and Escape-to-cancel with it. The trigger
 * carries `target-min` from `fieldSurface`, so the 44px target is not something this file has to
 * remember.
 *
 * The selected key is the period itself, so the URL, the loader and the control cannot drift:
 * there is no second mapping to keep in step.
 */
export interface PeriodSelectorProps {
  readonly period: DashboardPeriod
  readonly onChange: (period: DashboardPeriod) => void
}

export function PeriodSelector({ period, onChange }: PeriodSelectorProps) {
  const t = useTranslate()

  return (
    <Select
      aria-label={t('dashboard.period.label')}
      size="sm"
      className="min-w-44"
      selectedKey={period}
      onSelectionChange={(key) => {
        // RAC hands back a `Key`, which is `string | number`. The guard is what keeps an
        // unexpected key out of the URL rather than a cast that would let it through.
        if (isDashboardPeriod(key)) onChange(key)
      }}
    >
      {DASHBOARD_PERIODS.map((option) => (
        <SelectItem key={option} id={option}>
          {t(PERIOD_LABEL_KEYS[option])}
        </SelectItem>
      ))}
    </Select>
  )
}
