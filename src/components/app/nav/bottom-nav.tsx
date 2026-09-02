import { Link } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'
import { ALL_DESTINATIONS, activeDestinationId } from './destinations'

import type { Destination } from './destinations'

export interface BottomNavProps {
  pathname: string
}

/**
 * The phone's primary navigation: every destination, as a tab.
 *
 * This is a designed layout rather than a squeezed rail. At 360px four tabs get 90px each, which is
 * comfortably enough for a 20px glyph over a 12px label that stays whole in Polish as well as in
 * English — `Ustawienia` is the longest of the four and it fits.
 *
 * There is no "More" sheet, because there is nothing to put in it. The bar carried four of nine
 * destinations while five of those nine were unbuilt; with the table trimmed to the screens that
 * exist, an overflow sheet would list the four tabs sitting directly above it. It returns when the
 * fifth destination does — five labelled tabs do not fit at 360px in Polish, which is the
 * measurement that decides it, not the count.
 *
 * Three details here are load-bearing rather than cosmetic:
 *
 * - `padding-bottom: var(--safe-bottom)` puts the bar *above* the home indicator on an iPhone. The
 *   token resolves to `env(safe-area-inset-bottom)`, which only means anything because the shell's
 *   viewport meta carries `viewport-fit=cover`.
 * - The ground is solid, never a translucent blur. Labels here sit over whatever the reader has
 *   scrolled underneath them, and text over a blurred copy of arbitrary content has no computable
 *   contrast ratio — the same argument the header makes for the top edge.
 * - The bar is the only thing that clears the bottom edge. The shell pads `<main>` for it, and
 *   `<html>` carries a matching `scroll-padding-block-end`, so a control focused at the foot of a
 *   long page is scrolled clear of the bar rather than under it (WCAG 2.2 §2.4.11 / §2.4.12).
 */
export function BottomNav({ pathname }: BottomNavProps) {
  const t = useTranslate()
  const activeId = activeDestinationId(pathname)

  return (
    <div className="fixed inset-x-0 bottom-0 z-nav border-t border-border-subtle bg-canvas pb-[var(--safe-bottom)] lg:hidden">
      <nav aria-label={t('nav.primary')}>
        <ul className="grid grid-cols-4">
          {ALL_DESTINATIONS.map((destination) => (
            <li key={destination.id} className="min-w-0">
              <BottomTab
                destination={destination}
                isActive={destination.id === activeId}
                label={t(destination.label)}
              />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

interface BottomTabProps {
  destination: Destination
  isActive: boolean
  label: string
}

/**
 * One tab. The current one is marked three ways — `aria-current`, a 3px rule along the top edge,
 * and a weight-plus-colour change — for the reason spelled out in `nav-link.tsx`.
 *
 * The rule is painted in `ink`, not in the brand blue. A single saturated hue on the one active
 * tab was the only chromatic mark in a warm-monochrome system, and it read as an unstyled
 * framework default rather than as a decision; `negative` on an overdrawn balance is the one
 * chromatic event the surface is allowed.
 */
function BottomTab({ destination, isActive, label }: BottomTabProps) {
  const { href, Icon } = destination

  return (
    <Link
      href={href}
      variant="unstyled"
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative flex h-16 w-full flex-col items-center justify-center gap-1 px-1 text-caption',
        isActive
          ? 'font-semibold text-ink'
          : 'font-medium text-ink-2 data-[hovered]:text-ink',
      )}
    >
      {isActive ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-4 top-0 h-[3px] rounded-b-full bg-ink"
        />
      ) : null}
      <Icon className="size-5 shrink-0" />
      <span className="max-w-full truncate">{label}</span>
    </Link>
  )
}
