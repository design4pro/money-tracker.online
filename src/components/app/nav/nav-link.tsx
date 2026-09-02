import { Link } from '#/components/ui'
import { cn } from '#/lib/cn'

import type { Destination } from './destinations'

export interface NavLinkProps {
  destination: Destination
  isActive: boolean
  /** Already translated. The label is passed in so this file holds no message key. */
  label: string
  className?: string
}

/**
 * One row in the rail.
 *
 * ## Three channels for one meaning
 *
 * The current destination is marked by `aria-current="page"`, by a 3px bar on the inline-start
 * edge, and by a change of weight and ground. That is deliberate over-specification: colour alone
 * fails for a third of colour-blind readers, weight alone is invisible in a screenshot review, and
 * `aria-current` alone is invisible to everyone with sight. `docs/DESIGN.md` names this rule; it is
 * cheap here and it is what makes the rail readable in greyscale.
 *
 * The bar is an absolutely-positioned span rather than a `border-inline-start`, because a border
 * would move the label 3px when the row becomes current and the whole rail would twitch on every
 * navigation. It is painted in `ink` so the rail and the phone's tab bar mark *current* with the
 * same mark, and so the product's one accent hue stays reserved for money that is negative.
 *
 * Losing the hue costs nothing here: the ground, the weight and `aria-current` all still say
 * current, which is one channel more than the colour ever carried on its own.
 */
export function NavLink({
  destination,
  isActive,
  label,
  className,
}: NavLinkProps) {
  const { href, Icon } = destination

  return (
    <Link
      href={href}
      variant="unstyled"
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'target-min-h relative flex w-full items-center gap-3 rounded-md py-2 pe-3 ps-4 text-label',
        isActive
          ? 'bg-surface font-semibold text-ink shadow-card'
          : 'font-medium text-ink-2 data-[hovered]:bg-hover data-[hovered]:text-ink',
        className,
      )}
    >
      {isActive ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-ink"
        />
      ) : null}
      <Icon className="size-[1.125rem] shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  )
}
