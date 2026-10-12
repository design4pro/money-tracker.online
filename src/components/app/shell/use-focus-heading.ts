import { useLayoutEffect } from 'react'

import { MAIN_CONTENT_ID } from './main-content'

import type { RefObject } from 'react'

/**
 * Takes keyboard focus into a failure panel when it appears, and hands it back when it goes.
 *
 * A failure that appears after an action is announced, but announcing is not moving: after a
 * failed save the reader's focus is still on a control that may have just been disabled. Focusing
 * the heading puts a keyboard reader on the explanation, with the way out as the next tab stop.
 * The heading is `tabIndex={-1}`, so it is a programmatic target and never a tab stop of its own.
 *
 * ## Giving focus back
 *
 * A panel that held focus and then unmounts - a successful Retry, say - would drop focus to
 * `<body>`, which is the top of the document for a keyboard reader. So the cleanup records, while
 * the node is still attached, whether focus was inside it and which dialog (if any) encloses it;
 * once the commit has landed it focuses that dialog, else `#MAIN_CONTENT_ID`. It does that only
 * when focus really fell to `<body>`: a control that took focus in the meantime keeps it.
 *
 * The record has to be made in a *layout* effect cleanup. By the time a passive effect's cleanup
 * runs the node is detached and `document.activeElement` is already `body`.
 *
 * ## Restoring without moving
 *
 * `moveOnMount: false` keeps the hand-back and skips the move. `RouteError` uses it for a page
 * that was server-rendered: the browser has already placed focus on the document and the skip
 * link must stay the first tab stop, but if the reader later retries into focus on the error
 * panel, giving focus back is still right.
 *
 * `enabled` and `moveOnMount` are not expected to change while a panel is mounted: the callers
 * pass a fixed value per panel.
 */
export function useFocusHeading(
  enabled: boolean,
  panelRef: RefObject<HTMLElement | null>,
  headingRef: RefObject<HTMLElement | null>,
  moveOnMount = true,
) {
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!enabled || !panel) return

    if (moveOnMount) headingRef.current?.focus()

    return () => {
      if (!panel.contains(document.activeElement)) return
      const dialog = panel.closest('[role="dialog"],[role="alertdialog"]')

      queueMicrotask(() => {
        if (document.activeElement !== document.body) return
        const target = dialog?.isConnected
          ? dialog
          : document.getElementById(MAIN_CONTENT_ID)
        if (target instanceof HTMLElement) target.focus()
      })
    }
  }, [enabled, moveOnMount, panelRef, headingRef])
}
