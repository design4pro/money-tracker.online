import type { PluralCategory } from './plural'

/**
 * The English catalogue, imported for its type alone. This import is what makes
 * `messages/en.ts` the schema; it is erased at build time, so nothing about the
 * English copy reaches a Polish reader's bundle.
 */
import type En from './messages/en'

/**
 * The message format and the types that make `t()` safe.
 *
 * There is no i18n package here and none is coming — the dependency freeze is a
 * spec clause, and the format below is deliberately the smallest thing that
 * covers a finance product:
 *
 * - a message is a string with `{name}` placeholders, or
 * - a plural message: an object keyed by CLDR plural category, whose branch is
 *   chosen by `plural()` from the `count` parameter.
 *
 * **English is the schema.** `MessageKey` is derived from `messages/en.ts` and
 * nothing else decides what a key is. A key that does not exist is a compile
 * error rather than a runtime fallback to English, and the placeholder names
 * are read straight out of the English string's literal type, so a message with
 * a `{name}` cannot be rendered without one.
 *
 * Keys are dotted and grouped by surface — `nav.dashboard`, `accounts.title`,
 * `validation.amount.required`. The prefix is a convention that tells a reader
 * which screen a key belongs to; it is not a namespace the loader knows about.
 *
 * Authoring English:
 *
 * ```ts
 * const messages = {
 *   'nav.accounts': 'Accounts',
 *   'accounts.count': { one: '{count} account', other: '{count} accounts' },
 * } as const satisfies MessageCatalogueSource
 * export default messages
 * ```
 *
 * `as const` is load-bearing: it keeps each value a string literal type, and
 * that literal is what the placeholder names are read out of. Translating:
 *
 * ```ts
 * import type En from './en'
 * const messages = { 'nav.accounts': 'Konta', … } satisfies TranslationOf<typeof En>
 * export default messages
 * ```
 */

/** What may be substituted into a placeholder. */
export type MessageParamValue = string | number

/**
 * A message with one branch per CLDR plural category. `other` is mandatory
 * because every locale has it; the rest are present only where the locale's
 * rules produce them (`pl` uses `one`, `few`, `many` and `other`; `en` two).
 */
export interface PluralMessage {
  readonly zero?: string
  readonly one?: string
  readonly two?: string
  readonly few?: string
  readonly many?: string
  readonly other: string
}

/** Either shape a catalogue entry may take. */
export type Message = string | PluralMessage

/** What one `messages/<locale>.ts` file default-exports. */
export type MessageCatalogueSource = Readonly<Record<string, Message>>

/**
 * A translated catalogue, checked against the English one it was made from:
 * same keys, no more and no fewer, each free to say something different.
 */
export type TranslationOf<TSource extends MessageCatalogueSource> = {
  readonly [K in keyof TSource]: Message
}

/**
 * One locale's messages as the runtime holds them.
 *
 * Deliberately a string-keyed bag rather than `Record<MessageKey, Message>`: a
 * catalogue is loaded at run time through `import.meta.glob`, never written as
 * a literal, and a record built by a loop is not assignable to a record of
 * required literal keys without a cast. The key guarantee lives where it can be
 * enforced honestly — in `MessageKey` at the `t()` boundary, and in
 * `__tests__/parity.test.ts` for the catalogue English cannot type.
 */
export type Catalogue = Readonly<Record<string, Message>>

/** Pulls `name` out of `'Signed in as {name}'`. */
type PlaceholdersIn<TTemplate extends string> =
  TTemplate extends `${string}{${infer Name}}${infer Rest}`
    ? Name | PlaceholdersIn<Rest>
    : never

/**
 * The parameters a message needs: its placeholders, plus `count` whenever the
 * message is plural, since that is what selects the branch.
 */
type ParamNamesOf<TMessage> = TMessage extends string
  ? PlaceholdersIn<TMessage>
  : TMessage extends PluralMessage
    ? 'count' | PlaceholdersIn<Extract<TMessage[keyof TMessage], string>>
    : never

/** `count` is always a number; everything else may be a number or a string. */
type ParamsObject<TNames extends string> = {
  readonly [Name in TNames]: Name extends 'count' ? number : MessageParamValue
}

/**
 * The parameter bag as the runtime sees it, once `t()`'s signature has done the
 * checking. Values are optional because a bag reaching `interpolate` may have
 * been built for a different catalogue's version of the same key.
 */
export type MessageParams = Readonly<
  Record<string, MessageParamValue | undefined>
>

/**
 * Renders a key that is only known at run time, with a parameter bag no
 * signature can check — a stored `notifications` row, whose `title_key`,
 * `body_key` and `*_params` are columns in D1.
 *
 * `null` for a key this catalogue does not carry, so the caller decides what to
 * show. It must not be English: a row written against a key that has since been
 * deleted is a data problem, not a reason to switch language mid-page.
 */
export type TranslateStored = (
  key: string,
  params?: MessageParams,
) => string | null

/** Re-exported so a catalogue author needs one import, not two. */
export type { PluralCategory }

/* -------------------------------------------------------------------------- */
/* The typed key surface                                                      */
/* -------------------------------------------------------------------------- */

/** Every key the product can translate. */
export type MessageKey = Extract<keyof typeof En, string>

/** The English message a key points at, with its literal type intact. */
type MessageAt<TKey extends MessageKey> = (typeof En)[TKey]

/**
 * The tail of a `t()` call: empty for a message with no placeholders, a single
 * required params object otherwise.
 *
 * The first branch is what makes a mistyped key readable. When the key argument
 * fails the `MessageKey` constraint, TypeScript keeps going with the constraint
 * itself in place of the inferred literal — and the union as a whole needs
 * parameters, so the call gets reported as `Expected 2 arguments, but got 1`,
 * which says nothing about the key that was actually wrong. Making that case
 * take an optional, loosely-typed bag lets the arity agree at nought parameters
 * and at one, so the error that survives is the one on the argument that is
 * actually wrong.
 *
 * That branch is also reached honestly, by a caller holding a value typed as
 * the whole `MessageKey` union rather than as one literal. No signature can
 * check the parameters of a key that is not known yet, so it takes the bag.
 */
export type TranslateArgs<TKey extends MessageKey> = MessageKey extends TKey
  ? [params?: MessageParams]
  : [ParamNamesOf<MessageAt<TKey>>] extends [never]
    ? []
    : [params: ParamsObject<ParamNamesOf<MessageAt<TKey>>>]

/** The translator handed to components. */
export interface Translate {
  <TKey extends MessageKey>(key: TKey, ...args: TranslateArgs<TKey>): string
}
