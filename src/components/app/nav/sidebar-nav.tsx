import { Separator } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { NAV_SECTIONS, SETTINGS, activeDestinationId } from './destinations'
import { NavLink } from './nav-link'

export interface SidebarNavProps {
  /** The current pathname. Passed in rather than read here, so this stays a pure component. */
  pathname: string
  /** Called after a row is activated — the drawer form of this nav closes itself with it. */
  onNavigate?: () => void
}

/**
 * The full destination list: three named groups, then Settings on its own below a rule.
 *
 * Rendered in two places — the fixed rail at ≥1024px and the overflow drawer below it — from one
 * component, so the phone and the laptop cannot end up offering different products. The only
 * difference between the two is the container, which is the caller's business.
 *
 * The groups are real `<ul>`s inside a single `<nav>` with one accessible name, each headed by a
 * `<h2>`. A screen-reader user navigating by heading therefore lands on "Money", "Planning",
 * "Insight" rather than on nine undifferentiated links.
 */
export function SidebarNav({ pathname, onNavigate }: SidebarNavProps) {
  const t = useTranslate()
  const activeId = activeDestinationId(pathname)

  return (
    <nav aria-label={t('nav.primary')} className="flex flex-col gap-6">
      {NAV_SECTIONS.map((section) => (
        <div key={section.id}>
          <h2 className="px-4 pb-2 text-micro tracking-label text-ink-2 uppercase">
            {t(section.label)}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((destination) => (
              <li key={destination.id}>
                <NavLink
                  destination={destination}
                  isActive={destination.id === activeId}
                  label={t(destination.label)}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="flex flex-col gap-3">
        <Separator />
        <ul>
          <li>
            <NavLink
              destination={SETTINGS}
              isActive={SETTINGS.id === activeId}
              label={t(SETTINGS.label)}
              onNavigate={onNavigate}
            />
          </li>
        </ul>
      </div>
    </nav>
  )
}
