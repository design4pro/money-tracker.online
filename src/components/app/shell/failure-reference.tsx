import { useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

import { Button } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'

/**
 * The shape of an event id or a request id: letters, digits, `_` and `-`, 8 to 64 of them.
 *
 * A reference is the only free-form string a failure panel is given, and a person will read it to
 * a support agent, so what gets through is narrowed on the rendering side. A sentence, a
 * thousands separator, a currency sign or 65 characters is dropped, and with it the Copy button.
 *
 * **The rule narrows the string; it does not prove it is not an amount.** A digits-only string of
 * 8 to 64 characters passes. What keeps an amount out is the producer passing only an event or
 * request id, never a value of its own.
 */
const OPAQUE_ID = /^[A-Za-z0-9_-]{8,64}$/

/** Whether `FailureReference` would render this string, so a caller can skip an empty slot. */
export function hasOpaqueIdShape(reference: string | undefined) {
  return reference !== undefined && OPAQUE_ID.test(reference)
}

const subscribeNever = () => () => {}
const canWriteToClipboard = () =>
  typeof navigator !== 'undefined' &&
  typeof navigator.clipboard?.writeText === 'function'
/** The server cannot know, so the first paint never has the button. */
const noClipboardOnServer = () => false

export interface FailureReferenceProps {
  /** An event id or a request id. **Never a message, a stack or a value.** */
  reference?: string
  /** For the caller's alignment: the line is left-aligned unless told otherwise. */
  className?: string
}

/**
 * "Reference: evt_7f3a91c2" and a button that copies exactly the id.
 *
 * ## Why the button is detected after mount
 *
 * A failure page can render on the server, and `navigator.clipboard` exists only in the browser.
 * A button decided during the first render would be a hydration mismatch
 * (`docs/ACCESSIBILITY.md` §5.1), so support is read through `useSyncExternalStore` with a server
 * snapshot of `false`: the markup that hydrates is the markup the server sent, and the button
 * appears on the pass after.
 *
 * ## Announcing the result
 *
 * The status region is rendered empty from the first paint and filled afterwards: a live region
 * that appears in the same commit as its text is not announced (`RouteAnnouncer` says the same).
 * The text is visible beside the button as well, so it is not a sound alone. A second press writes
 * the same text, so the region is cleared first and refilled once the write settles, otherwise the
 * repeat would change nothing and say nothing.
 */
export function FailureReference({
  reference,
  className,
}: FailureReferenceProps) {
  const t = useTranslate()
  const canCopy = useSyncExternalStore(
    subscribeNever,
    canWriteToClipboard,
    noClipboardOnServer,
  )
  const [status, setStatus] = useState('')

  if (!reference || !hasOpaqueIdShape(reference)) return null

  async function copy(value: string) {
    // Committed before the write starts, so the refill below is a change and not a no-op.
    flushSync(() => setStatus(''))
    try {
      await navigator.clipboard.writeText(value)
      setStatus(t('failure.reference.copied'))
    } catch {
      setStatus(t('failure.reference.copyFailed'))
    }
  }

  return (
    // `basis-full`: in a panel's wrapping action row the reference takes a line of its own.
    <div
      className={cn(
        'flex basis-full flex-wrap items-center gap-x-3 gap-y-1',
        className,
      )}
    >
      <p className="break-all text-caption text-ink-2 tabular">
        {t('empty.error.reference', { reference })}
      </p>
      {canCopy ? (
        <Button
          variant="secondary"
          size="sm"
          onPress={() => void copy(reference)}
        >
          {t('failure.reference.copy')}
        </Button>
      ) : null}
      <span
        role="status"
        aria-live="polite"
        className="text-caption text-ink-2"
      >
        {status}
      </span>
    </div>
  )
}
