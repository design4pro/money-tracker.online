import { useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'
import { RouterProvider as ReactAriaRouterProvider } from 'react-aria-components'

import type { ReactNode } from 'react'

/**
 * The application's router, handed to React Aria.
 *
 * Every React Aria Components primitive that can be a link - `Link` itself, and the `href` form of
 * `Button`, `MenuItem`, `Tab`, `Breadcrumb` and the collection rows - opens its target through a
 * router it reads from React Aria's own context. That context defaults to `{ isNative: true }`,
 * and on that default the library's click handler returns *without* calling `preventDefault`, so
 * the browser follows the anchor and the tab reloads. This provider is the only thing that flips
 * it. Without it mounted, the shell rail and the phone bottom bar are full document loads: the
 * scroll offset and the focus are discarded, the query cache is thrown away, and - because the
 * loaders then run during SSR - no route's `pendingComponent` can render at all.
 *
 * It is mounted exactly where {@link AriaI18nProvider} is mounted, and for the same reason that
 * file gives at length: the document shell in `__root.tsx` also renders the marketing page, which
 * ships no React Aria primitive, so an import there would put the library into the chunk every
 * first-time visitor downloads. So the three frames that do render primitives mount it themselves
 * - `AppShell` and `AppShellFallback` in `app-shell.tsx`, and `(auth)/route.tsx`'s own frame.
 *
 * ## Two arguments this deliberately does not pass
 *
 * `useHref` is absent. React Aria defaults it to the identity function, and this application is
 * served from the origin root with no base path, so identity is *correct* here rather than merely
 * adequate; supplying it would be a second place for a base path to be wrong.
 *
 * The callback's second parameter is absent too. React Aria types it
 * `(path: Href, routerOptions: RouterOptions | undefined) => void`, but `RouterOptions` derives
 * from `RouterConfig`, which is an empty interface in `@react-types/shared` and is augmented
 * nowhere in this repository. No call site can therefore pass one, and forwarding an
 * always-`undefined` argument into `router.navigate` would only invite a reader to wonder what it
 * carries.
 */
export function AriaRouterProvider({ children }: { children: ReactNode }) {
  const router = useRouter()

  // `href` rather than `to`: what React Aria hands over is a fully built href read off the
  // rendered anchor, which is TanStack's own documented entry for exactly that.
  const navigate = useCallback(
    (href: string) => {
      void router.navigate({ href })
    },
    [router],
  )

  return (
    <ReactAriaRouterProvider navigate={navigate}>
      {children}
    </ReactAriaRouterProvider>
  )
}
