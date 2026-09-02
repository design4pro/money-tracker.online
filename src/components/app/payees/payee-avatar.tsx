import { cn } from '#/lib/cn'

import type { Locale } from '#/lib/i18n'

/**
 * The little disc that makes a payee recognisable in a list.
 *
 * ## The stored colour never carries the text
 *
 * `payees.logo_color` is a hex somebody picked. Painting initials on it would put the product's
 * 7:1 contract at the mercy of that choice, and no theme fix could rescue it. So the disc is the
 * neutral sunken surface with `ink` initials - a ratio the tokens guarantee in both themes - and
 * the chosen colour is a ring around it, where it is decoration and nothing depends on reading it.
 *
 * ## It is decoration, always
 *
 * `aria-hidden`, because the payee's name is beside it as real text every time this is rendered.
 * A screen reader announcing "Ż, Żabka" is noise. Initials are upper-cased with the reader's
 * locale, because `i` upper-cases differently in Turkish and a name is exactly the kind of string
 * that catches it.
 */
export interface PayeeAvatarProps {
  name: string
  locale: Locale
  /** `payees.logo_initials`, when somebody set one. */
  initials?: string | null
  /** `payees.logo_color`, a `#rrggbb`. Decoration only. */
  color?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES = {
  sm: 'size-8 text-caption',
  md: 'size-10 text-label',
  lg: 'size-12 text-subtitle',
} as const

/** Up to two leading letters of the first two words. */
function initialsOf(name: string, locale: Locale): string {
  const words = name.trim().split(/\s+/u).filter(Boolean)
  if (words.length === 0) return '?'
  return words
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
    .toLocaleUpperCase(locale)
}

export function PayeeAvatar({
  name,
  locale,
  initials,
  color,
  size = 'md',
  className,
}: PayeeAvatarProps) {
  const shown =
    initials !== null && initials !== undefined && initials.trim() !== ''
      ? initials.trim().slice(0, 4)
      : initialsOf(name, locale)

  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-surface-sunken font-semibold text-ink select-none',
        'border-2',
        SIZES[size],
        className,
      )}
      style={{ borderColor: color ?? 'transparent' }}
    >
      {shown}
    </span>
  )
}
