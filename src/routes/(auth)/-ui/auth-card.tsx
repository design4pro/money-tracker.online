import type { ReactNode } from 'react'

export interface AuthCardProps {
  /** The screen's one `<h1>`. Every auth screen has exactly one. */
  title: string
  /** One sentence under the heading. Optional, because two screens do not need one. */
  description?: ReactNode
  children: ReactNode
  /** The way off this screen: the other account action, or a way back. */
  footer?: ReactNode
}

/**
 * The frame all four auth screens are written into.
 *
 * ## Not actually a card
 *
 * There is no border, no elevation and no panel behind it. The column already sits on `canvas`
 * beside a recessed aside, and a floating white card on top of that would be a third surface in a
 * composition that only needs two — `DESIGN.md`'s Flat-At-Rest Rule. What makes this read as a
 * composed screen rather than a form on a page is the *rhythm*: a display-size heading, one line of
 * plain prose, a 28px gap to the fields, and a hairline above whatever comes after.
 *
 * ## One `<h1>`, and it is the screen's own
 *
 * The heading is here rather than in the layout, so navigating between sign-in and sign-up changes
 * the document's heading rather than leaving a generic "Money Tracker" above four different forms.
 * That heading is the first thing a screen-reader user hears after the skip link, and it is the only
 * thing on the page that tells them which of the four screens they landed on.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: AuthCardProps) {
  return (
    <section className="flex w-full flex-col gap-7">
      <header className="flex flex-col gap-2.5">
        <h1 className="text-balance text-display text-ink">{title}</h1>
        {description === undefined ? null : (
          <p className="text-pretty text-body text-ink-2">{description}</p>
        )}
      </header>

      {children}

      {footer === undefined ? null : (
        <footer className="border-t border-border-subtle pt-6 text-label text-ink-2">
          {footer}
        </footer>
      )}
    </section>
  )
}
