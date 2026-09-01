import { DEFAULT_LOCALE, LOCALE_TAGS } from './locales'

import type { Locale } from './locales'

/**
 * Locale negotiation:
 *
 *   user preference → workspace default → `Accept-Language` → `en`
 *
 * **This module is pure.** It reads no request, no cookie and no `navigator`.
 * The caller passes the three inputs in and gets one tag back, which is what
 * lets the same function run in the Worker before first paint and in a unit
 * test without a fake request. It also sidesteps a trap: `navigator.language`
 * exists in workerd and is hard-coded to `'en'`, so isomorphic code that
 * consults it answers differently on the two sides of the wire and every
 * Polish visitor gets a hydration mismatch on the whole document.
 *
 * **`Accept-Language` is untrusted input.** It arrives from the network, it is
 * attacker-controlled in full, and it is never reflected back into a response,
 * a log line or an error message — this module only ever answers with one of
 * the tags in `LOCALE_TAGS`. Parsing is bounded in both length and entry count
 * so a 16 KB header of nothing but hyphens cannot spend the Worker's CPU
 * budget, and a malformed entry is dropped rather than throwing.
 *
 * **Stored tags are normalised, not trusted either.** `user_preferences.locale`
 * and `organization_settings.locale` are text columns; a row written before the
 * picker existed can hold `en-GB` or `pl_PL`. A plain membership test would
 * answer "unsupported" for those and drop the reader to `Accept-Language`, so a
 * tag is matched case-insensitively and then by BCP-47 truncation:
 * `en-GB` → `en`, `pl-PL` → `pl`. What truncation cannot reach is unsupported,
 * and unsupported means the next step of the chain — never a guess.
 */

const CANONICAL_BY_LOWER = new Map<string, Locale>(
  LOCALE_TAGS.map((tag) => [tag.toLowerCase(), tag]),
)

/**
 * How much of an over-long tag `resolveLocaleTag` considers.
 *
 * RFC 5646 caps a registered language tag well below this. The bound is here
 * because truncation walks one subtag at a time and this function runs on the
 * request path for every visitor.
 *
 * It bounds the *work*, not the answer: an over-long tag is truncated toward
 * its prefix like any other, because `en-GB-oed-x-` followed by a kilobyte of
 * junk is still an English speaker.
 */
const MAX_TAG_LENGTH = 64

/**
 * How many `Accept-Language` entries are considered.
 *
 * Real clients send fewer than ten. The cap is what stops a header of ten
 * thousand comma-separated entries from turning one request into ten thousand
 * truncation walks, and it is applied *before* any per-entry work.
 */
const MAX_HEADER_ENTRIES = 32

/** The whole header, past which nothing is even split. */
const MAX_HEADER_LENGTH = 2048

/**
 * Canonicalises one tag to a shipped locale, or returns `null` if the product
 * has nothing to offer it.
 *
 * Underscores are folded to hyphens first: `pl_PL` is not valid BCP-47, but it
 * is what a Java or PHP client sends and what an older settings row may hold,
 * and rejecting it would send a Polish reader to English for a punctuation
 * mark.
 */
export function resolveLocaleTag(
  tag: string | null | undefined,
): Locale | null {
  if (typeof tag !== 'string') {
    return null
  }
  const lower = tag.trim().toLowerCase().replaceAll('_', '-')
  if (lower === '' || lower === '*') {
    return null
  }
  const bounded =
    lower.length > MAX_TAG_LENGTH ? lower.slice(0, MAX_TAG_LENGTH) : lower
  // `en-gb` → `en`, dropping one subtag per pass. A prefix cut mid-subtag simply
  // fails to match and the next pass lands on a hyphen boundary, so the walk is
  // the same one every other tag gets.
  for (
    let end = bounded.length;
    end > 0;
    end = bounded.lastIndexOf('-', end - 1)
  ) {
    const hit = CANONICAL_BY_LOWER.get(bounded.slice(0, end))
    if (hit !== undefined) {
      return hit
    }
  }
  return null
}

const QUALITY = /^\s*q\s*=\s*(\S*)\s*$/i

/**
 * The `q=` weight of one header entry. An absent `q` means 1, as RFC 9110
 * §12.4.2 says; a `q` that is present but not a number means 0, because a
 * client that sent gibberish has told us nothing and should not outrank one
 * that was clear.
 */
function qualityOf(parameters: ReadonlyArray<string>): number {
  for (const parameter of parameters) {
    const match = QUALITY.exec(parameter)
    if (match !== null) {
      const parsed = Number.parseFloat(match[1])
      return Number.isFinite(parsed) ? parsed : 0
    }
  }
  return 1
}

/**
 * The tags in an `Accept-Language` header, best first.
 *
 * Quality values order the list and `q=0` means "explicitly not this". Ties
 * keep the order they were sent in, which is what the header means by listing
 * them. The returned strings are raw header fragments and are only ever fed
 * back into `resolveLocaleTag` — never rendered, never logged.
 */
export function parseAcceptLanguage(
  header: string | null | undefined,
): ReadonlyArray<string> {
  if (typeof header !== 'string') {
    return []
  }
  const bounded =
    header.length > MAX_HEADER_LENGTH
      ? header.slice(0, MAX_HEADER_LENGTH)
      : header
  if (bounded.trim() === '') {
    return []
  }
  const ranked = bounded
    .split(',', MAX_HEADER_ENTRIES)
    .map((part, index) => {
      const [tag, ...parameters] = part.split(';')
      return { tag: tag.trim(), index, weight: qualityOf(parameters) }
    })
    .filter((entry) => entry.tag !== '' && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)

  return ranked.map((entry) => entry.tag)
}

/** The three inputs negotiation consults, in the order it consults them. */
export interface LocalePreferences {
  /** `user_preferences.locale` — the reader's own override. May be absent. */
  readonly user?: string | null
  /** `organization_settings.locale` — the workspace default. */
  readonly workspace?: string | null
  /** The raw request header. Untrusted, and never reflected back. */
  readonly acceptLanguage?: string | null
}

/**
 * Resolves the locale for one request. Always returns a shipped tag, so the
 * caller never has to decide what to do with a miss.
 */
export function negotiate(preferences: LocalePreferences): Locale {
  const stored =
    resolveLocaleTag(preferences.user) ??
    resolveLocaleTag(preferences.workspace)
  if (stored !== null) {
    return stored
  }
  for (const tag of parseAcceptLanguage(preferences.acceptLanguage)) {
    const offered = resolveLocaleTag(tag)
    if (offered !== null) {
      return offered
    }
  }
  return DEFAULT_LOCALE
}
