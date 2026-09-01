import { useState } from 'react'
import { cva } from 'class-variance-authority'

import { cn } from '#/lib/cn'

import type { VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'

export const avatarVariants = cva(
  'relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-surface-sunken font-semibold text-ink-2 select-none',
  {
    variants: {
      size: {
        xs: 'size-5 text-micro',
        sm: 'size-6 text-micro',
        md: 'size-8 text-caption',
        lg: 'size-10 text-label',
        xl: 'size-14 text-subtitle',
      },
    },
    defaultVariants: { size: 'md' },
  },
)

export interface AvatarProps extends VariantProps<typeof avatarVariants> {
  /** The person's or workspace's name. Used for the initials and the alt text. */
  name: string
  src?: string | null
  className?: string
  /**
   * When the avatar sits directly beside the same name in text, the image is
   * duplicate information. Set this and the whole thing becomes decorative.
   */
  isDecorative?: boolean
}

/**
 * Derive at most two initials from a name.
 *
 * `Intl.Segmenter` with `granularity: 'grapheme'` rather than `[...str]` or
 * `charAt`: a name can begin with an emoji, a Devanagari cluster or a combining
 * accent, and slicing by code point splits those into halves that render as
 * replacement boxes. Polish names are the easy case here; the workspace names
 * users actually type are not.
 */
function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  if (words.length === 0) return ''

  const segmenter =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : undefined

  return words
    .map((word) => {
      if (!segmenter) return word.slice(0, 1)
      const first = segmenter.segment(word)[Symbol.iterator]().next()
      return first.done ? '' : first.value.segment
    })
    .join('')
    .toLocaleUpperCase()
}

/**
 * A person or workspace avatar.
 *
 * The initials fallback is rendered rather than the image whenever the image is
 * absent or fails, and the failure is handled with `onError` rather than with a
 * CSS trick — a broken `<img>` shows the browser's own placeholder and its alt
 * text, which is not the same picture at all.
 *
 * The image carries the name as its alt text unless `isDecorative` is set,
 * because an avatar beside its own name in a member list is the textbook case
 * of an image a screen reader should skip.
 */
export function Avatar({
  name,
  src,
  size,
  className,
  isDecorative = false,
}: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(src) && !failed

  return (
    <span className={cn(avatarVariants({ size }), className)}>
      {showImage ? (
        <img
          src={src ?? undefined}
          alt={isDecorative ? '' : name}
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <>
          <span aria-hidden="true">{initialsFrom(name)}</span>
          {isDecorative ? null : <span className="sr-only">{name}</span>}
        </>
      )}
    </span>
  )
}

export interface AvatarGroupProps {
  children: ReactNode
  className?: string
}

/**
 * Overlapping avatars. The overlap is decoration; the names still reach a
 * screen reader one by one, in order, from each `Avatar`'s own text.
 */
export function AvatarGroup({ children, className }: AvatarGroupProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center -space-x-2 [&>*]:ring-2 [&>*]:ring-surface',
        className,
      )}
    >
      {children}
    </span>
  )
}
