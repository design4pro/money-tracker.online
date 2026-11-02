import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'
import { LEAKED_MESSAGE, wireFailure } from '#/lib/__tests__/wire-failure'

import { previewRule } from '../../-server/preview'
import { RulePreview } from '../rule-preview'

import type { Catalogue } from '#/lib/i18n'
import type { RuleDefinition } from '#/server/rules/schema'

/**
 * What the rule preview says when the preview itself fails.
 *
 * The preview re-runs as the rule is edited, so its failure is a block of the page, not the result
 * of a press: a labelled region that never takes focus, with the sentence of the failure's kind.
 */

vi.mock('../../-server/preview', () => ({ previewRule: vi.fn() }))

const RULE = {
  name: 'Coffee',
  matchMode: 'all',
  conditions: [],
  actions: [],
  runOn: ['manual_create'],
} as unknown as RuleDefinition

async function previewRefusedWith(error: unknown) {
  vi.mocked(previewRule).mockRejectedValue(error)
  render(
    <I18nProvider locale="en" messages={en as Catalogue}>
      <RulePreview rule={RULE} />
    </I18nProvider>,
  )
  return screen.findByRole('region')
}

describe('RulePreview, a failed preview', () => {
  beforeEach(() => {
    vi.mocked(previewRule).mockReset()
  })

  it('shows the catalogue copy and the sentence of the kind, in a region', async () => {
    const region = await previewRefusedWith(wireFailure('upstream'))

    expect(region.textContent).toContain(en['rules.preview.error.title'])
    expect(region.textContent).toContain(en['rules.preview.error.body'])
    expect(document.body.textContent).not.toContain(LEAKED_MESSAGE)
    expect(document.activeElement).toBe(document.body)
  })

  it('never prints the message of a plain error', async () => {
    const region = await previewRefusedWith(new Error(LEAKED_MESSAGE))

    expect(region.textContent).toContain(en['failure.internal'])
    expect(document.body.textContent).not.toContain(LEAKED_MESSAGE)
  })
})
