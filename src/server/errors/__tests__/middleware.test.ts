/**
 * The failure boundary, run inside the framework's own chain.
 *
 * `@tanstack/start-client-core` catches whatever a handler, a per-function middleware or an input
 * validator throws and returns it as data in `{ result, error, context }`; the server handler then
 * serialises that whole object, and the default `$TSR/Error` plugin writes the error's `message`. So
 * the boundary has to replace the thrown value, and a test that calls the middleware's function directly would prove
 * nothing about what leaves. These cases build a real `createServerFn` value with a real
 * `.inputValidator(...)` and per-function middleware, register the middleware the way
 * `src/start.ts` does (as `functionMiddleware` of the Start options, which the framework prepends to
 * the function's own list), and read the `{ result, error, context }` that `__executeServer`
 * returns - the value the wire is built from.
 *
 * What a Node test cannot reach is stated in the issue and proven by one probe of the running app:
 * the byte-level wire, the HTTP status of the response, the SSR document status and the client
 * bundle. `seroval`, which writes the wire, is not a dependency of this repository, so
 * {@link wireOf} serialises an error under a rule stricter than the framework's (every own property
 * *name*, `name` and `message`, with `stack` kept) and a case pins that a raw error does leak under
 * that rule, so the absence checks below cannot pass vacuously. The adapter that carries the
 * envelope is covered in `src/lib/__tests__/public-failure.test.ts`.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { notFound, redirect } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { readFailure } from '#/lib/failure'
import { PublicFailureError, publicFailureAdapter } from '#/lib/public-failure'
import { AuthRequirementError } from '#/server/auth/tenant'
import { createLogger, createMemorySink } from '#/server/observability/logger'
import { runWithLedgerBatch, setLedgerBatchPorts } from '#/server/ledger/batch'
import { touchLedgerAccount } from '#/server/repos/base'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '#/server/repos/errors'
import { startInstance } from '#/start'

import { buildEnvelope } from '../envelope'
import {
  createFailureMiddleware,
  failureLogPort,
  failureRedactionMiddleware,
} from '../middleware'

import type { AsyncLocalStorage } from 'node:async_hooks'

import type { FailureEnvelope } from '#/lib/failure-envelope'

import type * as EnvelopeModule from '../envelope'
import type { FailurePorts } from '../middleware'

// A pass-through spy, so one case can make the builder throw; every other case gets the real one.
vi.mock('../envelope', async (importOriginal) => {
  const actual = await importOriginal<typeof EnvelopeModule>()
  return { ...actual, buildEnvelope: vi.fn(actual.buildEnvelope) }
})

/** The framework keeps the request's Start context in an `AsyncLocalStorage` on the global object. */
const startStorage = (globalThis as Record<symbol, unknown>)[
  Symbol.for('tanstack-start:start-storage-context')
] as AsyncLocalStorage<unknown>

type ChainResult = { result?: unknown; error?: unknown; context?: unknown }

type ServerFunction = {
  __executeServer: (options: {
    data: unknown
    context: object
  }) => Promise<ChainResult>
}

type Middleware = ReturnType<typeof createFailureMiddleware>

type Spec = {
  /** What the function's `.inputValidator(...)` is; none when absent. */
  validator?: z.ZodType
  /** Per-function middleware, run after the global one. */
  middleware?: ReadonlyArray<Middleware>
  handler?: () => Promise<unknown>
}

/**
 * A server function the way the compiler leaves one in a test: `handler(extractedFn, serverFn)`.
 * The two-argument form is what the build emits; the typings only know the authoring one.
 */
function serverFunction(spec: Spec): ServerFunction {
  let builder: any = createServerFn({ method: 'POST' })
  if (spec.middleware) builder = builder.middleware([...spec.middleware])
  if (spec.validator) builder = builder.inputValidator(spec.validator)
  return builder.handler(
    Object.assign(() => undefined, { serverFnMeta: {} }),
    spec.handler ?? (async () => 'ok'),
  )
}

/** Runs `fn` as the server would: inside a Start context whose options register `globals`. */
async function execute(
  fn: ServerFunction,
  globals: ReadonlyArray<Middleware>,
  data: unknown = {},
): Promise<ChainResult> {
  return startStorage.run(
    {
      startOptions: { functionMiddleware: [...globals] },
      contextAfterGlobalMiddlewares: {},
      request: new Request('http://localhost/_serverFn/test'),
    },
    () => fn.__executeServer({ data, context: {} }),
  ) as Promise<ChainResult>
}

/**
 * An error as `seroval` writes it for the wire: its constructor from `name`, then `message`, then
 * every own property *name* (non-enumerable ones, `stack` and `cause` included) with its value.
 */
function wireOf(chain: ChainResult): string {
  const { error, ...rest } = chain
  const encoded: Record<string, unknown> = {}
  if (error instanceof Error) {
    encoded.name = error.name
    encoded.message = error.message
    for (const key of Object.getOwnPropertyNames(error)) {
      if (key !== 'name' && key !== 'message') {
        encoded[key] = (error as unknown as Record<string, unknown>)[key]
      }
    }
  } else {
    encoded.thrown = error
  }
  return JSON.stringify({ ...rest, error: encoded })
}

type Calls = Array<
  | ['log', Parameters<FailurePorts['log']>[0]]
  | ['report', Parameters<FailurePorts['report']>[0], string]
  | ['setStatus', number]
>

function spyPorts(): { ports: FailurePorts; calls: Calls } {
  const calls: Calls = []
  return {
    calls,
    ports: {
      log: (fields) => void calls.push(['log', fields]),
      report: (fields, kind) => void calls.push(['report', fields, kind]),
      setStatus: (status) => void calls.push(['setStatus', status]),
    },
  }
}

/** The failure a function leaves, with the middleware registered globally and the ports spied. */
async function failureOf(spec: Spec, data?: unknown) {
  const { ports, calls } = spyPorts()
  const chain = await execute(
    serverFunction(spec),
    [createFailureMiddleware(ports)],
    data,
  )
  return { chain, calls, wire: wireOf(chain) }
}

function throwing(error: unknown): () => Promise<never> {
  return async () => {
    throw error
  }
}

function envelopeOf(chain: ChainResult): FailureEnvelope {
  expect(chain.error).toBeInstanceOf(PublicFailureError)
  return (chain.error as PublicFailureError).envelope
}

afterEach(() => {
  setLedgerBatchPorts(null)
})

describe('the framework without the boundary leaks, which is what these cases rule out', () => {
  it('carries the message, the stack and an own property of a raw error', async () => {
    const error = Object.assign(new Error('postgres://u:p@h'), {
      payee: 'Biedronka',
    })
    const chain = await execute(
      serverFunction({ handler: throwing(error) }),
      [],
    )
    expect(wireOf(chain)).toContain('postgres://u:p@h')
    expect(wireOf(chain)).toContain('Biedronka')
    expect(wireOf(chain)).toMatch(/at .*middleware\.test\.ts/)
  })
})

describe('what leaves a failing server function', () => {
  it.each([
    [
      'a handler',
      { handler: throwing(new Error('postgres://u:p@h')) } satisfies Spec,
    ],
    [
      'a per-function middleware (an auth guard)',
      {
        middleware: [
          createMiddleware({ type: 'function' }).server(
            throwing(new Error('postgres://u:p@h')),
          ),
        ],
      } satisfies Spec,
    ],
  ])(
    'replaces what %s throws with a PublicFailureError that carries nothing of it',
    async (_name, spec) => {
      const { chain, wire } = await failureOf(spec)
      const error = chain.error as PublicFailureError

      expect(error).toBeInstanceOf(PublicFailureError)
      expect(error.name).toBe('PublicFailureError')
      expect(error.envelope).toEqual({
        v: 1,
        kind: 'internal',
        message: { key: 'failure.internal' },
      })
      expect(error.message).toBe('This could not be completed.')
      expect(error.stack).toBe('')
      expect(error.cause).toBeUndefined()
      expect(Object.hasOwn(error, 'cause')).toBe(false)
      expect(Object.keys(error)).toEqual(['envelope'])

      expect(wire).not.toContain('postgres')
      expect(wire).not.toMatch(/\.(?:ts|tsx|js|mjs):\d+/)
      expect(wire).not.toContain('node_modules')
      expect(wire).not.toContain(dirname(fileURLToPath(import.meta.url)))
    },
  )

  it('says "sign in" for an anonymous request and nothing else of the cause', async () => {
    const { chain, calls } = await failureOf({
      middleware: [
        createMiddleware({ type: 'function' }).server(
          throwing(new AuthRequirementError('unauthenticated', 'No session')),
        ),
      ],
    })
    expect(envelopeOf(chain).kind).toBe('unauthenticated')
    expect((chain.error as Error).message).toBe(
      'You need to sign in to continue.',
    )
    expect(calls).toContainEqual(['setStatus', 401])
  })

  it('turns an input-validation failure into fields built from path and code only', async () => {
    const { chain, calls, wire } = await failureOf(
      {
        validator: z.object({
          name: z.string().min(3),
          lines: z.array(z.object({ amountMinor: z.number() })),
        }),
      },
      { name: 'Biedronka-secret', lines: [{ amountMinor: 'twelve' }] },
    )
    // `name` is long enough; `amountMinor` is the wrong type.
    const envelope = envelopeOf(chain)

    expect(envelope.kind).toBe('validation')
    expect(envelope.fields).toEqual([
      { path: 'lines.0.amountMinor', key: 'failure.field.invalid' },
    ])
    expect(wire).not.toContain('Biedronka-secret')
    expect(wire).not.toContain('twelve')
    expect(wire).not.toMatch(/expected number|Invalid input/i)
    expect(calls).toContainEqual(['setStatus', 422])
  })

  it('maps a too-short value to its own field key', async () => {
    const { chain } = await failureOf(
      { validator: z.object({ name: z.string().min(3) }) },
      { name: 'ab' },
    )
    expect(envelopeOf(chain).fields).toEqual([
      { path: 'name', key: 'failure.field.tooShort' },
    ])
  })

  it('sets the status of the kind', async () => {
    const forbidden = await failureOf({
      handler: throwing(new ForbiddenError('manage Biedronka', ['owner'])),
    })
    expect(forbidden.calls).toContainEqual(['setStatus', 403])

    const conflict = await failureOf({
      handler: throwing(new ConflictError('alias "biedronka" is taken')),
    })
    expect(conflict.calls).toContainEqual(['setStatus', 409])
    expect(conflict.wire).not.toContain('biedronka')
  })
})

describe('the sinks', () => {
  const secrets = new Error('Biedronka charged 12,34 zł (1234)', {
    cause: new Error('payee Biedronka, amount 1234'),
  })
  Object.assign(secrets, { payee: 'Biedronka', amountMinor: 1234 })

  it('are called in order - log, report, setStatus - and the error arrives after them', async () => {
    const { calls, chain } = await failureOf({ handler: throwing(secrets) })

    expect(calls.map(([port]) => port)).toEqual(['log', 'report', 'setStatus'])
    expect(chain.error).toBeInstanceOf(PublicFailureError)
  })

  it('receive the kind, a name, a code and frames - and never a message, a cause or an own property', async () => {
    const { calls } = await failureOf({ handler: throwing(secrets) })
    const serialised = JSON.stringify(calls)

    for (const leaked of ['Biedronka', '12,34', '1234', 'zł', 'payee']) {
      expect(serialised).not.toContain(leaked)
    }
    const [, logged] = calls[0] as Extract<Calls[number], ['log', unknown]>
    expect(Object.keys(logged).sort()).toEqual(['frames', 'kind', 'name'])
    expect(logged.kind).toBe('internal')
    for (const forbidden of ['errorMessage', 'errorStack', 'errorCause']) {
      expect(serialised).not.toContain(forbidden)
    }
    const reported = calls[1] as Extract<
      Calls[number],
      ['report', ...unknown[]]
    >
    expect(reported[2]).toBe('internal')
  })

  it('the default log port writes one error-level line of redacted fields to the logger', () => {
    const sink = createMemorySink()
    const logger = createLogger({ sink })

    failureLogPort(logger)({
      kind: 'conflict',
      name: 'ConflictError',
      code: 'CONFLICT',
      frames: ['    at handler (src/server/fns/x.ts:1:1)'],
    })

    expect(sink.records).toHaveLength(1)
    const [record] = sink.records
    expect(record).toMatchObject({
      level: 'error',
      kind: 'conflict',
      name: 'ConflictError',
      code: 'CONFLICT',
    })
    for (const key of [
      'errorMessage',
      'errorStack',
      'errorCause',
      'errorName',
    ]) {
      expect(record).not.toHaveProperty(key)
    }
  })

  it('a throwing log or report port changes nothing about what is thrown, and the status is still set', async () => {
    const calls: Array<string> = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ports: FailurePorts = {
      log: () => {
        throw new Error('sink down: Biedronka')
      },
      report: async () => {
        throw new Error('sink down: 1234')
      },
      setStatus: (status) => void calls.push(`status ${status}`),
    }

    const chain = await execute(
      serverFunction({
        handler: throwing(new NotFoundError('account', 'a-1')),
      }),
      [createFailureMiddleware(ports)],
    )

    expect(envelopeOf(chain).kind).toBe('not_found')
    expect(calls).toEqual(['status 404'])
    // The only console write is a fixed string - no value from the sink or the failure.
    expect(consoleError.mock.calls.every((args) => args.length === 1)).toBe(
      true,
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(
      /Biedronka|1234|a-1/,
    )
  })

  it('a throwing setStatus port still ends in the PublicFailureError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ports: FailurePorts = {
      log: () => undefined,
      report: () => undefined,
      setStatus: () => {
        throw new Error('no response in this context')
      },
    }
    const chain = await execute(
      serverFunction({ handler: throwing(new Error('x')) }),
      [createFailureMiddleware(ports)],
    )
    expect(envelopeOf(chain).kind).toBe('internal')
  })
})

describe('control flow passes through as the same object', () => {
  it.each([
    ['a redirect', () => redirect({ to: '/' })],
    ['the router not-found sentinel', () => notFound()],
    ['a thrown Response', () => new Response('gone', { status: 410 })],
  ])('%s', async (_name, make) => {
    const thrown = make()
    const { chain, calls } = await failureOf({ handler: throwing(thrown) })

    expect(chain.error).toBe(thrown)
    expect(calls).toEqual([])
  })

  it('an already-built PublicFailureError is not classified, logged or counted a second time', async () => {
    const first = await failureOf({
      handler: throwing(new ForbiddenError('x', ['owner'])),
    })
    const built = first.chain.error as PublicFailureError

    const again = await failureOf({ handler: throwing(built) })

    expect(again.chain.error).toBe(built)
    expect(built.envelope.kind).toBe('forbidden')
    expect(again.calls).toEqual([])
  })
})

describe('a failure while building the failure', () => {
  it('falls back to the constant internal envelope and status 500, never the original value', async () => {
    vi.mocked(buildEnvelope).mockImplementationOnce(() => {
      throw new Error('builder broke on Biedronka')
    })
    const { chain, calls, wire } = await failureOf({
      handler: throwing(new NotFoundError('account', 'a-1')),
    })

    expect(envelopeOf(chain)).toEqual({
      v: 1,
      kind: 'internal',
      message: { key: 'failure.internal' },
    })
    expect(calls).toContainEqual(['setStatus', 500])
    expect(wire).not.toContain('Biedronka')
  })
})

describe('tenant isolation, through the real chain', () => {
  const absent = new NotFoundError('account', 'acc-does-not-exist')
  const foreign = new NotFoundError('transaction', 'txn-of-workspace-b')

  it('a missing row and another workspace’s row leave with the same status and the same bytes', async () => {
    const missing = await failureOf({ handler: throwing(absent) })
    const other = await failureOf({ handler: throwing(foreign) })

    expect(other.wire).toBe(missing.wire)
    expect(other.calls.filter(([port]) => port === 'setStatus')).toEqual(
      missing.calls.filter(([port]) => port === 'setStatus'),
    )
    expect(missing.calls).toContainEqual(['setStatus', 404])
    for (const leaked of [
      'acc-',
      'txn-',
      'account',
      'transaction',
      'requestId',
    ]) {
      expect(missing.wire).not.toContain(leaked)
    }
  })

  it('a not-a-member refusal for an existing and for a non-existent workspace serialises identically', async () => {
    const existing = await failureOf({
      handler: throwing(
        new AuthRequirementError('not-a-member', 'Not a member of org-real'),
      ),
    })
    const ghost = await failureOf({
      handler: throwing(
        new AuthRequirementError('not-a-member', 'Not a member of org-ghost'),
      ),
    })

    expect(ghost.wire).toBe(existing.wire)
    expect(existing.calls).toContainEqual(['setStatus', 403])
    expect(existing.wire).not.toContain('org-')
  })
})

describe('the ledger batch', () => {
  it('has flushed before the boundary sees the failure', async () => {
    const events: Array<string> = []
    setLedgerBatchPorts({
      namespace: () => ({
        idFromName: (name) => name as unknown as DurableObjectId,
        get: (id) => ({
          fetch: async () => {
            events.push(`flush ${String(id)}`)
            return new Response(null, { status: 204 })
          },
        }),
      }),
    })

    const { chain } = await (async () => {
      const ports: FailurePorts = {
        log: () => void events.push('log'),
        report: () => undefined,
        setStatus: () => undefined,
      }
      return {
        chain: await execute(
          serverFunction({
            handler: () =>
              runWithLedgerBatch(async () => {
                touchLedgerAccount('acc-1')
                throw new Error('the write failed after the account moved')
              }),
          }),
          [createFailureMiddleware(ports)],
        ),
      }
    })()

    expect(chain.error).toBeInstanceOf(PublicFailureError)
    expect(events).toEqual(['flush acc-1', 'log'])
  })
})

describe('the envelope across the wire', () => {
  it('survives the adapter from what the real middleware threw to what the reader reads', async () => {
    const { chain } = await failureOf({
      handler: throwing(new ForbiddenError('manage Biedronka', ['owner'])),
    })
    // The adapter claims the very class the middleware throws; if it did not, the default plugin
    // would write the message alone and the envelope would stop at the server.
    expect(publicFailureAdapter.test(chain.error)).toBe(true)

    const wire = JSON.parse(
      JSON.stringify(
        publicFailureAdapter.toSerializable(chain.error as PublicFailureError),
      ),
    )
    expect(JSON.stringify(wire)).not.toContain('Biedronka')
    expect(readFailure(publicFailureAdapter.fromSerializable(wire))).toEqual(
      (chain.error as PublicFailureError).envelope,
    )
  })
})

describe('registration', () => {
  it('start.ts registers the middleware as global function middleware and the adapter that carries its envelope, and nothing else', async () => {
    const options = await startInstance.getOptions()
    expect(options.functionMiddleware).toEqual([failureRedactionMiddleware])
    expect(options.serializationAdapters).toEqual([publicFailureAdapter])
  })

  it('keeps every server-only module out of the top-level imports of the middleware', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'middleware.ts'),
      'utf8',
    )
    // These are reached by dynamic import from inside the server closure only.
    expect(source).not.toMatch(/^import .*['"]cloudflare:workers['"]/m)
    expect(source).not.toMatch(
      /^import .*['"]@tanstack\/react-start\/server['"]/m,
    )
  })
})
