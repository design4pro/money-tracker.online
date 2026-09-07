import { Ellipsis, Plus } from 'lucide-react'
import { Fragment, useState } from 'react'

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
 * The phone's primary navigation: three tabs, the one stamp, and a *More* sheet.
 *
 * This is a designed layout rather than a squeezed rail. At 360px the four labelled cells get
 * 78px each once the 48px stamp cell in the middle has taken its share, and 74px of that is
 * label room: enough for a 20px glyph over a 12px label that stays whole in Polish as well as
 * in English — `Transakcje` is the longest of the four at 72px and it fits. A fifth *labelled*
 * cell would take that to 62px, where it does not, and that measurement rather than the count
 * is what fixes `BOTTOM_BAR_TAB_COUNT` at three.
 *
 * ## The stamp in the middle
 *
 * "New transaction" is an action, not a destination, so it is not a row of `destinations.ts` and never
 * carries `aria-current`: it is a link to the new-entry form drawn as the primary button, the one
 * violet fill on the bar. It sits between the tabs so a thumb reaches it from either side, and
 * it is a plain `<a>` with an accessible name rather than a floating button over the content -
 * nothing floats at rest, and a thing that covers the last row of a list is not reachable.
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
        <ul className="grid grid-cols-[1fr_1fr_auto_1fr_1fr]">
          {BOTTOM_BAR_DESTINATIONS.map((destination, index) => (
            // The stamp is inserted in the DOM where it is drawn, so the tab order and the
            // visual order agree; a `grid-column` or `order` trick would separate them.
            <Fragment key={destination.id}>
              {index === CREATE_CELL_AT ? (
                <li className="min-w-0">
                  <Link
                    href="/transactions/new"
                    variant="unstyled"
                    aria-label={t('transactions.create')}
                    className="flex h-16 w-12 items-center justify-center"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-10 place-items-center rounded-md bg-accent text-on-accent shadow-card"
                    >
                      <Plus className="size-5" />
                    </span>
                  </Link>
                </li>
              ) : null}
              <li className="min-w-0">
                <Link
                  href={destination.href}
                  variant="unstyled"
                  aria-current={
                    destination.id === activeId ? 'page' : undefined
                  }
                  className={cn(
                    TAB_SHAPE,
                    tabTone(destination.id === activeId),
                  )}
                >
                  {destination.id === activeId ? <ActiveRule /> : null}
                  <TabFace
                    Icon={destination.Icon}
                    label={t(destination.label)}
                  />
                </Link>
              </li>
            </Fragment>
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

/** Which tab the stamp cell is drawn before: the middle of the four labelled cells. */
const CREATE_CELL_AT = Math.ceil(BOTTOM_BAR_DESTINATIONS.length / 2)

/** The cell both tab kinds fill. Identical for the link and the button, so they cannot drift. */
const TAB_SHAPE =
  'relative flex h-16 w-full flex-col items-center justify-center gap-1 px-0.5 text-caption'

/**
 * The current tab is marked three ways - `aria-current`, a one-pixel rule along the top edge, and
 * its glyph and label in `brand` at the heavier weight - for the reason spelled out in
 * `nav-link.tsx`.
 *
 * The rule is a line, not a bar, in the stamp ink the rail's frame spends on its words: one violet
 * marks everything the product has settled, and *current* is one of those things.
 */
function ActiveRule() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-x-4 top-0 h-px bg-brand"
    />
  )
}

function tabTone(isActive: boolean): string {
  return isActive
    ? 'font-semibold text-brand'
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
