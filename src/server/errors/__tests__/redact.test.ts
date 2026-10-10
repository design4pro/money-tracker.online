/**
 * The scrubber: what may leave the server in a payload or a sink.
 *
 * `redact.ts` has no imports and no repository behind it, so there is no tenant-isolation case; this
 * file is the money invariant for the failure layer (plan stage `05-S1`, phase 1): an amount, a payee
 * name, an address, an alias, an email, an IBAN or a token never reaches a log, a report or the
 * browser. The deny set, the long-fragment list and the allow-list are exported read-only sets, so the
 * cases below iterate them instead of copying them.
 */

import { describe, expect, it } from 'vitest'

import {
  AMOUNT_PATTERN,
  REDACT_ALLOW_KEYS,
  REDACT_DENY_FRAGMENTS,
  REDACT_DENY_WORDS,
  redact,
  redactError,
} from '../redact'

const wire = (value: unknown): string => JSON.stringify(redact(value))

/** The single value of a one-key object, whatever the key was emitted as (`[key:0]` for `a-b`). */
const only = (value: unknown): unknown =>
  Object.values(redact(value) as Record<string, unknown>)[0]

const capitalise = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1)

const plural = (word: string): string =>
  word.endsWith('s') ? `${word}es` : `${word}s`

/** Every spelling of a two-word key the scrubber has to read as the same two words. */
const spellings = (first: string, second: string): string[] => [
  `${first}${capitalise(second)}`,
  `${first}_${second}`,
  `${first}-${second}`,
  `${first}${second}`,
  `${first.toUpperCase()}${second.toUpperCase()}`,
  `${first.toUpperCase()}_${second.toUpperCase()}`,
  `${first}${capitalise(plural(second))}`,
]

const SECOND_PER_ALLOW_KEY = 'Biedronka Sp. z o.o.'
const ID = 'abc-123_X.y:z/$'

describe('redact: an amount never survives', () => {
  it.each([
    'amountMinor',
    'amount_minor',
    'amount-minor',
    'amounts',
    'amountminor',
    'AMOUNT',
    'AMOUNT_MINOR',
    'AmountMinor',
    'ref_amount_minor',
    'refAmountMinor',
    'ref_anything',
    'balance',
    'balances',
    'balanceMinor',
    'account_balance',
    'accountNumber',
    'account_numbers',
  ])('denies the key %s by its name, not by the value type', (key) => {
    // An object value is told apart from the default-deny rule, which would recurse into it.
    expect(only({ [key]: { inner: 987_654 } })).toBe('[redacted:object]')
    expect(only({ [key]: 987_654 })).toBe('[redacted:number]')
    expect(wire({ [key]: 987_654 })).not.toContain('987654')
  })

  it('reduces an array of amounts to its count', () => {
    expect(redact({ amounts: [1, 2] })).toEqual({ amounts: '[array:2]' })
  })

  it.each(['paid 12,34 zł', 'EUR 1 234.50', '12 345,67', '12 345,67'])(
    'removes the amount string %j wherever it sits',
    (amount) => {
      expect(redact(amount)).toBe('[redacted:string]')
      expect(redact({ somethingElse: amount })).toEqual({
        somethingElse: '[redacted:string]',
      })
      expect(wire({ nested: { deeper: { note: amount } } })).not.toMatch(/\d/)
    },
  )

  it.each([
    ['paid 12,34 zł'],
    ['EUR 1 234.50'],
    ['EUR1234,50'],
    ['12 345,67'],
    ['12 345,67'],
    ['1,234.56'],
    ["1'234.50"],
    ['-12.50'],
    ['+99.99'],
    ['$99.99'],
    ['1 234 567,8'],
    ['1.234.567,89'],
    ['0.5'],
  ])('AMOUNT_PATTERN replaces every digit of %j', (text) => {
    const cleaned = text.replace(AMOUNT_PATTERN, '[amount]')
    expect(cleaned).toContain('[amount]')
    expect(cleaned).not.toMatch(/\d/)
  })

  it('also strips an amount from an id-shaped string under an allow-listed key', () => {
    expect(redact({ id: '12.50' })).toEqual({ id: '[amount]' })
    expect(redact({ code: 'E_1234.5678' })).toEqual({ code: 'E_[amount]' })
  })

  it('leaves an id that only looks numeric alone', () => {
    expect(redact({ id: '3f2a9c10-77ab-4d0e-9a11-0123456789ab' })).toEqual({
      id: '3f2a9c10-77ab-4d0e-9a11-0123456789ab',
    })
    expect(redact({ requestId: '12345' })).toEqual({ requestId: '12345' })
  })

  it('removes an amount inside a queue-envelope shaped object', () => {
    const envelope = {
      kind: 'ledger.rebuild',
      organizationId: 'org_1',
      payload: {
        transactions: [{ amountMinor: 424_242 }],
        refAmountMinor: 424_242,
        line: { amount_minor: 424_242, payee: { name: 'Biedronka' } },
      },
    }
    const out = wire(envelope)
    expect(out).not.toContain('424242')
    expect(out).not.toContain('Biedronka')
    expect(JSON.parse(out)).toEqual({
      kind: 'ledger.rebuild',
      organizationId: 'org_1',
      payload: {
        transactions: '[array:1]',
        refAmountMinor: '[redacted:number]',
        line: { amount_minor: '[redacted:number]', payee: '[redacted:object]' },
      },
    })
  })
})

describe('redact: a name, an address, a contact or a secret never survives', () => {
  it('removes a payee name under every spelling of the key', () => {
    for (const key of spellings('payee', 'name')) {
      expect(only({ [key]: 'Biedronka' }), key).toBe('[redacted:string]')
      expect(only({ [key]: { name: 'Biedronka' } }), key).toBe(
        '[redacted:object]',
      )
      expect(wire({ [key]: 'Biedronka' }), key).not.toContain('Biedronka')
    }
    expect(redact({ payee: { name: 'x' } })).toEqual({
      payee: '[redacted:object]',
    })
    expect(redact({ payee_names: ['x'] })).toEqual({ payee_names: '[array:1]' })
  })

  it.each([
    ['address', 'addresses'],
    ['alias', 'aliases'],
    ['email', 'emails'],
    ['iban', 'ibans'],
    ['token', 'tokens'],
  ])('denies %s and its plural %s as an object value', (word, many) => {
    expect(redact({ [word]: { inner: 1 } })).toEqual({
      [word]: '[redacted:object]',
    })
    expect(redact({ [many]: { inner: 1 } })).toEqual({
      [many]: '[redacted:object]',
    })
    expect(redact({ [many]: ['x', 'y', 'z'] })).toEqual({ [many]: '[array:3]' })
  })

  it('denies every word of the exported deny set, in every spelling and plural', () => {
    expect(REDACT_DENY_WORDS.size).toBeGreaterThan(20)
    for (const word of REDACT_DENY_WORDS) {
      for (const key of [
        word,
        capitalise(word),
        word.toUpperCase(),
        plural(word),
        `my_${word}`,
        `my-${plural(word)}`,
        `my${capitalise(word)}`,
        `my${capitalise(plural(word))}Thing`,
        `${word.toUpperCase()}_VALUE`,
      ]) {
        // An object value is told apart from the default-deny rule, which would recurse into it.
        expect(only({ [key]: { inner: 1 } }), key).toBe('[redacted:object]')
      }
    }
  })

  it('denies a glued key that contains an exported long fragment', () => {
    expect(REDACT_DENY_FRAGMENTS.size).toBeGreaterThan(3)
    for (const fragment of REDACT_DENY_FRAGMENTS) {
      for (const key of [
        `xx${fragment}yy`,
        `xx${fragment.toUpperCase()}`,
        `${fragment}zz`,
      ]) {
        expect(only({ [key]: { inner: 1 } }), key).toBe('[redacted:object]')
      }
    }
  })

  it('does not deny a key that merely looks close', () => {
    expect(redact({ status: { inner: 1 } })).toEqual({
      status: { inner: '[redacted:number]' },
    })
    expect(redact({ plan: { inner: true } })).toEqual({ plan: { inner: true } })
  })

  it.each([
    ['lastname', 'Kowalski'],
    ['owner', 'PL61109010140000071219812874'],
    ['thing', 'Salary.pdf'],
    ['whatever', 'a'.repeat(40)],
    ['x', 'Biedronka Sp. z o.o.'],
    ['y', 'jan@example.com'],
  ])(
    'removes the string under the invented key %s by default',
    (key, value) => {
      expect(redact({ [key]: value })).toEqual({ [key]: '[redacted:string]' })
      expect(wire({ [key]: value })).not.toContain(value)
    },
  )

  it('emits [key:N] for a key that is not an identifier and keeps no payee', () => {
    const record: Record<string, unknown> = {
      'Biedronka Sp. z o.o.': 'x',
      'Some Header': { inner: 'Kowalski' },
      ünïcode: 1,
    }
    const out = redact(record)
    expect(out).toEqual({
      '[key:0]': '[redacted:string]',
      '[key:1]': { inner: '[redacted:string]' },
      '[key:2]': '[redacted:number]',
    })
    expect(wire(record)).not.toContain('Biedronka')
    expect(wire(record)).not.toContain('Kowalski')
  })

  it('numbers the replaced keys by position so two of them never collide', () => {
    const out = redact({ 'a b': 1, ok: 2, 'c d': 3 }) as Record<string, unknown>
    expect(Object.keys(out)).toEqual(['[key:0]', 'ok', '[key:2]'])
  })

  it('reduces an array under a denied key to its count', () => {
    expect(redact({ notes: ['a', 'b', 'c'] })).toEqual({ notes: '[array:3]' })
    expect(redact({ unknownList: ['a', 'b'] })).toEqual({
      unknownList: '[array:2]',
    })
  })
})

describe('redact: the allow-list', () => {
  it('is exactly the set of full keys the spec names, so widening it is a deliberate edit', () => {
    expect([...REDACT_ALLOW_KEYS].sort()).toEqual(
      [
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
      ].sort(),
    )
  })

  it('keeps an id-shaped string under every allow-listed key', () => {
    for (const key of REDACT_ALLOW_KEYS) {
      expect(redact({ [key]: ID }), key).toEqual({ [key]: ID })
    }
  })

  it('loses a number, a string with a space and an overlong string under every allow-listed key', () => {
    for (const key of REDACT_ALLOW_KEYS) {
      expect(redact({ [key]: 12_345 }), key).toEqual({
        [key]: '[redacted:number]',
      })
      expect(redact({ [key]: SECOND_PER_ALLOW_KEY }), key).toEqual({
        [key]: '[redacted:string]',
      })
      expect(redact({ [key]: 'a'.repeat(129) }), key).toEqual({
        [key]: '[redacted:string]',
      })
      expect(redact({ [key]: 'a'.repeat(128) }), key).toEqual({
        [key]: 'a'.repeat(128),
      })
      expect(redact({ [key]: '' }), key).toEqual({ [key]: '[redacted:string]' })
      expect(redact({ [key]: 'a,b' }), key).toEqual({
        [key]: '[redacted:string]',
      })
    }
  })

  it('is evaluated before the deny rule and still checks the id shape', () => {
    // `errorName` holds the deny word `name`.
    expect(redact({ errorName: 'AliasTakenError' })).toEqual({
      errorName: 'AliasTakenError',
    })
    expect(redact({ errorName: 'Kowalski Jan' })).toEqual({
      errorName: '[redacted:string]',
    })
  })

  it('matches the key exactly and case-sensitively', () => {
    expect(redact({ Id: 'abc' })).toEqual({ Id: '[redacted:string]' })
    expect(redact({ user_id: 'abc' })).toEqual({ user_id: '[redacted:string]' })
    expect(redact({ idx: 'abc' })).toEqual({ idx: '[redacted:string]' })
  })
})

describe('redact: shapes', () => {
  it('lets a boolean and null survive and drops undefined', () => {
    expect(
      redact({ flag: true, off: false, nothing: null, gone: undefined }),
    ).toEqual({
      flag: true,
      off: false,
      nothing: null,
    })
    expect(Object.keys(redact({ gone: undefined }) as object)).toEqual([])
    expect(redact(true)).toBe(true)
    expect(redact(null)).toBe(null)
    expect(redact(undefined)).toBe(undefined)
  })

  it('reduces a top-level string, number and array to their shape', () => {
    expect(redact('Biedronka')).toBe('[redacted:string]')
    expect(redact(42)).toBe('[redacted:number]')
    expect(redact([1, 2, 3])).toBe('[array:3]')
  })

  it('reduces a bigint, a symbol and a function to a marker', () => {
    expect(redact({ a: 10n, b: Symbol('secret'), c: () => 1 })).toEqual({
      a: '[bigint]',
      b: '[symbol]',
      c: '[function]',
    })
    expect(redact(10n)).toBe('[bigint]')
    expect(redact(Symbol('secret'))).toBe('[symbol]')
  })

  it('reduces a Map, a Set, a Date and a typed array to a marker', () => {
    expect(
      redact({
        m: new Map([[1, 2]]),
        s: new Set([1, 2, 3]),
        d: new Date(0),
        u: new Uint8Array(4),
      }),
    ).toEqual({ m: '[Map:1]', s: '[Set:3]', d: '[Date]', u: '[binary]' })
  })

  it('ignores symbol keys and non-enumerable properties', () => {
    const subject: Record<string | symbol, unknown> = { shown: true }
    subject[Symbol('hidden')] = 'Biedronka'
    Object.defineProperty(subject, 'invisible', { value: 'Biedronka' })
    expect(redact(subject)).toEqual({ shown: true })
  })

  it('stops at the depth cap and at the key cap', () => {
    let deep: Record<string, unknown> = { leaf: true }
    for (let i = 0; i < 12; i += 1) deep = { next: deep }
    expect(wire(deep)).toContain('[truncated]')
    expect(wire(deep)).not.toContain('leaf')

    const wide: Record<string, number> = {}
    for (let i = 0; i < 250; i += 1) wide[`k${i}`] = i
    const out = redact(wide) as Record<string, unknown>
    expect(Object.keys(out).filter((key) => key.startsWith('k'))).toHaveLength(
      100,
    )
    expect(out['[more]']).toBe(150)
  })

  it('bounds the work on a wide and deep shared structure', () => {
    // 100 keys, each pointing at the same child, eight levels down: 100^8 paths without a budget.
    let level: Record<string, unknown> = { leaf: 1 }
    for (let depth = 0; depth < 7; depth += 1) {
      const next: Record<string, unknown> = {}
      for (let i = 0; i < 100; i += 1) next[`k${i}`] = level
      level = next
    }
    const started = performance.now()
    const out = JSON.stringify(redact(level))
    expect(performance.now() - started).toBeLessThan(1000)
    // The node budget, not the clock, is what bounds the work.
    expect(out).toContain('[truncated]')
  })
})

describe('redact: total, bounded, and never runs user code', () => {
  const quickly = (run: () => unknown): void => {
    const started = performance.now()
    expect(run).not.toThrow()
    expect(performance.now() - started).toBeLessThan(1000)
  }

  it('breaks a cycle', () => {
    const a: Record<string, unknown> = { name: 'x' }
    a.self = a
    a.list = { back: a }
    quickly(() => redact(a))
    expect(redact(a)).toEqual({
      name: '[redacted:string]',
      self: '[circular]',
      list: { back: '[circular]' },
    })
  })

  it('does not call it a cycle when the same object is simply shared', () => {
    const shared = { count: true }
    expect(redact({ left: shared, right: shared })).toEqual({
      left: { count: true },
      right: { count: true },
    })
  })

  it('handles a 10 000-key object', () => {
    const big: Record<string, number> = {}
    for (let i = 0; i < 10_000; i += 1) big[`key${i}`] = i
    quickly(() => redact(big))
  })

  it('never calls a getter, throwing or not', () => {
    let calls = 0
    const subject = {
      get boom(): string {
        calls += 1
        throw new Error('boom')
      },
      get recorded(): string {
        calls += 1
        return 'Biedronka'
      },
      plain: 1,
    }
    quickly(() => redact(subject))
    expect(redact(subject)).toEqual({
      boom: '[getter]',
      recorded: '[getter]',
      plain: '[redacted:number]',
    })
    expect(calls).toBe(0)
  })

  it('does not run toString, toJSON or valueOf', () => {
    let calls = 0
    const subject = {
      toString: () => {
        calls += 1
        return 'x'
      },
      toJSON: () => {
        calls += 1
        return 'x'
      },
      valueOf: () => {
        calls += 1
        return 1
      },
      [Symbol.toPrimitive]: () => {
        calls += 1
        return 'x'
      },
    }
    redact({ subject })
    expect(calls).toBe(0)
  })

  it('survives a Proxy whose traps throw', () => {
    const trap = (): never => {
      throw new Error('trap')
    }
    const hostile = new Proxy(
      {},
      {
        get: trap,
        has: trap,
        ownKeys: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        set: trap,
        defineProperty: trap,
        deleteProperty: trap,
        isExtensible: trap,
        preventExtensions: trap,
        setPrototypeOf: trap,
      },
    )
    quickly(() => redact(hostile))
    expect(redact(hostile)).toBe('[unreadable]')
    expect(redact({ before: true, hostile, after: true })).toEqual({
      before: true,
      hostile: '[unreadable]',
      after: true,
    })
    const hostileArray = new Proxy([], {
      get: trap,
      getOwnPropertyDescriptor: trap,
    })
    quickly(() => redact({ hostileArray }))
  })

  it('survives a revoked Proxy', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    quickly(() => redact({ proxy }))
    expect(redact({ proxy })).toEqual({ proxy: '[unreadable]' })
    expect(redact({ before: true, proxy, after: true })).toEqual({
      before: true,
      proxy: '[unreadable]',
      after: true,
    })
  })

  it('does not let a __proto__ key reach the prototype', () => {
    const parsed = JSON.parse('{"__proto__": {"polluted": "yes"}, "ok": 1}')
    quickly(() => redact(parsed))
    const out = redact(parsed) as Record<string, unknown>
    expect(out.ok).toBe('[redacted:number]')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(wire(parsed)).not.toContain('yes')
  })

  it('reduces a nested error and an aggregate error to a name and a code', () => {
    class AliasTakenError extends Error {
      readonly code = 'ALIAS_TAKEN'
      constructor() {
        super('Alias Biedronka is taken for jan@example.com')
        this.name = 'AliasTakenError'
      }
    }
    const aggregate = new AggregateError(
      [new Error('Kowalski')],
      'many 12,34 zł',
    )
    const out = redact({ failure: new AliasTakenError(), group: aggregate })
    expect(out).toEqual({
      failure: { name: 'AliasTakenError', code: 'ALIAS_TAKEN' },
      group: { name: 'AggregateError' },
    })
    expect(
      wire({ failure: new AliasTakenError(), group: aggregate }),
    ).not.toMatch(/Biedronka|example|Kowalski|12/)
  })

  it('is deterministic for a frozen input and does not mutate it', () => {
    const input = Object.freeze({
      amountMinor: 5,
      nested: Object.freeze({ id: 'a' }),
    })
    expect(redact(input)).toEqual(redact(input))
    expect(input).toEqual({ amountMinor: 5, nested: { id: 'a' } })
  })
})

describe('AMOUNT_PATTERN is linear', () => {
  it.each([
    ['digits', '1'.repeat(100_000)],
    ['digits then a letter', `${'1'.repeat(100_000)}x`],
    ['digits then a separator', `${'1'.repeat(100_000)},`],
    ['single digits with separators', '1,'.repeat(50_000)],
    ['grouped digits', '1 111'.repeat(20_000)],
    ['grouped digits with no end', `${'111 '.repeat(25_000)}x`],
    ['currency codes', 'EUR '.repeat(25_000)],
    ['letters', 'A'.repeat(100_000)],
    ['signs', '-'.repeat(100_000)],
  ])('runs over 100 000 characters of %s in under a second', (_label, text) => {
    const started = performance.now()
    text.replace(AMOUNT_PATTERN, '[amount]')
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('redactError', () => {
  class FakeRepositoryError extends Error {
    readonly code: string
    constructor(message: string, code: string) {
      super(message)
      this.name = new.target.name
      this.code = code
    }
  }
  class AliasTakenError extends FakeRepositoryError {
    constructor(alias: string) {
      super(`The alias ${alias} is already taken.`, 'ALIAS_TAKEN')
    }
  }
  class InvitationAddresseeError extends FakeRepositoryError {
    constructor(email: string) {
      super(`This invitation was sent to ${email}.`, 'INVITATION_ADDRESSEE')
    }
  }
  class InvalidAmountError extends FakeRepositoryError {
    constructor(amount: string) {
      super(`Not an integer minor-unit amount: ${amount}`, 'INVALID_AMOUNT')
    }
  }

  it('returns the constructor name, the code and frames, and nothing of the message', () => {
    const cases = [
      { error: new AliasTakenError('biedronka'), secret: 'biedronka' },
      { error: new InvitationAddresseeError('a@b.c'), secret: 'a@b.c' },
      { error: new InvalidAmountError('12.5'), secret: '12.5' },
    ]
    for (const { error, secret } of cases) {
      const out = redactError(error)
      expect(out.name).toBe(error.constructor.name)
      expect(out.code).toMatch(/^[A-Z_]+$/)
      expect(out.frames.length).toBeGreaterThan(0)
      const serialised = JSON.stringify(out)
      expect(serialised).not.toContain(secret)
      expect(serialised).not.toContain(error.message)
      expect(serialised).not.toContain(`${error.name}:`)
    }
  })

  it('returns only strict frames, at most twenty, each at most 200 characters', () => {
    const error = new Error('x')
    error.stack = `Error: x\n${Array.from(
      { length: 40 },
      (_, i) => `    at fn${i} (${'/very/long/path'.repeat(30)}:${i}:1)`,
    ).join('\n')}\nnot a frame\n  at\n`
    const { frames } = redactError(error)
    expect(frames).toHaveLength(20)
    for (const frame of frames) {
      expect(frame).toMatch(/^at \S/)
      expect(frame.length).toBeLessThanOrEqual(200)
    }
  })

  it('passes each frame through the amount pattern', () => {
    const error = new Error('x')
    error.stack =
      'Error: x\n    at pay (/srv/12 345,67/file.ts:1:1)\n    at ok (/srv/b.ts:3:4)'
    const { frames } = redactError(error)
    expect(frames).toEqual([
      'at pay (/srv/[amount]/file.ts:1:1)',
      'at ok (/srv/b.ts:3:4)',
    ])
  })

  it('does not read a fake frame out of a message holding a newline', () => {
    const error = new Error('x\n    at fake (a.ts:1:1)')
    const out = redactError(error)
    expect(out.frames.length).toBeGreaterThan(0)
    expect(JSON.stringify(out)).not.toContain('fake')
  })

  it('does not read a fake frame out of a message whose newline is in the middle', () => {
    const error = new Error('first line\n    at fake (a.ts:1:1)\nlast line')
    expect(JSON.stringify(redactError(error))).not.toMatch(
      /fake|first line|last line/,
    )
  })

  it('returns no frames when the message was changed after the stack was read', () => {
    const error = new Error('original\n    at fake (a.ts:1:1)')
    // V8 renders the header on the first read of `stack`, so this is the stale-header case.
    expect(error.stack).toContain('original')
    error.message = 'Biedronka 12,34 zł'
    const out = redactError(error)
    expect(out.frames).toEqual([])
    expect(JSON.stringify(out)).not.toMatch(/fake|original|Biedronka|zł/)
  })

  it.each(['Error', 'rror', 'E', 'Err', 'or: x', '', 'at fake (a.ts:1:1)'])(
    'fails closed when the message is changed to %j after the stack was read',
    (changed) => {
      const error = new Error('x\n    at fake (a.ts:1:1)')
      void error.stack
      error.message = changed
      expect(JSON.stringify(redactError(error))).not.toContain('fake')
    },
  )

  it('fails closed when the message is deleted after the stack was read', () => {
    const error = new Error('x\n    at fake (a.ts:1:1)')
    void error.stack
    Reflect.deleteProperty(error, 'message')
    expect(JSON.stringify(redactError(error))).not.toContain('fake')
  })

  it('reads no frame out of a message getter on the prototype', () => {
    class Getter extends Error {
      override get message(): string {
        return 'x\n    at fake (a.ts:1:1)'
      }
    }
    expect(JSON.stringify(redactError(new Getter()))).not.toContain('fake')
  })

  it('keeps the frames of an error with an empty message', () => {
    const out = redactError(new Error())
    expect(out.frames.length).toBeGreaterThan(0)
  })

  it('reads no fake frame when the message is changed before the stack is read', () => {
    const error = new Error('original\n    at fake (a.ts:1:1)')
    error.message = 'Biedronka 12,34 zł'
    expect(JSON.stringify(redactError(error))).not.toMatch(
      /fake|original|Biedronka|zł/,
    )
  })

  it('keeps the real frames when a short message is also a substring of the name', () => {
    const error = new Error('rr')
    const out = redactError(error)
    expect(out.frames.length).toBeGreaterThan(0)
    expect(JSON.stringify(out)).not.toContain('rr:')
  })

  it('yields no frames when the stack is a number, absent or a throwing getter', () => {
    const numeric = new Error('x')
    Object.defineProperty(numeric, 'stack', { value: 42 })
    expect(redactError(numeric).frames).toEqual([])

    const absent = new Error('x')
    Object.defineProperty(absent, 'stack', { value: undefined })
    expect(redactError(absent).frames).toEqual([])

    const throwing = new Error('x')
    Object.defineProperty(throwing, 'stack', {
      get() {
        throw new Error('getter')
      },
    })
    expect(redactError(throwing)).toEqual({ name: 'Error', frames: [] })
  })

  it('yields no frames when the message is an accessor', () => {
    const error = new Error('x')
    Object.defineProperty(error, 'message', {
      get() {
        throw new Error('getter')
      },
    })
    expect(redactError(error).frames).toEqual([])
  })

  it('never returns a cause, an aggregate member or an own property', () => {
    class Rich extends Error {
      readonly entity = 'payee Biedronka'
      readonly id = 'Kowalski'
      payload = { amountMinor: 987_654 }
    }
    const error = new Rich('boom', {
      cause: new Error('cause Biedronka 12,34 zł'),
    })
    const aggregate = new AggregateError([new Error('member Kowalski')], 'agg')
    for (const subject of [error, aggregate]) {
      const out = redactError(subject)
      expect(Object.keys(out).sort()).toEqual(['frames', 'name'])
      expect(JSON.stringify(out)).not.toMatch(
        /Biedronka|Kowalski|987654|cause|member|payee|entity/,
      )
    }
  })

  it('keeps a name only if it is an identifier, else falls back to Error', () => {
    const named = new Error('x')
    named.name = 'x y'
    expect(redactError(named).name).toBe('Error')

    const Anonymous = class extends Error {}
    Object.defineProperty(Anonymous, 'name', { value: 'has a space' })
    expect(redactError(new Anonymous('x')).name).toBe('Error')
  })

  it('keeps a code only if it is an identifier', () => {
    const good = Object.assign(new Error('x'), { code: 'ALIAS_TAKEN' })
    expect(redactError(good).code).toBe('ALIAS_TAKEN')

    for (const code of [
      'has a space',
      'Kowalski, Jan',
      '',
      42,
      null,
      {},
      'x'.repeat(65),
    ]) {
      const bad = Object.assign(new Error('x'), { code })
      expect('code' in redactError(bad)).toBe(false)
    }
  })

  it('does not call an accessor code or a constructor getter', () => {
    let calls = 0
    const error = new Error('x')
    Object.defineProperty(error, 'code', {
      get() {
        calls += 1
        return 'CALLED'
      },
    })
    expect('code' in redactError(error)).toBe(false)
    expect(calls).toBe(0)
  })

  it('treats a thrown non-error as a NonError with no frames', () => {
    for (const value of [
      'Biedronka',
      null,
      undefined,
      42,
      { message: 'Biedronka' },
      Symbol('s'),
    ]) {
      expect(redactError(value)).toEqual({ name: 'NonError', frames: [] })
    }
  })

  it('survives a hostile Proxy of an error', () => {
    const trap = (): never => {
      throw new Error('trap')
    }
    const hostile = new Proxy(new Error('x'), {
      get: trap,
      getPrototypeOf: trap,
      getOwnPropertyDescriptor: trap,
    })
    expect(() => redactError(hostile)).not.toThrow()
    expect(JSON.stringify(redactError(hostile))).not.toContain('trap')
  })

  it('is final output: redact() would drop its frames, so the sinks must not re-scrub it', () => {
    const out = redactError(new Error('x'))
    expect(out.frames.length).toBeGreaterThan(0)
    expect((redact(out) as Record<string, unknown>).frames).toBe(
      `[array:${out.frames.length}]`,
    )
  })
})

describe('redact: fuzz', () => {
  // A small seeded generator, so a failure names a reproducible seed and no dependency is added.
  const random = (seed: number) => () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
    return seed / 2 ** 32
  }

  const MONEY_KEYS = [
    ...spellings('amount', 'minor'),
    ...spellings('ref', 'amount'),
    ...spellings('account', 'balance'),
    'amounts',
    'AMOUNT',
    'balance',
  ]
  const NAME_KEYS = [
    ...spellings('payee', 'name'),
    ...spellings('account', 'name'),
    ...spellings('category', 'label'),
    ...spellings('user', 'email'),
    ...spellings('billing', 'address'),
    ...spellings('payee', 'alias'),
    'payees',
    'ALIASES',
  ]
  const INVENTED_KEYS = [
    'lastname',
    'thing',
    'foo',
    'bar_baz',
    'qux-quux',
    'ownerX',
  ]
  const AMOUNTS = [
    '12,34 zł',
    'EUR 1 234.50',
    '12 345,67',
    '12 345,67',
    '$1,234.56',
    '99.99',
  ]
  const NAMES = [
    'Biedronka Sp. z o.o.',
    'Jan Kowalski',
    'Żabka Polska',
    'Salary 2026.pdf',
    'jan.kowalski@example.com',
  ]

  const build = (
    rand: () => number,
    depth: number,
    leaves: { value: string | number }[],
  ): unknown => {
    const node: Record<string, unknown> = {}
    const pick = <T>(list: readonly T[]): T =>
      list[Math.floor(rand() * list.length)]!
    const keys = 2 + Math.floor(rand() * 4)
    for (let i = 0; i < keys; i += 1) {
      const roll = rand()
      const family =
        roll < 0.3
          ? MONEY_KEYS
          : roll < 0.6
            ? NAME_KEYS
            : roll < 0.8
              ? INVENTED_KEYS
              : [...REDACT_ALLOW_KEYS]
      const key = `${pick(family)}${i === 0 ? '' : String(i)}`
      if (depth > 0 && rand() < 0.45) {
        node[key] = build(rand, depth - 1, leaves)
      } else if (rand() < 0.2) {
        const list = [pick(AMOUNTS), pick(NAMES)]
        leaves.push(...list.map((value) => ({ value })))
        node[key] = list
      } else {
        const value =
          rand() < 0.5
            ? pick(AMOUNTS)
            : rand() < 0.5
              ? pick(NAMES)
              : 700_000 + Math.floor(rand() * 99_999)
        leaves.push({ value })
        node[key] = value
      }
    }
    return node
  }

  it.each(Array.from({ length: 200 }, (_, seed) => [seed]))(
    'leaves no amount and no name in the serialised output (seed %i)',
    (seed) => {
      const leaves: { value: string | number }[] = []
      const input = build(random(seed), 5, leaves)
      const out = wire(input)
      for (const { value } of leaves) {
        expect(out, String(value)).not.toContain(String(value))
        expect(out, String(value)).not.toContain(
          JSON.stringify(String(value)).slice(1, -1),
        )
      }
    },
  )
})
