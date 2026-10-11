import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { I18nProvider, useTranslate } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { blankAction } from '../../-lib/draft'
import { ActionRow } from '../action-row'

import type { Catalogue } from '#/lib/i18n'
import type { ActionDraft } from '../../-lib/draft'

/**
 * What the `then` row says about "mark as planned", in words.
 *
 * Un-planning settles a row, and the booking rule never settles one dated after the latest
 * calendar day on Earth (`#/server/booking-rule`), so a rule's "not planned" waits for a
 * future-dated entry's date. The row says so only where it matters - the switch turned off - and
 * as text, never as colour.
 */

const HINT = en['rules.action.value.planned.waitsForDate']

/** The row takes its translator as a prop, so the harness reads it from the provider. */
function Row({ value }: { readonly value: ActionDraft }) {
  const t = useTranslate()
  return (
    <ActionRow
      position={1}
      count={1}
      value={value}
      reference={{ categories: [], payees: [], tags: [] }}
      t={t}
      isDisabled={false}
      onChange={() => undefined}
      onRemove={() => undefined}
      onMove={() => undefined}
    />
  )
}

function renderRow(value: ActionDraft) {
  return render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <Row value={value} />
    </I18nProvider>,
  )
}

describe('ActionRow, mark as planned', () => {
  it('says an un-plan waits for a future-dated entry’s date when the switch is off', () => {
    renderRow({ ...blankAction('mark_planned'), flag: false })

    expect(screen.getByText(HINT)).toBeTruthy()
  })

  it('says nothing about it when the rule plans the entry', () => {
    renderRow({ ...blankAction('mark_planned'), flag: true })

    expect(screen.queryByText(HINT)).toBeNull()
  })

  it('says nothing about it on the other switch', () => {
    renderRow({ ...blankAction('set_excluded'), flag: false })

    expect(screen.queryByText(HINT)).toBeNull()
  })
})
