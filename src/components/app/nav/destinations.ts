import {
  ArrowLeftRight,
  CalendarClock,
  ChartNoAxesCombined,
  FileUp,
  LayoutDashboard,
  PiggyBank,
  Settings,
  Wallet,
  WalletMinimal,
} from 'lucide-react'

import type { ComponentType } from 'react'
import type { MessageKey } from '#/lib/i18n'

/**
 * The product's destinations, in one table.
 *
 * The rail, the bottom bar and the overflow drawer all read this list, so the three of them cannot
 * disagree about what exists or what it is called — the failure mode being a route reachable from
 * a phone and invisible on a laptop.
 *
 * `href` is a plain string and the navigation components render a real `<a>` rather than the
 * router's typed `Link`. That is a deliberate, temporary shape: these destinations are owned by
 * later plans and do not exist in `routeTree.gen.ts` yet, so a typed `Link` would not compile and a
 * cast to make it compile would only hide the same fact. A real anchor is honest — it resolves when
 * the route lands and 404s until then — and swapping one to a typed `Link` is a one-line change per
 * row once the route exists.
 */
export interface Destination {
  /** Stable key. Used for React lists and for the switcher's selection state. */
  readonly id: string
  readonly href: string
  readonly label: MessageKey
  /** Sized by the caller, so a rail row and a bottom-bar tab can draw it differently. */
  readonly Icon: ComponentType<{ className?: string }>
}

export interface NavSection {
  readonly id: string
  readonly label: MessageKey
  readonly items: ReadonlyArray<Destination>
}

const DASHBOARD: Destination = {
  id: 'dashboard',
  href: '/dashboard',
  label: 'nav.dashboard',
  Icon: LayoutDashboard,
}

const TRANSACTIONS: Destination = {
  id: 'transactions',
  href: '/transactions',
  label: 'nav.transactions',
  Icon: ArrowLeftRight,
}

const ACCOUNTS: Destination = {
  id: 'accounts',
  href: '/accounts',
  label: 'nav.accounts',
  Icon: WalletMinimal,
}

const BUDGETS: Destination = {
  id: 'budgets',
  href: '/budgets',
  label: 'nav.budgets',
  Icon: Wallet,
}

export const SETTINGS: Destination = {
  id: 'settings',
  href: '/settings',
  label: 'nav.settings',
  Icon: Settings,
}

/** The rail's groups. Three of them, because a flat list of nine is a list nobody scans. */
export const NAV_SECTIONS: ReadonlyArray<NavSection> = [
  {
    id: 'money',
    label: 'app.nav.section.money',
    items: [DASHBOARD, ACCOUNTS, TRANSACTIONS],
  },
  {
    id: 'plan',
    label: 'app.nav.section.plan',
    items: [
      BUDGETS,
      {
        id: 'recurring',
        href: '/recurring',
        label: 'nav.recurring',
        Icon: CalendarClock,
      },
      {
        id: 'goals',
        href: '/goals',
        label: 'nav.goals',
        Icon: PiggyBank,
      },
    ],
  },
  {
    id: 'insight',
    label: 'app.nav.section.insight',
    items: [
      {
        id: 'reports',
        href: '/reports',
        label: 'nav.reports',
        Icon: ChartNoAxesCombined,
      },
      {
        id: 'import',
        href: '/import',
        label: 'nav.import',
        Icon: FileUp,
      },
    ],
  },
]

/**
 * The four tabs the bottom bar shows, plus a fifth "More" slot the bar adds itself.
 *
 * Four rather than five destinations: at 360 px a five-tab bar leaves 72 px per tab, and a label
 * under an icon in that width truncates in Polish (`Płatności cykliczne`) before it truncates in
 * English — which is exactly the kind of layout that passes review in one language and ships broken
 * in the other. Four tabs plus overflow keeps every label whole in both.
 */
export const BOTTOM_BAR_DESTINATIONS: ReadonlyArray<Destination> = [
  DASHBOARD,
  ACCOUNTS,
  TRANSACTIONS,
  BUDGETS,
]

/** Every destination, flattened — what the overflow drawer lists. */
export const ALL_DESTINATIONS: ReadonlyArray<Destination> = [
  ...NAV_SECTIONS.flatMap((section) => section.items),
  SETTINGS,
]

/**
 * Which destination a pathname is inside.
 *
 * A prefix match rather than equality, so `/transactions/tx_123` still marks Transactions as the
 * current destination. The boundary check (`/` or end of string) is what stops `/accounts` from
 * claiming `/accounts-archive`.
 */
export function activeDestinationId(
  pathname: string,
  destinations: ReadonlyArray<Destination> = ALL_DESTINATIONS,
): string | null {
  let best: Destination | null = null
  for (const destination of destinations) {
    const matches =
      pathname === destination.href ||
      pathname.startsWith(`${destination.href}/`)
    if (!matches) continue
    // Longest match wins, so a future `/settings/members` prefers Settings over any shorter row.
    if (!best || destination.href.length > best.href.length) best = destination
  }
  return best?.id ?? null
}
