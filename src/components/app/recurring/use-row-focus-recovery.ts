import { useCallback, useEffect, useRef } from 'react'

import type { RefObject } from 'react'

/**
 * Keeps keyboard focus on the list when the row that held it changes or leaves (WCAG 2.4.3).
 *
 * Skipping a period, saving the mark-paid dialog and undoing a period all end the same way for a
 * keyboard user: the button they pressed is replaced or gone, and the browser drops focus on
 * `<body>`, which is the start of the page. This puts it back where the reader's attention was.
 *
 * ## What it remembers, and when
 *
 * The row acted on, by key and by position, and the list the person was looking at. A row is
 * remembered when a press is reported through {@link RowFocusRecovery.remember} (Skip, Undo) and
 * while `openKey` names a row (the mark-paid dialog is open on it, however it got there - a button
 * or the `?markPaid=` address).
 *
 * ## When it moves focus
 *
 * Only once the dialog is closed and only while focus is **lost**, meaning on `<body>`: a dialog
 * that was cancelled restores focus to its trigger by itself and is left alone, and so is a person
 * who has already moved on. The move waits a frame, so the dialog's own restore-to-trigger cannot
 * overwrite it. It runs again when the list is replaced, because a save closes the dialog first
 * and the refreshed list arrives later.
 *
 * ## Where it lands
 *
 * The first button of the remembered row if that row is still listed (the replacement button, on
 * a surface whose rows stay); otherwise the first button of the row now at its position, or of the
 * new last row; otherwise `fallbackRef` (the surface's heading), when nothing is left or the row
 * was never listed.
 *
 * The rows are the `data-row-key` elements inside `rootRef`, read from the DOM because the
 * buttons belong to `PeriodActions`, not to the surface.
 */

export const ROW_KEY_ATTRIBUTE = 'data-row-key'

interface Remembered<T> {
  readonly key: string
  readonly index: number
  /** The list the row was in, to tell a refresh from the dialog merely closing. */
  readonly rows: ReadonlyArray<T>
}

export interface RowFocusRecovery {
  /** Report a press that will change or remove the row, before the write starts. */
  readonly remember: (key: string) => void
}

export interface RowFocusRecoveryOptions<T> {
  readonly rows: ReadonlyArray<T>
  readonly rowKey: (row: T) => string
  /** The row a dialog is open on, or `null` when none is. */
  readonly openKey: string | null
  readonly rootRef: RefObject<HTMLElement | null>
  /** Receives focus when no row is left. Needs `tabIndex={-1}`. */
  readonly fallbackRef?: RefObject<HTMLElement | null>
}

function isFocusLost(): boolean {
  const active = document.activeElement
  return active === null || active === document.body
}

export function useRowFocusRecovery<T>({
  rows,
  rowKey,
  openKey,
  rootRef,
  fallbackRef,
}: RowFocusRecoveryOptions<T>): RowFocusRecovery {
  const remembered = useRef<Remembered<T> | null>(null)
  const latest = useRef({ rows, rowKey })

  useEffect(() => {
    latest.current = { rows, rowKey }
  })

  const remember = useCallback((key: string) => {
    const { rows: current, rowKey: keyOf } = latest.current
    remembered.current = {
      key,
      index: current.findIndex((row) => keyOf(row) === key),
      rows: current,
    }
  }, [])

  useEffect(() => {
    if (openKey !== null) {
      remember(openKey)
      return
    }
    if (remembered.current === null) return

    let forgetOnPress: (() => void) | null = null
    const frame = requestAnimationFrame(() => {
      const target = remembered.current
      if (target === null) return

      if (!isFocusLost()) {
        // Focus is somewhere sensible. Forget the row once the list has moved on; until then a
        // refresh may still be on its way. A press anywhere in the meantime means the person has
        // moved on too (a cancelled dialog, a failed Skip), so a later refresh must not pull
        // focus back to a row they left.
        if (target.rows !== rows) {
          remembered.current = null
          return
        }
        forgetOnPress = () => {
          remembered.current = null
        }
        document.addEventListener('pointerdown', forgetOnPress, {
          capture: true,
          once: true,
        })
        return
      }

      const listed = Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>(
          `[${ROW_KEY_ATTRIBUTE}]`,
        ) ?? [],
      )
      // A row that was never listed (a reopened period that has since gone) has no position to
      // take over, so it falls through to the fallback rather than to the first row.
      const row =
        listed.find(
          (node) => node.getAttribute(ROW_KEY_ATTRIBUTE) === target.key,
        ) ??
        (target.index < 0
          ? undefined
          : listed.at(Math.min(target.index, listed.length - 1)))
      const next =
        row?.querySelector<HTMLElement>('button') ?? fallbackRef?.current

      if (next !== null && next !== undefined) {
        next.focus()
        remembered.current = null
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      if (forgetOnPress !== null) {
        document.removeEventListener('pointerdown', forgetOnPress, {
          capture: true,
        })
      }
    }
  }, [rows, openKey, remember, rootRef, fallbackRef])

  return { remember }
}
