import { fileURLToPath } from 'node:url'

import { unstable_readConfig } from 'wrangler'
import { describe, expect, it } from 'vitest'

import { IMPORT_MAX_ROWS } from '#/server/import/types'
import {
  CLAIM_RETRY_DELAY_SECONDS,
  CLAIM_TTL_SECONDS,
} from '#/server/queue/claim'

/**
 * The deployment config is a promise the code does not read: nothing parses `vars.IMPORT_MAX_ROWS`,
 * so a drifted value stays silent until the first handler that trusts it. This test reads the real
 * `wrangler.jsonc` with the installed tooling's own reader, once per environment, and pins the
 * numbers and queue names the queue contract depends on.
 */
const configPath = fileURLToPath(
  new URL('../../../wrangler.jsonc', import.meta.url),
)

const environments = [
  { name: 'production', env: undefined },
  { name: 'staging', env: 'staging' },
] as const

const configs = environments.map(({ name, env }) => ({
  name,
  config: unstable_readConfig({ config: configPath, env }),
}))

describe.each(configs)('wrangler.jsonc ($name)', ({ config }) => {
  const consumer = config.queues.consumers?.[0]
  const producer = config.queues.producers?.[0]

  it('promises the import row cap the code enforces', () => {
    expect(config.vars['IMPORT_MAX_ROWS']).toBe(IMPORT_MAX_ROWS)
  })

  it('keeps the export row cap a positive integer', () => {
    const cap = config.vars['EXPORT_MAX_ROWS']
    expect(Number.isInteger(cap)).toBe(true)
    expect(cap as number).toBeGreaterThan(0)
  })

  it('names a dead-letter queue that is not the consumer queue', () => {
    expect(consumer?.dead_letter_queue).toBeTruthy()
    expect(consumer?.dead_letter_queue).not.toBe(consumer?.queue)
  })

  it('produces to the queue it consumes', () => {
    expect(producer?.queue).toBeTruthy()
    expect(producer?.queue).toBe(consumer?.queue)
  })

  // A held claim is retried after CLAIM_RETRY_DELAY_SECONDS and each retry spends an attempt, so
  // the attempts must outlast the claim's expiry or a claim could outlive the budget and lose a job.
  // The consumer's own `retry_delay` applies only to a plain `retry()`, not to this one.
  it('retries a held claim for longer than the claim lives', () => {
    const maxRetries = consumer?.max_retries
    expect(Number.isInteger(maxRetries)).toBe(true)
    expect((maxRetries as number) * CLAIM_RETRY_DELAY_SECONDS).toBeGreaterThan(
      CLAIM_TTL_SECONDS,
    )
  })
})

describe('wrangler.jsonc across environments', () => {
  const [production, staging] = configs.map(({ config }) => config)

  it('promises the same export row cap in both', () => {
    expect(staging.vars['EXPORT_MAX_ROWS']).toBe(
      production.vars['EXPORT_MAX_ROWS'],
    )
  })

  it('gives each environment its own queue and dead-letter queue', () => {
    const queues = [production, staging].flatMap((config) => {
      const consumer = config.queues.consumers?.[0]
      return [consumer?.queue, consumer?.dead_letter_queue]
    })
    expect(new Set(queues).size).toBe(4)
  })
})
