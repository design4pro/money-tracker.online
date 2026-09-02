/**
 * The Worker-side half of the ledger batch: where `./batch` gets its `LEDGER` binding from.
 *
 * `./batch` takes its namespace as a port and reaches for nothing, which is what lets its real
 * behaviour — flush on throw, swallow a stub failure, nest without losing the outer collection — be
 * exercised in a plain Node test. This module is the one place that imports `cloudflare:workers`,
 * and it exists so that importing `runWithLedgerBatch` is enough to have a wired one.
 *
 * The wiring is a module-level side effect, which is unusual enough in this codebase to say why:
 * every server function that opens a batch imports from here, and an initialiser somebody has to
 * remember to call from a startup path that TanStack Start does not really have is an initialiser
 * that will eventually not be called. `env.LEDGER` is read **inside** the accessor rather than at
 * module load, because bindings exist only inside a request.
 *
 * A missing binding answers `null` rather than throwing. Local `vite dev` runs the object through
 * Miniflare and has one; a unit test importing a server function does not, and a rebuild that could
 * not be enqueued is repair work the nightly cron redoes — not a reason to fail a write that has
 * already committed.
 */

import { env } from 'cloudflare:workers'

import { createLogger } from '#/server/observability/logger'
import { setLedgerBatchPorts } from './batch'

import type { LedgerNamespace } from './batch'

const logger = createLogger({
  level: env.LOG_LEVEL === 'debug' ? 'debug' : 'info',
  context: { component: 'ledger', route: 'batch' },
})

setLedgerBatchPorts({
  // `Env` types `LEDGER` as always present, because `wrangler.jsonc` binds it on every
  // environment. `env` in a unit-test isolate is not that object, so the value is read as
  // `unknown` and checked, rather than asserted to exist because a `.d.ts` says so.
  namespace: (): LedgerNamespace | null => {
    const binding: unknown = env.LEDGER
    return binding === undefined || binding === null
      ? null
      : (binding as LedgerNamespace)
  },
  onError: (accountId, error) => {
    logger.error('ledger rebuild could not be enqueued', {
      accountId,
      error: error instanceof Error ? error.message : String(error),
    })
  },
})

export { runWithLedgerBatch } from './batch'
export type { LedgerBatchPorts, LedgerNamespace } from './batch'
