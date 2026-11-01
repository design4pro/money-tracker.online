import { describe, expect, it, vi } from 'vitest'

import { startInstance } from '#/start'

describe('registered server-function CSRF protection', () => {
  it.each<{
    headers: HeadersInit
    status: number
    calls: number
    handlerType?: 'router'
  }>([
    { headers: { 'Sec-Fetch-Site': 'same-origin' }, status: 200, calls: 1 },
    { headers: { 'Sec-Fetch-Site': 'cross-site' }, status: 403, calls: 0 },
    { headers: { 'Sec-Fetch-Site': 'same-site' }, status: 403, calls: 0 },
    {
      headers: { Origin: 'https://money-tracker.example' },
      status: 200,
      calls: 1,
    },
    { headers: { Origin: 'https://foreign.example' }, status: 403, calls: 0 },
    {
      headers: { Referer: 'https://money-tracker.example/app' },
      status: 200,
      calls: 1,
    },
    {
      headers: { Referer: 'https://money-tracker.example.foreign.example/' },
      status: 403,
      calls: 0,
    },
    { headers: {}, status: 403, calls: 0 },
    {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
      status: 200,
      calls: 1,
      handlerType: 'router',
    },
  ])(
    'returns $status for $headers ($handlerType)',
    async ({ headers, status, calls, handlerType }) => {
      const options = await startInstance.getOptions()
      const handler = options.requestMiddleware?.[0]?.options.server
      expect(handler).toBeTypeOf('function')
      if (!handler)
        throw new Error('Server-function CSRF middleware is not registered')

      const request = new Request('https://money-tracker.example/rpc', {
        method: 'POST',
        headers,
      })
      const next = vi.fn().mockResolvedValue({
        request,
        pathname: '/rpc',
        context: undefined,
        response: new Response('ok'),
      })
      const result = await handler({
        request,
        pathname: '/rpc',
        context: undefined,
        handlerType: handlerType ?? 'serverFn',
        next,
      })

      expect(
        result instanceof Response ? result.status : result.response.status,
      ).toBe(status)
      expect(next).toHaveBeenCalledTimes(calls)
    },
  )
})
