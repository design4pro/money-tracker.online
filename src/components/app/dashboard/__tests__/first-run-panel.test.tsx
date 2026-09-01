import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import en from '#/lib/i18n/messages/en'

import { FIRST_RUN_STEPS, FirstRunPanel } from '../first-run-panel'
import { renderLinked } from './harness'

/**
 * The panel is driven by a constant, so these assertions are about the constant as much as about
 * the markup: a step added later must appear without this file changing, and a step whose route
 * has not shipped must render **no** control at all.
 */
describe('FirstRunPanel', () => {
  it('renders exactly the steps in the constant, in order', async () => {
    await renderLinked(<FirstRunPanel />)

    const steps = within(
      screen.getByRole('list', { name: 'Getting started' }),
    ).getAllByRole('listitem')

    expect(steps).toHaveLength(FIRST_RUN_STEPS.length)
    steps.forEach((step, index) => {
      expect(step.textContent).toContain(en[FIRST_RUN_STEPS[index].titleKey])
    })
  })

  it('gives a step with a destination a real link and a step without one no control', async () => {
    await renderLinked(<FirstRunPanel />)

    const steps = within(
      screen.getByRole('list', { name: 'Getting started' }),
    ).getAllByRole('listitem')

    for (const [index, step] of FIRST_RUN_STEPS.entries()) {
      const links = within(steps[index]).queryAllByRole('link')
      if (step.to === undefined) {
        // Not a disabled button and not a dead link: nothing. A control that goes nowhere is
        // worse than no control, and the step still reads as a step.
        expect(links).toHaveLength(0)
      } else {
        expect(links).toHaveLength(1)
        expect(links[0].getAttribute('href')).toBe(step.to)
      }
    }
  })

  it('numbers the steps, because the order is the content', async () => {
    await renderLinked(<FirstRunPanel />)

    const steps = within(
      screen.getByRole('list', { name: 'Getting started' }),
    ).getAllByRole('listitem')
    expect(steps[0].textContent).toMatch(/^1/)
  })

  it('says nothing here is sample data', async () => {
    await renderLinked(<FirstRunPanel />)
    expect(
      screen.getByText(
        'Nothing here is filled with sample figures. Everything you see will be yours.',
      ),
    ).toBeTruthy()
  })
})
