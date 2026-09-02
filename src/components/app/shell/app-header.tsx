import { LocaleSwitcher } from './locale-switcher'
import { ThemeMenu } from './theme-menu'
import { UserMenu } from './user-menu'
import { WorkspaceSwitcher } from './workspace-switcher'

import type { ShellData } from './types'

export interface AppHeaderProps {
  shell: ShellData
}

/**
 * The one bar across the top of every guarded screen: the viewer's own controls, and — only while
 * there is no rail to hold it — which workspace they are in.
 *
 * ## What is not in it
 *
 * No page title and no breadcrumbs. Each screen owns its own `<h1>`, and a header that repeated it
 * would give a screen-reader user the same sentence twice on every navigation. No search either —
 * that arrives with the transaction plans and belongs beside the data it searches.
 *
 * ## Geometry
 *
 * 64px tall (`--nav-h`) and sticky. It is the only thing that clears the top edge, so `<html>`
 * carries a matching `scroll-padding-block-start` and `<main>` a matching `scroll-margin`: a
 * control that the browser scrolls to must land *below* this bar, not underneath it — WCAG 2.2
 * §2.4.11 and §2.4.12, and §2.4.12 (Enhanced, no part obscured) is a criterion this product claims.
 *
 * Painted with a solid ground rather than a translucent blur. `src/styles/tokens.css` rules out
 * glass panels, and there is a measurement behind the rule as well as a taste: text sitting over a
 * blurred copy of arbitrary scrolling content has no computable contrast ratio.
 */
export function AppHeader({ shell }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-nav border-b border-border-subtle bg-canvas">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4 sm:px-6 lg:px-8">
        {/* Only while there is no rail to hold it. From `lg` the household is pinned to the foot
            of the rail instead, which leaves this bar to the three controls below and gives the
            screen's own `<h1>` an uncontested first line. */}
        <div className="min-w-0 flex-1 lg:hidden">
          <WorkspaceSwitcher shell={shell} />
        </div>

        {/* Three icon controls, 44px each including their grown hit areas. At 360px they occupy
            132px beside a switcher that truncates rather than wraps. */}
        <div className="flex shrink-0 items-center gap-0.5 lg:ms-auto">
          <ThemeMenu />
          <LocaleSwitcher />
          <UserMenu user={shell.user} />
        </div>
      </div>
    </header>
  )
}
