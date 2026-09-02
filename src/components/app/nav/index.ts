/**
 * The product's navigation.
 *
 * One destination table (`destinations.ts`) and two renderers of it: the fixed rail and the phone's
 * bottom bar. Nothing here fetches; the current pathname arrives as a prop so every piece is
 * renderable in a test with a string.
 *
 * The table lists only routes that exist. A destination is added here by the plan that builds its
 * screen, in the same commit — see the note at the top of `destinations.ts`.
 */

export {
  ALL_DESTINATIONS,
  PRIMARY_DESTINATIONS,
  SETTINGS,
  activeDestinationId,
} from './destinations'
export type { Destination } from './destinations'

export { NavLink } from './nav-link'
export type { NavLinkProps } from './nav-link'

export { SidebarNav } from './sidebar-nav'
export type { SidebarNavProps } from './sidebar-nav'

export { BottomNav } from './bottom-nav'
export type { BottomNavProps } from './bottom-nav'
