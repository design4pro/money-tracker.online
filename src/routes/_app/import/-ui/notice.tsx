import { AlertTriangle, CircleAlert, Info } from 'lucide-react'

import { cn } from '#/lib/cn'

import type { ReactNode } from 'react'

/**
 * A stated thing about the import that is not attached to one control.
 *
 * The four surfaces of this flow all have to say something in place: a file was read through a
 * fallback encoding, a saved mapping was filled in, this import would pass the plan's ceiling, the
 * mapping cannot be confirmed yet. None of those belong in a toast — a toast is dismissible, and
 * every one of these is a condition of the screen it is on rather than an event that happened.
 *
 * ## The icon is the second channel, and `role` is the third
 *
 * Tone is never the only carrier: each variant renders its own glyph and the sentence says the same
 * thing in words. A `problem` is `role="alert"`, because it appears in response to something the
 * person just did and has to be announced without moving focus; the other two are ordinary prose in
 * the reading order, and announcing them would interrupt for something the reader is about to reach
 * anyway.
 */
export type NoticeTone = 'info' | 'warning' | 'problem'

const TONES: Readonly<
  Record<NoticeTone, { readonly box: string; readonly icon: typeof Info }>
> = {
  info: { box: 'border-info/40 bg-info-soft text-ink', icon: Info },
  warning: {
    box: 'border-warning/40 bg-warning-soft text-ink',
    icon: AlertTriangle,
  },
  problem: {
    box: 'border-negative/40 bg-negative-soft text-ink',
    icon: CircleAlert,
  },
}

export interface NoticeProps {
  readonly tone: NoticeTone
  /** An optional heading line above the prose. A real `<strong>`, never a heading level. */
  readonly title?: ReactNode
  readonly children: ReactNode
  readonly className?: string
  readonly id?: string
}

export function Notice({ tone, title, children, className, id }: NoticeProps) {
  const { box, icon: Icon } = TONES[tone]

  return (
    <div
      id={id}
      role={tone === 'problem' ? 'alert' : undefined}
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-caption',
        box,
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        {title === undefined ? null : (
          <strong className="block font-semibold">{title}</strong>
        )}
        <div className="text-ink-2">{children}</div>
      </div>
    </div>
  )
}
