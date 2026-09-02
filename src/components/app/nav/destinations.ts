import {
  ArrowLeftRight,
  LayoutDashboard,
  Settings,
  WalletMinimal,
} from 'lucide-react'

import type { ComponentType } from 'react'
import type { MessageKey } from '#/lib/i18n'

/**
 * The product's destinations, in one table.
 *
 * The rail and the bottom bar both read this list, so the two of them cannot disagree about what
 * exists or what it is called — the failure mode being a route reachable from a phone and invisible
 * on a laptop.
 *
 * ## Only routes that exist are listed
 *
 * This table earlier carried the whole eventual product — budgets, recurring, goals, reports,
 * import — as anchors that resolved to nothing, on the theory that an honest 404 was better than a
 * hidden feature. It is not: a reader cannot tell "not built" from "broken", and six of nine rows
 * ending in the browser's error page reads as an application that has fallen over rather than one
 * that is early. The rule now is the plain one — **a row exists here when its route exists** — and
 * each later plan adds its own row in the same commit that adds its screen.
 *
 * `href` is a plain string and the navigation components render a real `<a>` rather than the
 * router's typed `Link`, which costs a document load per navigation. That is not about these rows:
 * `src/components/ui/link.tsx` routes through React Aria's `RouterProvider` and no provider is
 * mounted in the app yet (see `src/components/app/dashboard/widget-link.tsx`, which says the same
 * thing). When it is, these become typed links.
 */
export interface Destination {
  /** Stable key. Used for React lists and for the switcher's selection state. */
  readonly id: string
  readonly href: string
  readonly label: MessageKey
  /** Sized by the caller, so a rail row and a bottom-bar tab can draw it differently. */
  readonly Icon: ComponentType<{ className?: string }>
}

const DASHBOARD: Destination = {
  id: 'dashboard',
  href: '/dashboard',
  label: 'nav.dashboard',
  Icon: LayoutDashboard,
}

const ACCOUNTS: Destination = {
  id: 'accounts',
  href: '/accounts',
  label: 'nav.accounts',
  Icon: WalletMinimal,
}

const TRANSACTIONS: Destination = {
  id: 'transactions',
  href: '/transactions',
  label: 'nav.transactions',
  Icon: ArrowLeftRight,
}

export const SETTINGS: Destination = {
  id: 'settings',
  href: '/settings',
  label: 'nav.settings',
  Icon: Settings,
}

/**
 * The product's screens, in reading order.
 *
 * Settings is deliberately not one of them: it is the place a product is configured rather than a
 * place money is looked at, and the rail sets it below a rule for that reason. Grouping headings
 * ("Money", "Planning", "Insight") return when there are enough rows to need them again — over
 * three links a heading is furniture, not structure.
 */
export const PRIMARY_DESTINATIONS: ReadonlyArray<Destination> = [
  DASHBOARD,
  ACCOUNTS,
  TRANSACTIONS,
]

/** Every destination, in the order both navigations draw them. */
export const ALL_DESTINATIONS: ReadonlyArray<Destination> = [
  ...PRIMARY_DESTINATIONS,
  SETTINGS,
]

/**
 * Which destination a pathname is inside.
 *
 * A prefix match rather than equality, so `/transactions/tx_123` still marks Transactions as the
 * current destination. The boundary check (`/` or end of string) is what stops `/accounts` from
 * claiming `/accounts-archive`.
 */
export function activeDestinationId(pathname: string): string | null {
  let best: Destination | null = null
  for (const destination of ALL_DESTINATIONS) {
    const matches =
      pathname === destination.href ||
      pathname.startsWith(`${destination.href}/`)
    if (!matches) continue
    // Longest match wins, so a future `/settings/members` prefers Settings over any shorter row.
    if (!best || destination.href.length > best.href.length) best = destination
  }
  return best?.id ?? null
}
