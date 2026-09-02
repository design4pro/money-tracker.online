import { Ellipsis } from 'lucide-react'
import { useState } from 'react'

import {
  Button,
  Dialog,
  DialogBody,
  DialogHeader,
  Drawer,
  Link,
} from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'
import {
  BOTTOM_BAR_DESTINATIONS,
  BOTTOM_BAR_OVERFLOW,
  activeDestinationId,
} from './destinations'
import { NavLink } from './nav-link'

import type { ComponentType, ReactNode } from 'react'

export interface BottomNavProps {
  pathname: string
}

/**
 * The phone's primary navigation: three tabs and a *More* sheet.
 *
 * This is a designed layout rather than a squeezed rail. At 360px four cells get 90px each, which
 * is comfortably enough for a 20px glyph over a 12px label that stays whole in Polish as well as
 * in English — `Transakcje` is the longest of the four and it fits. A fifth cell takes that to
 * 72px, where it does not, and that measurement rather than the count is what fixes
 * `BOTTOM_BAR_TAB_COUNT` at three.
 *
 * The overflow sheet is here because there is now something to put in it. The bar carried every
 * destination as a tab while budgets, recurring and goals were unbuilt; with seven rows a sheet is
 * the only way it shows every screen without wrapping to two lines or shrinking the labels past
 * legibility. It is the same `Drawer` the rest of the product uses — a real modal with React
 * Aria's focus trap, Escape handler and focus restore — and it lists the overflow rows with the
 * rail's own `NavLink`, so the two navigations still cannot disagree about what a row looks like
 * or which one is current.
 *
 * **There is no swipe.** The sheet opens from a button and closes from a button or Escape, which
 * is the whole interface; a gesture with no keyboard equivalent is what `ui/drawer.tsx` refuses
 * for itself and this is the same refusal.
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
  const [isMoreOpen, setMoreOpen] = useState(false)
  const activeId = activeDestinationId(pathname)

  const isOverflowActive = BOTTOM_BAR_OVERFLOW.some(
    (destination) => destination.id === activeId,
  )

  return (
    <div className="fixed inset-x-0 bottom-0 z-nav border-t border-border-subtle bg-canvas pb-[var(--safe-bottom)] lg:hidden">
      <nav aria-label={t('nav.primary')}>
        <ul className="grid grid-cols-4">
          {BOTTOM_BAR_DESTINATIONS.map((destination) => (
            <li key={destination.id} className="min-w-0">
              <Link
                href={destination.href}
                variant="unstyled"
                aria-current={destination.id === activeId ? 'page' : undefined}
                className={cn(TAB_SHAPE, tabTone(destination.id === activeId))}
              >
                {destination.id === activeId ? <ActiveRule /> : null}
                <TabFace Icon={destination.Icon} label={t(destination.label)} />
              </Link>
            </li>
          ))}
          <li className="min-w-0">
            {/*
              A button, not a link: it opens a sheet rather than navigating, and announcing "link"
              for something that leaves the address alone is the small lie that teaches a screen
              reader user to distrust the rest of the bar. `aria-expanded` carries the state the
              rule along the top edge carries visually.
            */}
            <Button
              variant="ghost"
              aria-expanded={isMoreOpen}
              aria-current={isOverflowActive ? 'true' : undefined}
              onPress={() => {
                setMoreOpen(true)
              }}
              className={cn(
                TAB_SHAPE,
                tabTone(isOverflowActive),
                'rounded-none shadow-none',
              )}
            >
              {isOverflowActive ? <ActiveRule /> : null}
              <TabFace Icon={Ellipsis} label={t('app.nav.more')} />
            </Button>
          </li>
        </ul>
      </nav>

      <Drawer side="bottom" isOpen={isMoreOpen} onOpenChange={setMoreOpen}>
        <Dialog>
          {({ close }) => (
            <>
              <DialogHeader
                title={t('app.nav.moreLabel')}
                closeLabel={t('app.menu.close')}
                onClose={close}
              />
              <DialogBody>
                <nav aria-label={t('app.nav.moreLabel')}>
                  <ul className="flex flex-col gap-0.5 pb-[var(--safe-bottom)]">
                    {BOTTOM_BAR_OVERFLOW.map((destination) => (
                      <li key={destination.id}>
                        <NavLink
                          destination={destination}
                          isActive={destination.id === activeId}
                          label={t(destination.label)}
                          className="py-3"
                        />
                      </li>
                    ))}
                  </ul>
                </nav>
              </DialogBody>
            </>
          )}
        </Dialog>
      </Drawer>
    </div>
  )
}

/** The cell both tab kinds fill. Identical for the link and the button, so they cannot drift. */
const TAB_SHAPE =
  'relative flex h-16 w-full flex-col items-center justify-center gap-1 px-1 text-caption'

/**
 * The current tab is marked three ways — `aria-current`, a 3px rule along the top edge, and a
 * weight-plus-colour change — for the reason spelled out in `nav-link.tsx`.
 *
 * The rule is painted in `ink`, not in the brand blue. A single saturated hue on the one active
 * tab was the only chromatic mark in a warm-monochrome system, and it read as an unstyled
 * framework default rather than as a decision; `negative` on an overdrawn balance is the one
 * chromatic event the surface is allowed.
 */
function ActiveRule() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-x-4 top-0 h-[3px] rounded-b-full bg-ink"
    />
  )
}

function tabTone(isActive: boolean): string {
  return isActive
    ? 'font-semibold text-ink'
    : 'font-medium text-ink-2 data-[hovered]:text-ink'
}

interface TabFaceProps {
  Icon: ComponentType<{ className?: string }>
  label: ReactNode
}

/**
 * Glyph over label, as one column.
 *
 * It is a component rather than two siblings because `Button` wraps its children in a row-flex
 * span of its own; handing it a single column child is what keeps the button tab and the link tab
 * looking like the same thing.
 */
function TabFace({ Icon, label }: TabFaceProps) {
  return (
    <span className="flex min-w-0 max-w-full flex-col items-center gap-1">
      <Icon className="size-5 shrink-0" />
      <span className="max-w-full truncate">{label}</span>
    </span>
  )
}
