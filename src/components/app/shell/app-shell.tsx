import { ToastHost } from '#/components/ui'
import { BottomNav, SidebarNav } from '#/components/app/nav'
import { useTranslate } from '#/lib/i18n'
import { AppHeader } from './app-header'
import { Wordmark } from './brand-mark'
import { WorkspaceSwitcher } from './workspace-switcher'
import { MAIN_CONTENT_ID } from './main-content'

import type { ReactNode } from 'react'
import type { ShellData } from './types'

export interface AppShellProps {
  shell: ShellData
  /** The current pathname, so the navigation can mark its current destination. */
  pathname: string
  children: ReactNode
}

/**
 * The frame every authenticated screen is drawn inside.
 *
 * ## Two layouts, not one squeezed
 *
 * Below 1024px there is no rail at all: the header carries identity, the bottom bar carries
 * navigation, and the content well runs edge to edge with 16px of padding. At 1024px and above a
 * 220px rail appears carrying the destinations *and* the household, the bottom bar disappears, the
 * header is left with the viewer's own controls, and the content well takes the remaining width up
 * to 1280px. The two are separate compositions that happen to share components — a rail collapsed
 * to icons on a phone would put nine 44px targets down the side of a 360px screen and leave 200px
 * for a ledger row.
 *
 * ## The reserved edges
 *
 * Exactly one element clears each fixed edge and the content well accounts for both, once:
 *
 * - the header at the top, cleared because it is `sticky` inside the same scroll flow;
 * - the bottom bar at the bottom, cleared by `pb-28` below `lg` — 112px, which is the bar's 64px
 *   plus room for a focus ring and the safe-area inset the bar itself pads for.
 *
 * A sticky sub-header inside a screen composes those values rather than re-deriving them. Two
 * elements both claiming to clear the same edge is how a focused input ends up under a phone
 * keyboard.
 *
 * ## The main landmark
 *
 * `tabIndex={-1}` is what makes the skip link in the document shell actually *move focus* here.
 * Without it the browser scrolls to the anchor and leaves focus at the top of the document, so the
 * next Tab returns the reader to the navigation they just asked to skip. `scroll-mt-16` keeps the
 * landing point clear of the sticky header.
 */
export function AppShell({ shell, pathname, children }: AppShellProps) {
  const t = useTranslate()

  return (
    <div className="min-h-dvh bg-canvas">
      {/* The rail. `aria-hidden` is deliberately absent below `lg`: it is `display: none` there, so
          it is out of the accessibility tree already, and the bottom bar carries the same links. */}
      <div className="fixed inset-y-0 start-0 z-nav hidden w-55 flex-col border-e border-border-subtle bg-surface-sunken lg:flex">
        <div className="flex h-16 shrink-0 items-center px-5">
          <Wordmark name={t('app.name')} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 focus-safe">
          <SidebarNav pathname={pathname} />
        </div>

        {/*
          The household, pinned to the foot of the rail.

          It used to sit in the top bar, where it was the first thing on the line and took the
          first fixation from the page's own `<h1>` — two identities competing for the same
          opening, and the one that never changes winning. Down here it is where a reader looks
          for "which account am I in", it fills the rail's own dead space, and the top bar is left
          with the three controls that genuinely belong to the *viewer* rather than to the screen.

          Below `lg` the rail is `display: none`, so `AppHeader` keeps drawing the switcher there
          — the same component, one instance visible at a time, which is the arrangement the rail
          and the bottom bar already use for navigation.
        */}
        <div className="shrink-0 border-t border-border-subtle p-3">
          <WorkspaceSwitcher shell={shell} />
        </div>
      </div>

      <div className="flex min-h-dvh flex-col lg:ps-55">
        <AppHeader shell={shell} />

        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 scroll-mt-16 px-4 pt-6 pb-28 outline-none sm:px-6 lg:px-8 lg:pb-12"
        >
          {children}
        </main>
      </div>

      <BottomNav pathname={pathname} />

      {/* One toast region for the whole product, mounted once so two screens cannot each own one. */}
      <ToastHost
        regionLabel={t('notifications.title')}
        closeLabel={t('action.close')}
      />
    </div>
  )
}

export interface AppShellFallbackProps {
  children: ReactNode
}

/**
 * The shell's own geometry with nothing in it yet.
 *
 * Rendered while `_app`'s guard is still resolving the session, and again around a failure that
 * happened before there was a session to build a shell from. It draws the rail, the header bar and
 * the content well at their real sizes, so what arrives afterwards lands in the same place rather
 * than pushing the page down.
 *
 * Deliberately inert: no navigation, no switcher, no menus. There is no session yet, so every
 * control it could draw would be a control that cannot answer. The wordmark is the one thing that
 * is true regardless.
 */
export function AppShellFallback({ children }: AppShellFallbackProps) {
  const t = useTranslate()

  return (
    <div className="min-h-dvh bg-canvas">
      <div
        aria-hidden="true"
        className="fixed inset-y-0 start-0 z-nav hidden w-55 flex-col border-e border-border-subtle bg-surface-sunken lg:flex"
      >
        <div className="flex h-16 shrink-0 items-center px-5">
          <Wordmark name={t('app.name')} />
        </div>
      </div>

      <div className="flex min-h-dvh flex-col lg:ps-55">
        <div
          aria-hidden="true"
          className="sticky top-0 z-nav h-16 shrink-0 border-b border-border-subtle bg-canvas"
        />
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 scroll-mt-16 px-4 pt-6 pb-12 outline-none sm:px-6 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
