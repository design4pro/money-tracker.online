import { cn } from '#/lib/cn'

/**
 * The product mark, drawn from tokens.
 *
 * The same geometry as the inline favicon in `src/routes/__root.tsx` — an `M` for the ledger and a
 * struck-through bar for the currency — but painted with `fill-accent` / `stroke-on-accent` rather
 * than with the favicon's frozen hex pair, so it inverts correctly in dark. The favicon cannot do
 * that: it is a data URI in `<head>` that the browser resolves before any stylesheet exists.
 *
 * `aria-hidden` and no title, always. It never appears without the product name beside it, and a
 * logo announced next to its own wordmark is the textbook duplicate announcement.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      aria-hidden="true"
      className={cn('size-7', className)}
    >
      <rect width="28" height="28" rx="2" className="fill-accent" />
      <path
        d="M7 19.5V9.2l4.4 5.6L15.8 9.2v10.3"
        fill="none"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-on-accent"
      />
      <path
        d="M19.4 8.6v10.9M17 11.4h4.8M17 14.6h4.8"
        fill="none"
        strokeWidth="1.7"
        strokeLinecap="round"
        className="stroke-on-accent"
      />
    </svg>
  )
}

export interface WordmarkProps {
  /** The product name, already translated. */
  name: string
  className?: string
}

/**
 * Mark plus name, as one non-interactive lockup.
 *
 * Deliberately not a link: it is rendered inside a rail whose first navigation item is already
 * "Dashboard", and a second control that goes to the same place is one more stop between a
 * keyboard user and the thing they came for.
 */
export function Wordmark({ name, className }: WordmarkProps) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-2.5 text-body font-bold text-ink',
        className,
      )}
    >
      <BrandMark />
      <span className="truncate">{name}</span>
    </span>
  )
}
