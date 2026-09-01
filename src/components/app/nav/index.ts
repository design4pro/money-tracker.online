/**
 * The product's navigation.
 *
 * One destination table (`destinations.ts`) and three renderers of it: the fixed rail, the phone's
 * bottom bar, and the overflow sheet the bottom bar opens. Nothing here fetches; the current
 * pathname arrives as a prop so every piece is renderable in a test with a string.
 */

export {
  ALL_DESTINATIONS,
  BOTTOM_BAR_DESTINATIONS,
  NAV_SECTIONS,
  SETTINGS,
  activeDestinationId,
} from './destinations'
export type { Destination, NavSection } from './destinations'

export { NavLink } from './nav-link'
export type { NavLinkProps } from './nav-link'

export { SidebarNav } from './sidebar-nav'
export type { SidebarNavProps } from './sidebar-nav'

export { BottomNav } from './bottom-nav'
export type { BottomNavProps } from './bottom-nav'
