import { useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

/**
 * Says out loud which screen the reader just landed on.
 *
 * A document load announces the new page by itself - the browser resets its focus to the document
 * and reads the fresh `<title>`. A client-side navigation does neither, so the move #245 made the
 * rail perform takes that announcement away: `pageHead` still computes the right title, in the
 * negotiated language, and it now changes in silence. Someone who pressed Enter on *Budgets* would
 * hear nothing at all between the press and whatever they happened to read next.
 *
 * This region gives it back. It is deliberately the plainest thing that can: an empty polite region
 * that exists from the first paint, into which the destination's own `document.title` is written
 * once the navigation has committed. No message key, because there is no new copy - the title is
 * already the product's name for the screen, already translated, already the one the tab shows.
 *
 * Three details carry the behaviour.
 *
 * The region is rendered empty rather than conditionally, because a live region that appears in the
 * same commit as its text is not announced: assistive technology has to have been watching it
 * beforehand. The announcement is skipped for the page the reader *arrived* on - a first paint is
 * still a document load, which the browser has already announced, and repeating it would make every
 * cold start say its own title twice. And it waits for `status === 'idle'`, so it names where the
 * reader ended up rather than where they were heading; the waiting itself is already covered, by
 * `RoutePending`'s own `role="status"` once a load passes the router's 300ms threshold.
 *
 * `role="status"` rather than `role="alert"`: arriving where you asked to arrive is not an alert,
 * and an assertive region would cut off whatever the reader was in the middle of.
 */
export function RouteAnnouncer() {
  // `null` while a navigation is in flight, so the effect below fires on arrival and not on
  // departure - and fires exactly once per arrival, because the href stops changing then.
  const settledHref = useRouterState({
    select: (state) => (state.status === 'idle' ? state.location.href : null),
  })

  const [announcement, setAnnouncement] = useState('')
  const announcedFor = useRef<string | null>(null)

  useEffect(() => {
    if (settledHref === null) return
    if (announcedFor.current === settledHref) return

    const isFirstPaint = announcedFor.current === null
    announcedFor.current = settledHref
    if (isFirstPaint) return

    setAnnouncement(document.title)
  }, [settledHref])

  return (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  )
}
