/**
 * The entry module the `workerd` vitest project loads (`vitest.config.ts`).
 *
 * A Durable Object binding resolves against the *entry module's* exports, so a test that reaches
 * `env.LEDGER` needs a module that exports `AccountLedger`. The real entry, `src/server/worker.ts`,
 * does export it - and also pulls the whole TanStack Start application in behind it, which buys
 * these tests nothing and costs the isolate everything.
 *
 * So both entries re-export the same class from `./do/account-ledger`, and this one re-exports
 * nothing else. It is not deployed: `wrangler.jsonc` still names `src/server/worker.ts` as `main`,
 * and only the pool's `main` points here.
 */
export { AccountLedger } from './do/account-ledger'

/**
 * A `fetch` because a Workers module entry must have one; the tests address the Durable Object
 * through its binding and never through `SELF`.
 */
export default {
  fetch(): Response {
    return new Response('workerd test entry', { status: 404 })
  },
} satisfies ExportedHandler<Env>
