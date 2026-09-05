import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CandidateCard } from '../candidate-card'
import { candidateRow, renderRecurring } from './harness'

/**
 * A proposal. The card's job is to be dismissible without regret, so the assertions are about the
 * two claims it must never make: that the confidence is a measurement, and that anything has
 * already happened.
 */

describe('CandidateCard', () => {
  it('states the confidence as a word inside the badge, never as a number', () => {
    renderRecurring(
      <CandidateCard
        row={candidateRow({ confidence: 88 }, 'high')}
        onAccept={() => undefined}
        onDismiss={() => undefined}
      />,
    )

    expect(screen.getByText('Confidence: High')).toBeTruthy()
    // `0.88` is not an answer to "why did you suggest this", and the tone is the second channel.
    expect(screen.queryByText(/88/)).toBeNull()
  })

  it('says which signal held the proposal back, when this run knows', () => {
    renderRecurring(
      <CandidateCard
        row={candidateRow({}, 'medium')}
        weakestSignal="regularity"
        onAccept={() => undefined}
        onDismiss={() => undefined}
      />,
    )
    expect(screen.getByText(/how much the dates move about/)).toBeTruthy()
  })

  it('shows the band alone when the reason was not carried', () => {
    // `recurring_candidates` has no column for the weakest signal, so a proposal read back from
    // the database has a confidence and no reason. Inventing one would be worse than omitting it.
    renderRecurring(
      <CandidateCard
        row={candidateRow({}, 'low')}
        onAccept={() => undefined}
        onDismiss={() => undefined}
      />,
    )
    expect(screen.getByText('Confidence: Low')).toBeTruthy()
    expect(screen.queryByText(/Confidence is held back/)).toBeNull()
  })

  it('says plainly that nothing has been changed yet', () => {
    renderRecurring(
      <CandidateCard
        row={candidateRow()}
        onAccept={() => undefined}
        onDismiss={() => undefined}
      />,
    )
    expect(
      screen.getByText(/None of the entries it was found from is changed/),
    ).toBeTruthy()
  })

  it('counts its evidence, and survives a sample list it cannot parse', () => {
    const { unmount } = renderRecurring(
      <CandidateCard
        row={candidateRow()}
        onAccept={() => undefined}
        onDismiss={() => undefined}
      />,
    )
    expect(screen.getByText('From 3 entries')).toBeTruthy()
    unmount()

    renderRecurring(
      <CandidateCard
        row={candidateRow({ sampleTransactionIds: 'not json' })}
        onAccept={() => undefined}
        onDismiss={() => undefined}
      />,
    )
    // The count is the least important thing on the card; it must not take the list down with it.
    expect(screen.getByText('From 0 entries')).toBeTruthy()
  })

  it('names both actions by the series they act on', async () => {
    const onAccept = vi.fn()
    const onDismiss = vi.fn()
    renderRecurring(
      <CandidateCard
        row={candidateRow()}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Set up a series for Netflix' }),
    )
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Dismiss the suggestion for Netflix',
      }),
    )

    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('disables both actions while one of them is in flight', () => {
    renderRecurring(
      <CandidateCard
        row={candidateRow()}
        isBusy
        onAccept={() => undefined}
        onDismiss={() => undefined}
      />,
    )
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('disabled')).not.toBeNull()
    }
  })

  it('reads in Polish', () => {
    renderRecurring(
      <CandidateCard
        row={candidateRow()}
        onAccept={() => undefined}
        onDismiss={() => undefined}
      />,
      'pl',
    )
    expect(
      screen.getByRole('button', { name: 'Utwórz serię dla Netflix' }),
    ).toBeTruthy()
    expect(screen.getByText('Na podstawie 3 wydatków')).toBeTruthy()
  })
})
