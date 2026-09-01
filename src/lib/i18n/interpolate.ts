import { plural } from './plural'

import type { Locale } from './locales'
import type { Message, MessageParams } from './types'

/**
 * Turning a catalogue entry into the string a screen renders: pick the plural
 * branch, then substitute the placeholders.
 *
 * The syntax is one token — `{name}` — and nothing else. No nesting, no
 * formatting directives, no embedded markup. A message layer that grows a
 * grammar grows a parser; every richer need in this product is met by splitting
 * the message or by passing an already-formatted value in.
 *
 * **Numbers are stringified by `String()`, not by `Intl`.** Money, dates and
 * percentages have their own formatters (`src/lib/money`, `src/lib/i18n/format.ts`)
 * that know the currency's `digits` and the reader's locale; a raw `{count}`
 * substituted here is a bare integer on purpose. Pass a formatted value in as a
 * string when the sentence needs one.
 */

/** `{count}`, `{name}`, `{account_name}` — letters, digits and underscore only. */
const TOKEN = /\{([A-Za-z0-9_]+)\}/g

/**
 * Substitutes `{name}` tokens. An unknown token is left exactly as written
 * rather than blanked, so a mismatch between the two catalogues shows up as
 * visible damage in review instead of a silently missing word — and
 * `__tests__/parity.test.ts` fails on it long before that, by comparing each
 * locale's token set with English's.
 *
 * Presence is decided by `Object.hasOwn` rather than by an `undefined` check: a
 * params bag is an ordinary object literal, so `params.constructor` answers
 * with the `Object` constructor and a `{constructor}` token would render
 * `function Object() { [native code] }` into a sentence. Notification params
 * come out of a D1 JSON column, so the key is not always ours.
 */
export function interpolate(
  template: string,
  params?: MessageParams | undefined,
): string {
  if (params === undefined || !template.includes('{')) {
    return template
  }
  return template.replace(TOKEN, (token, name: string) => {
    if (!Object.hasOwn(params, name)) {
      return token
    }
    const value = params[name]
    return value === undefined ? token : String(value)
  })
}

/**
 * Resolves a catalogue entry against a locale and a parameter bag.
 *
 * A plural message falls back to its `other` branch when the locale's category
 * has no entry, which is the CLDR-sanctioned default and keeps a catalogue
 * honest without making every author write six branches. The parity gate is
 * what stops that fallback from ever being reached in shipped copy.
 */
export function resolveMessage(
  message: Message,
  locale: Locale,
  params?: MessageParams | undefined,
): string {
  if (typeof message === 'string') {
    return interpolate(message, params)
  }
  const count = params?.count
  const category =
    typeof count === 'number' ? plural(locale, count) : ('other' as const)
  return interpolate(message[category] ?? message.other, params)
}
