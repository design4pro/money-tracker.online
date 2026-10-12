import { useState, useSyncExternalStore } from 'react'

const subscribeNever = () => () => {}

/**
 * Whether the calling component mounted after the document's first render.
 *
 * `false` on the server and while hydrating, `true` for any mount after that, read once on the
 * component's first render and kept: the pass that follows hydration must not flip it.
 *
 * It is `useSyncExternalStore` with a client snapshot of `true` and a server snapshot of `false`
 * because React uses the server snapshot for exactly the renders that reuse server markup, and
 * the client snapshot for every other one. That decides it at render time, independent of effect
 * order and of whether a `RouteAnnouncer` exists, so it holds under the signed-in shell, the
 * signed-out group and the floor boundary alike.
 *
 * It answers one question: should this component take focus for itself? On the initial render the
 * answer is no, because the browser has already placed focus on the document and the skip link has
 * to stay the first tab stop; after a client navigation it is yes, because the content the reader
 * asked for is gone.
 */
export function useIsAfterInitialRender() {
  const now = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
  const [atFirstRender] = useState(now)
  return atFirstRender
}
