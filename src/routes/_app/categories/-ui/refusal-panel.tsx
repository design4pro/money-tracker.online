import { useEffect, useRef } from 'react'

import { ErrorPanel } from '#/components/app/shell'
import { useTranslate } from '#/lib/i18n'

import type { MessageKey } from '#/lib/i18n'
import type { Refusal, RefusalCall } from '../-lib/refusal'

/**
 * The sentence a refused write on `/categories` is shown as.
 *
 * ## The wording is the catalogue's, never the server's
 *
 * A repository refusal is English, written for a developer, and (since the failure middleware)
 * not even delivered. The body is a catalogue sentence chosen by the kind of refusal, and the
 * depth sentence is built from the two category names the route already holds: the names are
 * quoted and preceded by a noun because a Polish name cannot be declined inside a sentence. There
 * is no `detail`, so no disclosure and no server text.
 *
 * ## One live region, so this is a labelled region
 *
 * The route's `role="alert"` wrapper is the live region; a panel that was an alert as well would be
 * a second, nested one. The route keys this component by a counter that increments on every
 * refusal, so an identical repeat mounts a new node and is meant to be announced again (an intent,
 * not a verified screen-reader behaviour: `docs/ACCESSIBILITY.md` §5.4).
 *
 * ## It scrolls, and never takes focus
 *
 * A refusal after a drag on a long tree can land above the viewport, so the panel brings itself
 * into view with the smallest scroll. It does not use `focusHeading`: that would pull a keyboard
 * dragger off the row they were working on.
 */

/** The title follows the write that failed; a reorder is a move that kept its parent. */
const TITLE_KEYS = {
  move: 'categories.move.refused',
  reorder: 'categories.move.refused',
  restore: 'categories.restore.refused',
} as const satisfies Readonly<Record<RefusalCall, MessageKey>>

export function RefusalPanel({ refusal }: { refusal: Refusal }) {
  const t = useTranslate()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  return (
    <div ref={ref}>
      <ErrorPanel
        mode="region"
        headingLevel={2}
        title={t(TITLE_KEYS[refusal.call])}
        body={bodyOf(t, refusal)}
      />
    </div>
  )
}

function bodyOf(t: ReturnType<typeof useTranslate>, refusal: Refusal): string {
  switch (refusal.kind) {
    case 'nest':
      return t('categories.move.refused.nest', {
        category: refusal.category,
        parent: refusal.parent,
      })
    case 'forbidden':
      return t('categories.refused.forbidden')
    case 'generic':
      return t('empty.error.body')
  }
}
