/**
 * MCP must not add a Durable Object next to LEDGER (ADR 0037).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

describe('wrangler Durable Object bindings', () => {
  it('still bind only LEDGER / AccountLedger', () => {
    const source = readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8')
    expect(source).toMatch(/"name": "LEDGER"/)
    expect(source).toMatch(/"class_name": "AccountLedger"/)
    expect(source).not.toMatch(/McpAgent/)
    expect(source.match(/"class_name":/g)?.length).toBe(2)
  })
})
