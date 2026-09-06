import { BudgetMeter } from '#/components/app/budgets'
import { useTranslate } from '#/lib/i18n'
import { asMinor } from '#/lib/money'

import type { MessageKey } from '#/lib/i18n'

/**
 * The budget meter, in all three of its states, side by side.
 *
 * The claim this band makes is that an overspend survives having the colour taken away, and the
 * only way to make that claim without asking to be believed is to put the three states next to
 * each other and let a reader see the word, the icon, the sign and the hatching change together.
 * So this renders the real {@link BudgetMeter} — not a drawing of one — with the numbers chosen so
 * each state is unambiguous: comfortably under, past the 80% notch, and 116% of the envelope gone.
 *
 * Every figure is minor units of PLN and the meter formats them. Nothing here is arithmetic: the
 * remainders are written out rather than subtracted, because the component's contract is that the
 * caller has already done the sums and it only draws them.
 *
 * ## Why it is a stack of ruled rows and not three cards
 *
 * Three equal cards in a row is the shape that says *three features*, and this band has one
 * component in it. Hairline-separated rows on the band's own ground say what is true: the same
 * meter, three times, with the numbers changed. It also keeps the page flat at rest — a card on
 * `bg-surface` inside a `bg-surface` band is a shadow pretending to be an edge.
 */

interface MeterState {
  readonly id: string
  readonly name: MessageKey
  readonly availableMinor: number
  readonly spentMinor: number
  readonly remainingMinor: number
  readonly ratio: number
  readonly state: 'under' | 'approaching' | 'over'
}

const THRESHOLDS: ReadonlyArray<number> = [50, 80]

const STATES: ReadonlyArray<MeterState> = [
  {
    id: 'under',
    name: 'marketing.meter.groceries',
    availableMinor: 120000,
    spentMinor: 61200,
    remainingMinor: 58800,
    ratio: 0.51,
    state: 'under',
  },
  {
    id: 'approaching',
    name: 'marketing.meter.fuel',
    availableMinor: 40000,
    spentMinor: 34000,
    remainingMinor: 6000,
    ratio: 0.85,
    state: 'approaching',
  },
  {
    id: 'over',
    name: 'marketing.meter.eatingOut',
    availableMinor: 50000,
    spentMinor: 58000,
    remainingMinor: -8000,
    ratio: 1.16,
    state: 'over',
  },
]

export function BudgetStates() {
  const t = useTranslate()

  return (
    <ul className="divide-y divide-border-subtle border-y border-border-subtle">
      {STATES.map((meter) => (
        <li key={meter.id} className="py-8">
          <BudgetMeter
            name={t(meter.name)}
            availableMinor={asMinor(meter.availableMinor)}
            spentMinor={asMinor(meter.spentMinor)}
            remainingMinor={asMinor(meter.remainingMinor)}
            ratio={meter.ratio}
            state={meter.state}
            thresholds={THRESHOLDS}
            currencyCode="PLN"
          />
        </li>
      ))}
    </ul>
  )
}
