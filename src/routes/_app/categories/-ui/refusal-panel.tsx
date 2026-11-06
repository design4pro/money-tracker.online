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
 * ## A labelled region, never a nested alert
 *
 * The panel is `mode="region"` and the route does not wrap it in `role="alert"`: that pairing was
 * a nested alert and region, and a wrapper that stayed mounted did not announce an identical
 * repeat. The route keys this component by a counter that increments on every refusal, so a
 * repeat mounts a new node. It does not steal focus from a keyboard dragger.
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
  seed: 'categories.seed.failed',
} as const satisfies Readonly<Record<RefusalCall, MessageKey>>

export function RefusalPanel({ refusal }: { refusal: Refusal }) {
  const t = useTranslate()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // `start`, not `nearest`: a panel that already peeks into the viewport under the sticky
    // header is "nearest" to staying there. `scroll-mt-16` matches `<html>`'s `scroll-pt-16`
    // so the heading comes to rest below the 64px bar (WCAG 2.2 §2.4.11).
    ref.current?.scrollIntoView({ block: 'start' })
  }, [])

  return (
    <div ref={ref} className="scroll-mt-16">
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
