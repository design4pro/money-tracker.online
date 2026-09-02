import { cn } from '#/lib/cn'

import type { Locale } from '#/lib/i18n'

/**
 * The little square that makes an account recognisable in a list.
 *
 * ## The stored colour never carries the text
 *
 * `accounts.logo_color` is a hex a person picked. Painting initials on it would put the
 * product's 7:1 contract at the mercy of whatever they chose, and no theme fix could rescue it.
 * So the tile is always the neutral sunken surface with `ink` initials — a ratio the tokens
 * guarantee in both themes — and the chosen colour appears as a bar down the leading edge, where
 * it is decoration and nothing depends on reading it.
 *
 * ## The initials are a fallback, not information
 *
 * The tile is `aria-hidden`: the account's name is always beside it as real text, and a screen
 * reader announcing "P W, Personal Wallet" is noise. Derived initials use the reader's locale
 * for the upper-casing, because `i` upper-cases differently in Turkish and a name is exactly the
 * kind of string that catches it.
 */
export interface AccountAvatarProps {
  name: string
  locale: Locale
  /** `accounts.logo_initials`, when somebody set one. */
  initials?: string | null
  /** `accounts.logo_color`, a `#rrggbb`. Decoration only. */
  color?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES = {
  sm: 'size-8 text-caption rounded-md',
  md: 'size-10 text-label rounded-lg',
  lg: 'size-12 text-subtitle rounded-lg',
} as const

/** Up to two leading letters of the first two words. */
function initialsOf(name: string, locale: Locale): string {
  const words = name.trim().split(/\s+/u).filter(Boolean)
  if (words.length === 0) {
    return '?'
  }
  const letters = words
    .slice(0, 2)
    .map((word) => [...word][0] ?? '')
    .join('')
  return letters.toLocaleUpperCase(locale)
}

export function AccountAvatar({
  name,
  locale,
  initials,
  color,
  size = 'md',
  className,
}: AccountAvatarProps) {
  const label = initials?.trim() || initialsOf(name, locale)

  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden',
        'bg-surface-sunken font-semibold text-ink select-none',
        SIZES[size],
        className,
      )}
    >
      {color ? (
        <span
          className="absolute inset-y-0 start-0 w-1"
          style={{ backgroundColor: color }}
        />
      ) : null}
      {label}
    </span>
  )
}
