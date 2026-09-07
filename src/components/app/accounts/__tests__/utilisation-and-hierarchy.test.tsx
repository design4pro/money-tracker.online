import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { asCurrencyCode, asMinor } from '#/lib/money'

import { CreditUtilisation } from '../credit-utilisation'
import { AccountOverviewCard } from '../overview-card'

import type { ReactNode } from 'react'
import type { Catalogue } from '#/lib/i18n'
import type { AccountOverview } from '#/server/repos/accounts'

/**
 * The two compositions a visual review took apart, pinned so they cannot drift back.
 *
 * Neither of these is a taste assertion. The utilisation block printed the same fact in three
 * registers and spent the palette's only positive colour on carried debt; the overview card's
 * hero was a step and a half away from a sibling figure that had more digits than it. Both are
 * checkable: *how many times a number appears*, *which token paints the fill*, and *how many type
 * steps separate the headline from the figure beside it*.
 */

/** Narrows a query result, so a missing node fails as itself rather than as a type assertion. */
function must<T>(node: T | null | undefined): T {
  if (node === null || node === undefined) {
    throw new Error('expected the node to be in the document')
  }
  return node
}

function withI18n(node: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      {node}
    </I18nProvider>,
  )
}

/** A 10 000,00 limit with 1 692,11 drawn — 17%, the figure the screenshots argued about. */
const WITHIN = {
  balanceMinor: asMinor(-169_211),
  limitMinor: asMinor(1_000_000),
}

describe('the credit utilisation block', () => {
  it('states the percentage once, in the caption beside the fill it labels', () => {
    const { container } = withI18n(
      <CreditUtilisation {...WITHIN} currencyCode="PLN" />,
    )

    // It used to be twice: once inside the sentence and once flush right, a row-width away from
    // the mark that encodes it. `aria-valuetext` still carries it for a screen reader, and an
    // attribute is not text content.
    const printed = container.textContent.match(/17%/gu) ?? []
    expect(printed).toHaveLength(1)
  })

  it('puts every fact on one line, above the track', () => {
    const { container } = withI18n(
      <CreditUtilisation {...WITHIN} currencyCode="PLN" />,
    )

    const caption = container.querySelector('p.text-caption')
    expect(caption).not.toBeNull()
    const line = caption?.textContent ?? ''
    expect(line).toContain('of')
    expect(line).toContain('17% used')
    expect(line).toContain('still available')

    // The caption precedes the track in document order, so the number and the mark that draws it
    // are adjacent rather than at opposite ends of the row.
    const track = must(
      container.querySelector('[role="meter progressbar"] > div'),
    )
    expect(must(caption).compareDocumentPosition(track)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('names the meter with the whole sentence, verdict first once there is one', () => {
    const resting = withI18n(
      <CreditUtilisation {...WITHIN} currencyCode="PLN" />,
    )
    // The shape `e2e/accessibility.spec.ts` matches on. A meter announced as "17%" alone tells a
    // reader nothing about what is measured, or against what.
    expect(resting.getByRole('meter').getAttribute('aria-label')).toMatch(
      / of .* used, 17%$/u,
    )
    resting.unmount()

    const approaching = withI18n(
      <CreditUtilisation
        balanceMinor={asMinor(-900_000)}
        limitMinor={asMinor(1_000_000)}
        currencyCode="PLN"
      />,
    )
    // The verdict leads, and the sentence keeps its shape behind it.
    expect(approaching.getByRole('meter').getAttribute('aria-label')).toMatch(
      /^Approaching limit · .* used, 90%$/u,
    )
  })

  it('does not paint carried debt with the positive token', () => {
    const { container } = withI18n(
      <CreditUtilisation {...WITHIN} currencyCode="PLN" />,
    )

    const fill = container.querySelector(
      '[role="meter progressbar"] > div > div',
    )
    const painted = fill?.getAttribute('class') ?? ''
    // Green rewards the reader for owing money, and it spends the one positive hue the palette
    // has on a neutral quantity — leaving nothing to escalate a dangerous level with.
    expect(painted).not.toContain('bg-positive')
    expect(painted).toContain('bg-ink/70')
  })

  it('changes a word and a glyph wherever it changes the fill colour', () => {
    const iconNames = (root: HTMLElement) =>
      [...root.querySelectorAll('svg')]
        .map((icon) => icon.getAttribute('class') ?? '')
        .join(' ')

    // Resting: figures only. A tick beside every ordinary card is a congratulation nobody asked
    // for, and nothing about the fill has escalated yet.
    const within80 = withI18n(
      <CreditUtilisation {...WITHIN} currencyCode="PLN" />,
    )
    expect(iconNames(within80.container)).toBe('')
    expect(within80.queryByText(/limit/iu)).toBeNull()
    within80.unmount()

    // Amber: a triangle and the word arrive together, so the escalation survives greyscale,
    // forced colours and deuteranopia — WCAG 2.2 §1.4.1.
    const approaching = withI18n(
      <CreditUtilisation
        balanceMinor={asMinor(-900_000)}
        limitMinor={asMinor(1_000_000)}
        currencyCode="PLN"
      />,
    )
    expect(iconNames(approaching.container)).toContain('lucide-triangle-alert')
    expect(approaching.getByText(/Approaching limit/u)).toBeTruthy()
    expect(
      approaching.container
        .querySelector('[role="meter progressbar"] > div > div')
        ?.getAttribute('class'),
    ).toContain('bg-warning')
    approaching.unmount()

    const over = withI18n(
      <CreditUtilisation
        balanceMinor={asMinor(-1_300_000)}
        limitMinor={asMinor(1_000_000)}
        currencyCode="PLN"
      />,
    )
    expect(iconNames(over.container)).toContain('lucide-trending-up')
    expect(over.getByText(/Over limit/u)).toBeTruthy()
    expect(
      over.container
        .querySelector('[role="meter progressbar"] > div > div')
        ?.getAttribute('class'),
    ).toContain('bg-negative')
  })
})

const OVERVIEW: AccountOverview = {
  baseCurrencyCode: asCurrencyCode('PLN'),
  totalBalanceMinor: asMinor(11_792_788),
  liabilitiesMinor: asMinor(-169_211),
  netWorthMinor: asMinor(11_623_577),
  countedAccounts: 6,
  totalAccounts: 7,
}

describe('the accounts overview card', () => {
  it('writes net worth as the head line of the same list as held and owed', () => {
    withI18n(<AccountOverviewCard overview={OVERVIEW} headingId="overview" />)

    // Three typed lines, label at the start and figure at the end: never an eyebrow over a hero
    // figure with the pair on the floor.
    expect(screen.getAllByRole('term').map((node) => node.textContent)).toEqual(
      ['Net worth', 'What you hold', 'What you owe'],
    )
    const [total, held, owed] = screen
      .getAllByRole('definition')
      .map((node) => node.querySelector('span')?.getAttribute('class') ?? '')
    // One type step, not two: the total leads by position and size, and no figure is set at
    // the display step.
    expect(total).toContain('text-subtitle')
    expect(held).toContain('text-body')
    expect(owed).toContain('text-body')
    expect(total).not.toContain('text-display')
  })

  it('puts each line on a rule rather than in a tile', () => {
    const { container } = withI18n(
      <AccountOverviewCard overview={OVERVIEW} headingId="overview" />,
    )

    const rows = [...(container.querySelector('dl')?.children ?? [])]
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      const classes = row.getAttribute('class') ?? ''
      expect(classes).toContain('border-t')
      expect(classes).not.toContain('bg-surface-sunken')
    }
    // The section's heading is the first line's own words, hidden rather than repeated above it.
    expect(
      screen.getByRole('heading', { name: 'Net worth' }).getAttribute('class'),
    ).toContain('sr-only')
  })

  it('moves the footnote behind a named control instead of two lines of copy', () => {
    withI18n(<AccountOverviewCard overview={OVERVIEW} headingId="overview" />)

    const trigger = screen.getByRole('button', {
      name: 'What these figures include',
    })
    // A real control, not a hover-only tooltip: on a touch device there is no hover, and this
    // sentence is exactly the one a phone reader most needs to be able to reach.
    expect(trigger).toBeTruthy()
    expect(
      screen.queryByText(/Archived accounts, and accounts left out/u),
    ).toBeNull()
  })
})
