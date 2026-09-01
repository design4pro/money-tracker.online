import { LocaleSwitcher } from './locale-switcher'
import { ThemeMenu } from './theme-menu'
import { UserMenu } from './user-menu'
import { WorkspaceSwitcher } from './workspace-switcher'

import type { ShellData } from './types'

export interface AppHeaderProps {
  shell: ShellData
}

/**
 * The one bar across the top of every guarded screen: which workspace, and who you are.
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
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher shell={shell} />
        </div>

        {/* Three icon controls, 44px each including their grown hit areas. At 360px they occupy
            132px beside a switcher that truncates rather than wraps. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <ThemeMenu />
          <LocaleSwitcher />
          <UserMenu user={shell.user} />
        </div>
      </div>
    </header>
  )
}
