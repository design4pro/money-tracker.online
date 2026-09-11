import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { asMinor } from '#/lib/money'

import { BudgetMeter } from '../budget-meter'
import { renderBudget } from './harness'

import type { BudgetMeterProps } from '../budget-meter'

/**
 * The one component on this surface where being wrong costs somebody money.
 *
 * The assertions are the design bar written down: *how much is left* has to be the headline, and
 * an overspend has to be unmistakable to a reader who cannot see the colour it is drawn in.
 */

function meter(over: Partial<BudgetMeterProps> = {}) {
  renderBudget(
    <BudgetMeter
      name="Groceries"
      availableMinor={asMinor(2_000_00)}
      spentMinor={asMinor(1_200_00)}
      remainingMinor={asMinor(800_00)}
      ratio={0.6}
      state="under"
      thresholds={[50, 80, 100]}
      currencyCode="PLN"
      {...over}
    />,
  )
  return screen.getByRole('meter')
}

describe('BudgetMeter', () => {
  it('leads with the remainder, not with what was spent', () => {
    meter()
    // "800.00 zł left" — the figure somebody standing in a shop needs, at the largest step.
    expect(screen.getByText(/800[.,]00.*left/i)).toBeTruthy()
    // The spend is present, but as a caption rather than the headline.
    expect(screen.getByText(/1,200\.00.*of.*2,000\.00/i)).toBeTruthy()
  })

  it('names what it measures, because five unnamed meters announce identically', () => {
    meter()
    // `role="meter"` with no accessible name is an `aria-meter-name` failure (WCAG 4.1.2), and a
    // list of budgets is precisely where that costs a reader the ability to tell them apart.
    expect(
      screen.getByRole('meter', { name: 'Budget used: Groceries' }),
    ).toBeTruthy()
  })

  it('states both amounts and the percentage in its accessible value', () => {
    const track = meter()
    const valueText = track.getAttribute('aria-valuetext') ?? ''
    expect(valueText).toContain('1,200.00')
    expect(valueText).toContain('2,000.00')
    expect(valueText).toContain('60%')
    expect(track.getAttribute('aria-valuenow')).toBe('60')
    expect(track.getAttribute('aria-valuemin')).toBe('0')
    expect(track.getAttribute('aria-valuemax')).toBe('100')
  })

  it('signals an overspend in words and in an icon as well as in a colour', () => {
    const track = meter({
      spentMinor: asMinor(2_320_00),
      remainingMinor: asMinor(-320_00),
      ratio: 1.16,
      state: 'over',
    })

    // 1. the word.
    expect(screen.getByText('Over budget')).toBeTruthy()
    // 2. the figure flips to an over-by, so the sign is not the only cue.
    expect(screen.getByText(/320[.,]00.*over/i)).toBeTruthy()
    // 3. the accessible value leads with the verdict rather than the number.
    expect(track.getAttribute('aria-valuetext')).toMatch(/^Over budget/)
    // 4. an icon rides with the word — decorative to a screen reader, a second channel to an eye.
    expect(track.parentElement?.querySelector('svg')).toBeTruthy()
  })

  it('draws the overspend in the loud danger grade and the caption in the text one', () => {
    // #151: `negative` has to hold 7:1 because it is a caption ink, and in dark that pins it to a
    // pale salmon — so a 32px figure and a bar painted in it read as washed out. The two elements
    // WCAG does not hold to 7:1 — large text at 4.5:1, a fill at 3:1 — take `negative-bold`.
    const track = meter({
      spentMinor: asMinor(2_320_00),
      remainingMinor: asMinor(-320_00),
      ratio: 1.16,
      state: 'over',
    })

    const headline = screen.getByText(/320[.,]00.*over/i)
    expect(headline.className).toContain('text-negative-bold')

    const fill = track.firstElementChild as HTMLElement
    expect(fill.className).toContain('bg-negative-bold')

    // …and the other half of the ticket: nothing body-size moved off the 7:1 token. The verdict
    // rides at `text-caption`, so it stays where it was.
    expect(screen.getByText('Over budget').className).toContain('text-negative')
    expect(screen.getByText('Over budget').className).not.toContain(
      'text-negative-bold',
    )
  })

  it('draws the near-the-limit bar in the loud caution grade and the caption in the text one', () => {
    // #171: the same shape one grade over. `warning` holds 7:1 because it is a caption ink, and in
    // dark that leaves the bar a pale gold rather than a caution tone. A fill is a graphical object
    // at 3:1, so it takes `warning-bold` — and unlike the danger pair this grade paints NO text at
    // all, which is why the headline below stays on `text-ink` rather than following the bar.
    const track = meter({
      spentMinor: asMinor(1_800_00),
      remainingMinor: asMinor(200_00),
      ratio: 0.9,
      state: 'approaching',
    })

    const fill = track.firstElementChild as HTMLElement
    expect(fill.className).toContain('bg-warning-bold')

    // The verdict rides at `text-caption`, so it stays on the 7:1 ink.
    const verdict = screen.getByText('Close to the limit')
    expect(verdict.className).toContain('text-warning')
    expect(verdict.className).not.toContain('text-warning-bold')

    // And the headline is the remainder, not a verdict, so it never reaches for a caution tone.
    const headline = screen.getByText(/200[.,]00/)
    expect(headline.className).toContain('text-ink')
    expect(headline.className).not.toContain('text-warning')
  })

  it('declares the weight the large-text grade is allowed by', () => {
    // The premise under the assertion above, checked rather than asserted in prose. 4.5:1 is only
    // legal on this figure because WCAG counts it as LARGE text, and at `md`'s 20px that needs the
    // BOLD threshold (14pt bold), not the regular one (18pt) — so 700, and 600 will not do.
    //
    // Courier Prime ships 400 and 700 only, so `font-semibold` painted as 700 anyway and no frame
    // would ever show this moving. The declared weight is what the criterion is read against and
    // what `docs/ACCESSIBILITY.md` states in public, which is why it is worth a test at all.
    meter({
      spentMinor: asMinor(2_320_00),
      remainingMinor: asMinor(-320_00),
      ratio: 1.16,
      state: 'over',
    })

    const headline = screen.getByText(/320[.,]00.*over/i)
    expect(headline.className).toContain('font-bold')
    expect(headline.className).not.toContain('font-semibold')
  })

  it('stops the fill at the end of the track while the sentence keeps counting', () => {
    const track = meter({
      spentMinor: asMinor(2_320_00),
      remainingMinor: asMinor(-320_00),
      ratio: 1.16,
      state: 'over',
    })
    const fill = track.firstElementChild as HTMLElement

    // The fill is the full track slid back by what is left; at the end of the track that is nothing.
    expect(fill.style.getPropertyValue('--meter-fill')).toBe('0%')
    expect(track.getAttribute('aria-valuenow')).toBe('100')
    // A bar that overflows its own track says nothing a full bar does not; the percentage does.
    expect(screen.getByText('116%')).toBeTruthy()
  })

  it('says it cannot tell rather than drawing 0% when nothing was available', () => {
    meter({
      availableMinor: asMinor(0),
      spentMinor: asMinor(0),
      remainingMinor: asMinor(0),
      ratio: null,
      state: 'under',
    })
    expect(screen.getAllByText('Utilisation unavailable').length).toBe(1)
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('states every mark on the track in words, because a notch alone reads as nothing', () => {
    const track = meter()
    const marks =
      track.parentElement?.querySelector('.sr-only')?.textContent ?? ''

    expect(marks).toContain('Alert at 50%')
    expect(marks).toContain('Alert at 80%')
    // The tick at the line names the amount it stands for, not just the percentage.
    expect(marks).toMatch(/100% of .*2,000\.00/)
    // 100 is in the ladder and is drawn as the end tick, never as a notch inside the track.
    expect(marks).not.toContain('Alert at 100%')
  })

  it('formats money and percentages in the reader’s locale', () => {
    renderBudget(
      <BudgetMeter
        name="Groceries"
        availableMinor={asMinor(2_000_00)}
        spentMinor={asMinor(1_200_00)}
        remainingMinor={asMinor(800_00)}
        ratio={0.6}
        state="under"
        thresholds={[80]}
        currencyCode="PLN"
      />,
      'pl',
    )
    // "Pozostało 800,00 zł" — the financial term, with the space-grouped Polish thousands.
    expect(screen.getByText(/Pozostało .*800,00/)).toBeTruthy()
    expect(screen.getByText('60%')).toBeTruthy()
  })
})
