import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Meter } from '../meter'

/**
 * The classes on the fill — the one child of the track, addressed through the role list rather
 * than through a colour, so a case that asserts a colour cannot select on the answer.
 */
const fillClass = (root: HTMLElement) =>
  root
    .querySelector('[role="meter progressbar"] > div > div')
    ?.getAttribute('class') ?? ''

/**
 * What a reader is told a `Meter` is, and how much of it is full.
 *
 * The first case is not a style assertion. `e2e/accessibility.spec.ts` corrects one axe-core
 * defect — `aria-allowed-attr` fails to resolve an ARIA *fallback role list* — and the correction
 * is scoped to the exact string React Aria emits. If a React Aria upgrade changes that string,
 * the correction silently stops matching and four `critical` findings come back with no
 * explanation attached; if it changes it to a *different* list, the correction would keep
 * matching a shape nobody has reasoned about. This test is the tripwire on that string, and it
 * fails in `pnpm test` — seconds — rather than in a browser suite minutes later.
 */
describe('Meter', () => {
  it('carries the ARIA fallback role list, with the value attributes that list needs', () => {
    render(
      <Meter
        label="1 692,11 zł of 10 000,00 zł used"
        value={0.17}
        minValue={0}
        maxValue={1}
        formatOptions={{ style: 'percent', maximumFractionDigits: 0 }}
      />,
    )

    const meter = screen.getByRole('meter')

    // `role="meter progressbar"`, exactly. ARIA 1.2 reads `role` as a list of tokens and takes
    // the first one the agent supports, so the second token is what an agent that has never
    // heard of `meter` falls back to — a value-bearing `progressbar` rather than a bare `<div>`.
    // The string is spelled out rather than matched loosely because the e2e correction compares
    // it character for character.
    expect(meter.getAttribute('role')).toBe('meter progressbar')

    // The four attributes ARIA allows on `meter` — and the four axe 4.13.0 wrongly reports as
    // disallowed once it has failed to resolve the list above.
    expect(meter.getAttribute('aria-valuenow')).toBe('0.17')
    expect(meter.getAttribute('aria-valuemin')).toBe('0')
    expect(meter.getAttribute('aria-valuemax')).toBe('1')
    expect(meter.getAttribute('aria-valuetext')).toBe('17%')
  })

  it('names itself with the whole sentence, not with the percentage alone', () => {
    render(
      <Meter
        label="1 692,11 zł of 10 000,00 zł used"
        value={0.17}
        minValue={0}
        maxValue={1}
        formatOptions={{ style: 'percent', maximumFractionDigits: 0 }}
      />,
    )

    // "17%" on its own tells a reader nothing about what is being measured or against what. The
    // label is the sentence, and the accessible name is computed from it.
    expect(
      screen.getByRole('meter', {
        name: '1 692,11 zł of 10 000,00 zł used',
      }),
    ).toBe(screen.getByRole('meter'))
  })

  it('takes the loud danger grade when its threshold guarantees a full fill', () => {
    // #180: one "over the limit" verdict was rendering in two reds — `bg-negative-bold` in
    // `BudgetMeter`, `bg-negative` here — because this primitive took the value that holds on
    // either adjacency. `dangerAt` decides the adjacency, so the primitive can read it: at `1`
    // the danger state needs `percentage >= 100`, which the width clamps to the whole track, so
    // nothing of the track survives as a boundary and the neighbour is the card. That is
    // `BudgetMeter`'s case exactly, and it is the case both callers that exist are in.
    const { container } = render(
      <Meter label="Used" value={1.3} minValue={0} maxValue={1} />,
    )

    expect(fillClass(container)).toContain('bg-negative-bold')
  })

  it('keeps the text grade when its threshold lets the fill stop on the track', () => {
    // The other half of the same decision. Below `1` the danger fill can be partial, and then its
    // boundary is `border-subtle`: `negative` measures 5.02:1 there and `negative-bold` 3.18:1.
    // Both clear 1.4.11's 3:1, and the thin one is not spent where it does not have to be.
    const { container } = render(
      <Meter
        label="Used"
        value={0.95}
        minValue={0}
        maxValue={1}
        dangerAt={0.9}
      />,
    )

    const painted = fillClass(container)
    expect(painted).toContain('bg-negative')
    expect(painted).not.toContain('bg-negative-bold')
  })

  it('leaves the danger icon on the text grade in both cases', () => {
    // The fill is a graphical object at 3:1; a 14px glyph is not the large text 4.5:1 is scored
    // on. `DESIGN.md` scopes `negative-bold` to an over-budget headline and a full-track fill,
    // and the icon is neither, so it stays on the 7:1 ink whichever grade the bar takes.
    const iconClass = (root: HTMLElement) =>
      root.querySelector('svg')?.getAttribute('class') ?? ''

    const full = render(
      <Meter label="Used" value={1.3} minValue={0} maxValue={1} />,
    )
    expect(iconClass(full.container)).toContain('text-negative')
    expect(iconClass(full.container)).not.toContain('text-negative-bold')
    full.unmount()

    const partial = render(
      <Meter
        label="Used"
        value={0.95}
        minValue={0}
        maxValue={1}
        dangerAt={0.9}
      />,
    )
    expect(iconClass(partial.container)).toContain('text-negative')
    expect(iconClass(partial.container)).not.toContain('text-negative-bold')
  })

  it('does not lean on colour: each threshold carries its own icon', () => {
    const { container, rerender } = render(
      <Meter label="Used" value={0.5} minValue={0} maxValue={1} />,
    )
    const iconClasses = () =>
      [...container.querySelectorAll('svg')]
        .map((icon) => icon.getAttribute('class') ?? '')
        .join(' ')

    // Three distinct icons, one per state — the check, the warning triangle and the rising
    // arrow — so the amber and the negative are reinforcement for people who can see them and
    // never the channel the meaning travels on. `lucide-react` stamps its own name onto the
    // element's class, which is what makes the three tellable apart here.
    expect(iconClasses()).toContain('lucide-check')

    rerender(<Meter label="Used" value={0.85} minValue={0} maxValue={1} />)
    expect(iconClasses()).toContain('lucide-triangle-alert')

    rerender(<Meter label="Used" value={1.3} minValue={0} maxValue={1} />)
    expect(iconClasses()).toContain('lucide-trending-up')
  })
})
