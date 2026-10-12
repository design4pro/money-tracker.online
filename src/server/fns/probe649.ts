// TEMPORARY probe for #649 - never committed.
import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { notFound } from '@tanstack/react-router'
import { z } from 'zod'

import { NotFoundError } from '#/server/repos/errors'

const LEAK = 'RECOGNISABLE-LEAK-649 Biedronka 12,34 zl'

const failingGuard = createMiddleware({ type: 'function' }).server(async () => {
  throw new Error(`${LEAK} (auth middleware)`)
})

export const probeHandler = createServerFn({ method: 'POST' }).handler(async () => {
  throw new Error(`${LEAK} (handler)`)
})
export const probeAuth = createServerFn({ method: 'POST' })
  .middleware([failingGuard])
  .handler(async () => 'unreachable')
export const probeValidate = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ count: z.number() }))
  .handler(async () => 'ok')
export const probeRawNotFound = createServerFn({ method: 'POST' }).handler(async () => {
  throw new NotFoundError('account', 'acc-probe-secret-id')
})
export const probeSentinel = createServerFn({ method: 'POST' }).handler(async () => {
  throw notFound()
})
export const probeOk = createServerFn({ method: 'POST' }).handler(async () => 'fine')
