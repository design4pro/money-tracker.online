import { Separator } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import {
  PRIMARY_DESTINATIONS,
  SETTINGS,
  activeDestinationId,
} from './destinations'
import { NavLink } from './nav-link'

export interface SidebarNavProps {
  /** The current pathname. Passed in rather than read here, so this stays a pure component. */
  pathname: string
}

/**
 * The rail's contents: the screens, then Settings on its own below a rule.
 *
 * One `<nav>` with one accessible name and two `<ul>`s inside it. The rule between them is the
 * whole grouping: Settings is where the product is configured, the three above it are where money
 * is read, and at this size a pair of uppercase headings over three links each would be furniture
 * rather than structure. When the rail carries nine rows again the headings come back with them,
 * because *then* a screen-reader user navigating by heading gains something.
 */
export function SidebarNav({ pathname }: SidebarNavProps) {
  const t = useTranslate()
  const activeId = activeDestinationId(pathname)

  return (
    <nav aria-label={t('nav.primary')} className="flex flex-col gap-3">
      <ul className="flex flex-col gap-0.5">
        {PRIMARY_DESTINATIONS.map((destination) => (
          <li key={destination.id}>
            <NavLink
              destination={destination}
              isActive={destination.id === activeId}
              label={t(destination.label)}
            />
          </li>
        ))}
      </ul>

      <Separator />

      <ul>
        <li>
          <NavLink
            destination={SETTINGS}
            isActive={SETTINGS.id === activeId}
            label={t(SETTINGS.label)}
          />
        </li>
      </ul>
    </nav>
  )
}
