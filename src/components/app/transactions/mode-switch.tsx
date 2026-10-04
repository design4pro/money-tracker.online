import { SegmentedFilter } from '#/components/app/nav'
import { useTranslate } from '#/lib/i18n'

/**
 * Recorded or planned: the two addresses of the transactions screen, as one control.
 *
 * `/transactions` is what has happened and `/transactions/planned` is what is coming. They are two
 * routes because the planned policy changes which rows the screen is *about* rather than narrowing
 * them, and this is how a person gets from one to the other - the planned address was reachable
 * only by typing it, and a nav entry for a mode would re-widen a navigation that was deliberately
 * narrowed (`destinations.ts`).
 *
 * It is {@link SegmentedFilter}, so it is a radio group: one tab stop, the arrow keys move and
 * select, the current value is announced. It reports the choice and navigates nowhere - the routes
 * know their own addresses and carry the active filters across.
 *
 * The labels are `Recorded` and `Planned`, never the codebase's own word for the surface
 * (`docs/I18N.md`).
 */

export type TransactionsMode = 'recorded' | 'planned'

export interface TransactionsModeSwitchProps {
  readonly mode: TransactionsMode
  readonly onChange: (mode: TransactionsMode) => void
}

export function TransactionsModeSwitch({
  mode,
  onChange,
}: TransactionsModeSwitchProps) {
  const t = useTranslate()

  return (
    <SegmentedFilter
      label={t('transactions.mode.label')}
      value={mode}
      options={[
        { id: 'recorded', label: t('transactions.mode.actual') },
        { id: 'planned', label: t('transactions.mode.planned') },
      ]}
      onChange={onChange}
    />
  )
}
