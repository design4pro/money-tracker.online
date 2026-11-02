import type { AsyncLocalStorage } from 'node:async_hooks'

import { createServerFn } from '@tanstack/react-start'
import { notFound, redirect } from '@tanstack/react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { PublicFailureError } from '#/lib/public-failure'
import { AuthRequirementError } from '#/server/auth/tenant'
import { ConflictError, NotFoundError } from '#/server/repos/errors'

import { failureRedactionMiddleware } from '../middleware'

const runtime = vi.hoisted(() => ({
  header: undefined as string | undefined,
  setResponseStatus: vi.fn(),
}))

// Runtime boundaries only: the global middleware and framework chain are real.
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeader: (name: string) => {
    expect(name).toBe('x-tsr-serverFn')
    return runtime.header
  },
  setResponseStatus: runtime.setResponseStatus,
}))
vi.mock('cloudflare:workers', () => ({ env: { LOG_LEVEL: 'error' } }))

const storage = (globalThis as Record<symbol, unknown>)[
  Symbol.for('tanstack-start:start-storage-context')
] as AsyncLocalStorage<unknown>

async function fail(error: unknown) {
  const builder: any = createServerFn({ method: 'POST' })
  const fn = builder.handler(
    Object.assign(() => undefined, { serverFnMeta: {} }),
    async () => {
      throw error
    },
  )
  return storage.run(
    {
      startOptions: { functionMiddleware: [failureRedactionMiddleware] },
      contextAfterGlobalMiddlewares: {},
      request: new Request('http://localhost/_serverFn/test'),
    },
    () => fn.__executeServer({ data: {}, context: {} }),
  ) as Promise<{ error?: unknown; result?: unknown }>
}

beforeEach(() => {
  runtime.header = 'true'
  runtime.setResponseStatus.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

it.each([
  [new ConflictError('private alias'), 'conflict', 409],
  [
    new AuthRequirementError('unauthenticated', 'private session'),
    'unauthenticated',
    401,
  ],
  [
    new AuthRequirementError('insufficient-role', 'private role'),
    'forbidden',
    403,
  ],
  [new NotFoundError('payee', 'private-id'), 'not_found', 404],
  [
    new z.ZodError([
      { code: 'custom', path: ['name'], message: 'private value' },
    ]),
    'validation',
    422,
  ],
  [new Error('private fault'), 'internal', 500],
])(
  'keeps %s rejected while distinguishing RPC transport from SSR',
  async (error, kind, status) => {
    for (const [header, expected] of [
      ['true', 200],
      [undefined, status],
      ['false', status],
      ['TRUE', status],
    ] as const) {
      runtime.header = header
      runtime.setResponseStatus.mockClear()
      const chain = await fail(error)
      expect(chain.result).toBeUndefined()
      expect(chain.error).toBeInstanceOf(PublicFailureError)
      expect((chain.error as PublicFailureError).envelope.kind).toBe(kind)
      expect(JSON.stringify(chain.error)).not.toContain('private')
      expect(runtime.setResponseStatus).toHaveBeenCalledExactlyOnceWith(
        expected,
      )
    }
  },
)

it.each([
  redirect({ to: '/' }),
  notFound(),
  new Response('gone', { status: 410 }),
])('preserves control flow without changing its status', async (error) => {
  expect((await fail(error)).error).toBe(error)
  expect(runtime.setResponseStatus).not.toHaveBeenCalled()
})

it('gives missing and foreign rows the same public failure and transport', async () => {
  const missing = await fail(new NotFoundError('payee', 'absent'))
  const foreign = await fail(new NotFoundError('payee', 'foreign'))
  expect(JSON.stringify(foreign)).toBe(JSON.stringify(missing))
  expect(runtime.setResponseStatus.mock.calls).toEqual([[200], [200]])
})
