import { Link } from '#/components/ui'
import { cn } from '#/lib/cn'

import type { Destination } from './destinations'

export interface NavLinkProps {
  destination: Destination
  isActive: boolean
  /** Already translated. The label is passed in so this file holds no message key. */
  label: string
  className?: string
  /**
   * Run when the row is activated, beside the navigation rather than instead of it.
   *
   * The rail has no use for it; the phone's *More* sheet does. React Aria calls this from the
   * same click that `RouterProvider` navigates on, and React does not re-render until that
   * dispatch is over, so a handler that unmounts this link still leaves the navigation to happen
   * — the arrangement `MenuItem`'s `href` + `onAction` already relies on.
   */
  onPress?: () => void
}

/**
 * One row in the rail.
 *
 * ## Three channels for one meaning
 *
 * The current destination is marked by `aria-current="page"`, by its glyph and label in `brand`
 * at the heavier weight, and by a `surface` ground inside a one-pixel frame in the form's own rule
 * colour. That is deliberate over-specification: colour alone fails for a third of colour-blind
 * readers, weight alone is invisible in a screenshot review, and `aria-current` alone is invisible
 * to everyone with sight. It is what makes the rail readable in greyscale.
 *
 * The frame is a border on every row, transparent until the row is current, so no label moves by
 * a pixel on navigation. It is a line rather than a bar because the form marks a place with a rule
 * or a box, never a stripe, and the one violet goes on the words: the stamp ink the product puts on
 * everything it has settled, at 10.34:1 on `surface` in light and 8.42:1 in dark.
 */
export function NavLink({
  destination,
  isActive,
  label,
  className,
  onPress,
}: NavLinkProps) {
  const { href, Icon } = destination

  return (
    <Link
      href={href}
      variant="unstyled"
      onPress={onPress}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'target-min-h flex w-full items-center gap-3 rounded-md border px-3 py-2 text-label',
        isActive
          ? 'border-border-panel bg-surface font-semibold text-brand'
          : 'border-transparent font-medium text-ink-2 data-[hovered]:bg-hover data-[hovered]:text-ink',
        className,
      )}
    >
      <Icon className="size-[1.125rem] shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  )
}
