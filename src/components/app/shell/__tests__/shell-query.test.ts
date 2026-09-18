import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  SHELL_QUERY_KEY,
  SHELL_STALE_TIME,
  shellQueryOptions,
} from '../shell-query'

const directory = dirname(fileURLToPath(import.meta.url))

describe('shellQueryOptions', () => {
  it('caches the shell under one key, reused for thirty seconds', () => {
    const queryFn = () => Promise.resolve(null)
    const options = shellQueryOptions({ queryFn })

    expect(options.queryKey).toBe(SHELL_QUERY_KEY)
    expect(options.queryFn).toBe(queryFn)
    expect(options.staleTime).toBe(SHELL_STALE_TIME)
    expect(SHELL_STALE_TIME).toBe(30_000)
  })

  /**
   * `src/router.tsx` imports this module, and the router is in every visitor's entry chunk. A
   * server import here would drag `cloudflare:workers` towards the browser bundle; the fetch stays
   * an argument, supplied by `_app.tsx`.
   */
  it('reaches nothing on the server', () => {
    const source = readFileSync(join(directory, '..', 'shell-query.ts'), 'utf8')
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map(
      ([, specifier]) => specifier,
    )

    expect(specifiers.filter((s) => s.includes('server'))).toEqual([])
  })
})
