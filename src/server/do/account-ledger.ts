/**
 * `AccountLedger` as the runtime instantiates it: the class from `./ledger` with its real
 * rebuild port bound.
 *
 * It lives here rather than in `src/server/worker.ts` because two entry modules need the same
 * class and neither may own it. The deployed entry re-exports it (`wrangler.jsonc` names that
 * file as `main`, and a Durable Object class the runtime cannot find on the entry module's
 * exports is a deploy failure rather than a runtime one); the `workerd` vitest project's entry
 * re-exports it too, and pulls in nothing else - which is the whole reason it is a separate
 * entry.
 */

import { dbFromEnv } from '../db/from-env'
import { rebuildAccountBalance } from '../repos/account-balances'
import { AccountLedger as LedgerObject } from './ledger'

/**
 * **Constructed with its real rebuild port.**
 *
 * `AccountLedger` in `./ledger` is declared against narrow port interfaces
 * (`AccountLedgerState`, `AccountLedgerStorage`, `RebuildPort`) rather than against
 * `DurableObjectState`, which is what lets it be constructed with fakes in a plain Node test. A
 * real `DurableObjectState` satisfies those ports structurally; the two descriptions are of the
 * same runtime object and only the static types cannot see it, so this subclass is the one place
 * they meet.
 *
 * The subclass exists for one reason: the runtime instantiates a Durable Object with exactly
 * `(state, env)`, so an injected dependency has nowhere else to enter. Without the port the
 * object answers `'skipped'` to every rebuild and every account balance in the product stays at
 * zero.
 */
export class AccountLedger extends LedgerObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      rebuild: (accountId) => rebuildAccountBalance(dbFromEnv(env), accountId),
    })
  }
}
