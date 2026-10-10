/**
 * The scrubber: the one place that decides what may leave the server in a payload or a sink.
 *
 * "An amount, a payee name, an account name or a note never reaches a log or Sentry" is true here by
 * construction instead of at every `throw`. The module is **pure, total and bounded**, and it has no
 * imports, so the later callers (the classifier, the redaction middleware, the logger and the Sentry
 * client) cannot create a cycle through it and a test can run it in plain Node.
 *
 * Two entry points, two contracts:
 *
 * - {@link redact} is **default-deny**. Only a key in {@link REDACT_ALLOW_KEYS} keeps a string, and
 *   only when it is id-shaped; every other string, every non-identifier object key and every
 *   amount-shaped substring is replaced by a shape marker. What survives is the shape: a count, a
 *   type, an id.
 * - {@link redactError} reduces an error to its constructor name, a repository error code and up to
 *   twenty stack frames. It never returns a message, a stack header, a `cause`, an aggregate member
 *   or an own property, because `AliasTakenError`, `InvitationAddresseeError` and `InvalidAmountError`
 *   interpolate a name, an email and an amount into their sentence. Its result is **final**: the sinks
 *   do not pass it through {@link redact} again, which would drop every frame.
 *
 * Neither function throws and neither invokes user code of its own. Properties are read through
 * `Object.getOwnPropertyDescriptor` only, so an accessor is reported as `'[getter]'` and never
 * called; `toString`, `toJSON` and `valueOf` are never reached. Two things can still run code, and
 * both are wrapped so that nothing escapes: a Proxy trap (the descriptor, prototype and key reads
 * reach it) and `error.stack`, which the engine implements as an accessor.
 *
 * Narrowing the deny set later is Ask First: a leak cannot be recalled, an over-redacted field can be
 * loosened by a deliberate change.
 */

/**
 * Words that mark a key as holding money, a name, a contact, free text or a secret.
 *
 * A key is split into lower-case words (`camelCase`, `snake_case`, `kebab-case`, ALLCAPS runs) and a
 * word matches when it, or the word without a trailing `s` or `es`, is in this set; so
 * `payee_names`, `Addresses` and `ALIASES` are all denied. The set holds the singular forms.
 */
export const REDACT_DENY_WORDS: ReadonlySet<string> = new Set([
  'amount',
  'minor',
  'balance',
  'limit',
  'rate',
  'note',
  'payee',
  'name',
  'description',
  'iban',
  'email',
  'filename',
  'memo',
  'alias',
  'text',
  'title',
  'label',
  'message',
  'body',
  'content',
  'comment',
  'subject',
  'merchant',
  'counterparty',
  'payer',
  'recipient',
  'phone',
  'address',
  'token',
  'secret',
  'password',
  'cookie',
  'authorization',
  'total',
  'sum',
  'price',
  'cost',
  'fee',
  'value',
  'bic',
  'swift',
  'key',
  'signature',
  'jwt',
])

/**
 * Fragments denied wherever they sit inside the separator-free, lower-cased key, so a glued spelling
 * (`payeename`, `xxtokenyy`) is caught even though it has no word boundary.
 */
export const REDACT_DENY_FRAGMENTS: ReadonlySet<string> = new Set([
  'amount',
  'balance',
  'payee',
  'description',
  'iban',
  'name',
  'token',
])

/**
 * The full keys whose value may be a string. Case-sensitive and exact, never a pattern: a key outside
 * this set loses every string it holds. Each of these holds an id or a closed vocabulary word, and
 * the value must still be id-shaped (see {@link ID_SHAPE}) to survive.
 */
export const REDACT_ALLOW_KEYS: ReadonlySet<string> = new Set([
  'errorName',
  'kind',
  'code',
  'metric',
  'module',
  'organizationId',
  'userId',
  'id',
  'requestId',
  'route',
  'queue',
])

/**
 * A currency amount: an optional sign, an optional currency code or symbol on either side, digits
 * grouped by a space, a no-break space (U+00A0), a narrow no-break space (U+202F), a comma, a dot or
 * an apostrophe, and an optional fraction of one to four digits.
 *
 * Linear time: the only unbounded quantifier is `\d+`, and the `(?<!\d)` before it means it can
 * start only at the beginning of a digit run, so a 100 000-digit string is scanned once. It errs
 * towards removal; a false positive on an id-like string (a date `12.05`) is accepted. It cannot
 * find a bare minor-unit integer, which is why the scrubber never relies on it alone. The flag is
 * `g`, so use it with `String.prototype.replace`, never with `.test`.
 */
export const AMOUNT_PATTERN =
  /[+-]?(?:(?:[A-Z]{3}|\p{Sc})\s?)?(?<!\d)(?:\d{1,3}(?:[ \u00A0\u202F,.']\d{3})+(?:[.,]\d{1,4})?|\d+[.,]\d{1,4})(?:\s?(?:[A-Z]{3}|\p{Sc}|zł))?/gu

/** What survives under an allow-listed key. Bounded at 128, which is also this module's string cap. */
const ID_SHAPE = /^[A-Za-z0-9_.:/$-]{1,128}$/

/**
 * A key that is emitted as written; anything else becomes `[key:N]`. Residual: a record keyed by a
 * single-token user value (`{ Biedronka: 1 }`) emits that key. Callers must not pass a record keyed
 * by user text; the spec states this limit.
 */
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

/** An error name or a repository error code that is safe to emit. */
const SAFE_NAME = IDENTIFIER

/** A key split into words: ALLCAPS runs, capitalised or lower-case words, digit runs. */
const KEY_WORD = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g

/** A strict stack frame; anything else in a stack is a header, a message line or noise. */
const STRICT_FRAME = /^\s+at \S/

const MAX_DEPTH = 8
const MAX_KEYS = 100
const MAX_NODES = 2000
const MAX_FRAMES = 20
const MAX_FRAME_LENGTH = 200
/** Input to the key classifier is cut here; a key this long is not an identifier anyway. */
const MAX_KEY_LENGTH = 256
/** A stack longer than this is cut before it is parsed; a message longer than it fails closed. */
const MAX_STACK_LENGTH = 65_536
/** A frame line is cut here before the amount pattern runs, so the work per frame is bounded. */
const MAX_FRAME_SCAN = 1024

type KeyClass = 'allow' | 'deny' | 'default'

interface Walk {
  /** Nodes left in the budget; a wide, shared structure cannot multiply past it. */
  nodes: number
  /** The objects on the path from the root to here, for cycle detection. */
  path: Set<object>
}

const isDenyWord = (word: string): boolean =>
  REDACT_DENY_WORDS.has(word) ||
  (word.endsWith('s') && REDACT_DENY_WORDS.has(word.slice(0, -1))) ||
  (word.endsWith('es') && REDACT_DENY_WORDS.has(word.slice(0, -2)))

function classifyKey(key: string): KeyClass {
  if (REDACT_ALLOW_KEYS.has(key)) return 'allow'

  const head = key.slice(0, MAX_KEY_LENGTH)
  const words = (head.match(KEY_WORD) ?? []).map((word) => word.toLowerCase())

  if (words[0] === 'ref') return 'deny'
  if (words.some(isDenyWord)) return 'deny'
  for (let i = 0; i + 1 < words.length; i += 1) {
    if (
      words[i] === 'account' &&
      (words[i + 1] === 'number' || words[i + 1] === 'numbers')
    ) {
      return 'deny'
    }
  }

  const glued = head.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const fragment of REDACT_DENY_FRAGMENTS) {
    if (glued.includes(fragment)) return 'deny'
  }
  return 'default'
}

/** The marker that stands for a value whose content must not leave. */
function shapeOf(value: unknown): string {
  if (Array.isArray(value)) return `[array:${arrayLength(value)}]`
  if (value === null) return '[redacted:null]'
  return `[redacted:${typeof value}]`
}

function arrayLength(value: unknown[]): number {
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
  return typeof length === 'number' ? length : 0
}

/** Reads an own data property without invoking a getter; `undefined` for an accessor or a miss. */
function ownData(target: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  return descriptor !== undefined && 'value' in descriptor
    ? descriptor.value
    : undefined
}

const SIZE_OF_MAP = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get
const SIZE_OF_SET = Object.getOwnPropertyDescriptor(Set.prototype, 'size')?.get

/** The constructor name of an error, or `'Error'` when it is not an identifier. Calls nothing. */
function errorName(error: Error): string {
  const prototype = Object.getPrototypeOf(error)
  const constructor =
    prototype !== null && typeof prototype === 'object'
      ? ownData(prototype, 'constructor')
      : undefined
  const name =
    typeof constructor === 'function' ? ownData(constructor, 'name') : undefined
  return typeof name === 'string' && SAFE_NAME.test(name) ? name : 'Error'
}

/** The repository error code, kept only when it is an own string that is an identifier. */
function errorCode(error: Error): string | undefined {
  const code = ownData(error, 'code')
  return typeof code === 'string' && SAFE_NAME.test(code) ? code : undefined
}

function identityOf(error: Error): { name: string; code?: string } {
  const code = errorCode(error)
  return code === undefined
    ? { name: errorName(error) }
    : { name: errorName(error), code }
}

/** A string under an allow-listed key: only an id-shaped one survives, with amounts struck out. */
function allowedString(value: string): string {
  if (value.length > 128 || !ID_SHAPE.test(value)) return '[redacted:string]'
  return value.replace(AMOUNT_PATTERN, '[amount]')
}

function redactObject(object: object, depth: number, walk: Walk): unknown {
  if (object instanceof Error) return identityOf(object)
  if (object instanceof Map) return `[Map:${SIZE_OF_MAP?.call(object) ?? 0}]`
  if (object instanceof Set) return `[Set:${SIZE_OF_SET?.call(object) ?? 0}]`
  if (object instanceof Date) return '[Date]'
  if (ArrayBuffer.isView(object) || object instanceof ArrayBuffer)
    return '[binary]'
  if (walk.path.has(object)) return '[circular]'
  if (depth >= MAX_DEPTH) return '[truncated]'

  walk.path.add(object)
  try {
    const out: Record<string, unknown> = {}
    const keys = Reflect.ownKeys(object).filter(
      (key): key is string => typeof key === 'string',
    )
    for (const [index, key] of keys.slice(0, MAX_KEYS).entries()) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key)
      if (descriptor === undefined || descriptor.enumerable !== true) continue
      const emitted = IDENTIFIER.test(key) ? key : `[key:${index}]`
      if (!('value' in descriptor)) {
        out[emitted] = '[getter]'
        continue
      }
      const value = redactValue(
        descriptor.value,
        classifyKey(key),
        depth + 1,
        walk,
      )
      if (value !== undefined) out[emitted] = value
    }
    if (keys.length > MAX_KEYS) out['[more]'] = keys.length - MAX_KEYS
    return out
  } finally {
    walk.path.delete(object)
  }
}

function redactValue(
  value: unknown,
  keyClass: KeyClass,
  depth: number,
  walk: Walk,
): unknown {
  if (value === undefined) return undefined
  if (walk.nodes <= 0) return '[truncated]'
  walk.nodes -= 1

  switch (typeof value) {
    case 'string':
      return keyClass === 'allow' ? allowedString(value) : '[redacted:string]'
    case 'number':
      return '[redacted:number]'
    case 'boolean':
      return keyClass === 'deny' ? '[redacted:boolean]' : value
    case 'bigint':
      return '[bigint]'
    case 'symbol':
      return '[symbol]'
    case 'function':
      return '[function]'
    default:
      break
  }

  if (value === null) return keyClass === 'deny' ? shapeOf(value) : null

  try {
    // Inside the guard: `Array.isArray` throws on a revoked Proxy.
    if (Array.isArray(value)) return shapeOf(value)
    if (keyClass === 'deny') return '[redacted:object]'
    return redactObject(value as object, depth, walk)
  } catch {
    // A Proxy trap, a revoked Proxy: the value could not be read without running someone else's code.
    return '[unreadable]'
  }
}

/**
 * Reduces any value to what may leave the server in a payload or a sink. Default-deny: see the
 * module comment. Total and bounded: it never throws and it never invokes user code.
 */
export function redact(value: unknown): unknown {
  try {
    return redactValue(value, 'default', 0, {
      nodes: MAX_NODES,
      path: new Set(),
    })
  } catch {
    return '[unreadable]'
  }
}

export interface RedactedError {
  name: string
  code?: string
  frames: string[]
}

/** An empty message renders a bare name, or `Name: ` under some stack formatters, and nothing else. */
const EMPTY_MESSAGE_HEADER = /^[^:]*(?::\s*)?$/

/**
 * The part of the stack after its header, or `undefined` when the header cannot be trusted.
 *
 * The header is `Name: message` and nothing else: one line before the message, and the message runs
 * to the end of the header. Anything different is a stale header (the message was changed after
 * `stack` was read) or came from a `message` getter on the prototype, which the descriptor read does
 * not see; its old message could still hold a line shaped like a frame, so fail closed.
 */
function bodyAfterHeader(text: string, message: string): string | undefined {
  const newline = text.indexOf('\n')
  if (message === '') {
    if (newline < 0 || !EMPTY_MESSAGE_HEADER.test(text.slice(0, newline)))
      return undefined
    return text.slice(newline + 1)
  }

  const headerEnd = newline < 0 ? text.length : newline
  // The message starts the stack (no name) or follows the first `: ` of the first line.
  for (let at = 0; at <= headerEnd;) {
    if (text.startsWith(message, at)) {
      const rest = text.slice(at + message.length)
      return rest === '' || rest.startsWith('\n') ? rest : undefined
    }
    const colon = text.indexOf(': ', at)
    if (colon < 0 || colon >= headerEnd) return undefined
    at = colon + 2
  }
  return undefined
}

/**
 * The stack's frames, and only its frames.
 *
 * The header (`Name: message`) is what carries the message, and the message may itself hold a newline
 * and a line shaped like a frame. So everything up to the end of the *current* message is cut off
 * first, and only then is each remaining line kept if it is a strict frame. A message that was
 * changed after construction is not in the stack, so the header's extent is unknown: fail closed.
 *
 * One case cannot be told apart from a genuine header by looking at the stack: a multi-line message
 * whose later lines look like frames, shortened to its leading lines *after* `stack` was first read
 * (the header is rendered on that read). The shortened message is then a clean prefix of the stale
 * header and the old lines are read as frames. That needs a layer that both reads `stack` and then
 * rewrites `message`; the stage that logs an error reads it once, from a fresh object.
 */
function framesOf(error: Error): string[] {
  let stack: unknown
  try {
    stack = error.stack
  } catch {
    return []
  }
  if (typeof stack !== 'string') return []

  const descriptor = Object.getOwnPropertyDescriptor(error, 'message')
  let message = ''
  if (descriptor !== undefined) {
    if (!('value' in descriptor) || typeof descriptor.value !== 'string')
      return []
    message = descriptor.value
  }

  const text = stack.slice(0, MAX_STACK_LENGTH)
  const body = bodyAfterHeader(text, message)
  if (body === undefined) return []

  const frames: string[] = []
  for (const line of body.split('\n')) {
    if (!STRICT_FRAME.test(line)) continue
    frames.push(
      line
        .trim()
        .slice(0, MAX_FRAME_SCAN)
        .replace(AMOUNT_PATTERN, '[amount]')
        .slice(0, MAX_FRAME_LENGTH),
    )
    if (frames.length === MAX_FRAMES) break
  }
  return frames
}

/**
 * Reduces a thrown value to its constructor name, a repository error code and up to twenty stack
 * frames. Never the message, the stack header, a `cause`, an aggregate member or an own property.
 * Final output: not to be passed through {@link redact}.
 */
export function redactError(error: unknown): RedactedError {
  try {
    if (!(error instanceof Error)) return { name: 'NonError', frames: [] }
    return { ...identityOf(error), frames: framesOf(error) }
  } catch {
    return { name: 'Error', frames: [] }
  }
}
