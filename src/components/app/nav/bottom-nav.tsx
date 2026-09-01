import { Ellipsis } from 'lucide-react'

import {
  Button,
  Drawer,
  DrawerBody,
  DrawerDialog,
  DrawerHeader,
  DrawerTrigger,
  Link,
} from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'
import { BOTTOM_BAR_DESTINATIONS, activeDestinationId } from './destinations'
import { SidebarNav } from './sidebar-nav'

import type { Destination } from './destinations'

export interface BottomNavProps {
  pathname: string
}

/**
 * The phone's primary navigation: four destinations and an overflow sheet.
 *
 * This is a designed layout rather than a squeezed rail. At 360px each tab gets 72px, which is
 * enough for a 20px glyph over a 12px label that stays whole in Polish as well as in English —
 * `Płatności cykliczne` is the reason the fifth destination became an overflow sheet instead of a
 * fifth tab.
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
        <ul className="grid grid-cols-5">
          {BOTTOM_BAR_DESTINATIONS.map((destination) => (
            <li key={destination.id} className="min-w-0">
              <BottomTab
                destination={destination}
                isActive={destination.id === activeId}
                label={t(destination.label)}
              />
            </li>
          ))}
          <li className="min-w-0">
            <DrawerTrigger>
              <Button
                variant="ghost"
                className="h-16 w-full flex-col justify-center gap-1 rounded-none px-1 text-caption font-medium text-ink-2"
                icon={<Ellipsis className="size-5" />}
              >
                <span className="truncate">{t('app.nav.more')}</span>
              </Button>
              <Drawer side="bottom">
                <DrawerDialog aria-label={t('app.nav.moreLabel')}>
                  {({ close }) => (
                    <>
                      <DrawerHeader
                        title={t('app.nav.moreLabel')}
                        closeLabel={t('action.close')}
                        onClose={close}
                      />
                      <DrawerBody>
                        {/* The same component the rail renders, so a destination cannot exist on
                            one form factor and not the other. */}
                        <SidebarNav pathname={pathname} onNavigate={close} />
                      </DrawerBody>
                    </>
                  )}
                </DrawerDialog>
              </Drawer>
            </DrawerTrigger>
          </li>
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
          className="absolute inset-x-4 top-0 h-[3px] rounded-b-full bg-brand"
        />
      ) : null}
      <Icon className="size-5 shrink-0" />
      <span className="max-w-full truncate">{label}</span>
    </Link>
  )
}
