import { cn } from '#/lib/cn'

export interface SpinnerProps {
  className?: string
  /**
   * Text announced while the spinner is on screen. Pass `null` when an ancestor
   * already owns the announcement — a pending `Button` does, via `aria-live` on
   * its own label — so a screen reader does not hear the same thing twice.
   */
  label?: string | null
}

/**
 * A one-element indeterminate indicator.
 *
 * `aria-hidden` on the drawing and a visually hidden text node beside it,
 * rather than `role="status"` on the SVG: a rotating ring conveys nothing to a
 * screen reader, and the text is what the user actually needs.
 *
 * The rotation runs on the `spin-slow` animation token, so it stops under
 * `prefers-reduced-motion` along with everything else. A stopped spinner is
 * still a correct "busy" indicator because the announcement carries the meaning.
 */
export function Spinner({ className, label = 'Loading' }: SpinnerProps) {
  return (
    <>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={cn('size-4 animate-spin-slow', className)}
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="2.5"
          opacity="0.25"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {label === null ? null : <span className="sr-only">{label}</span>}
    </>
  )
}
