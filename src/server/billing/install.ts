/**
 * Installs the plan-limit resolver into the repository layer. Imported for its side effect only.
 *
 * `src/server/repos/base.ts` declares the seam and defaults it to **permissive**: until something
 * installs a resolver, nothing is capped. That default is right for a product without billing and
 * wrong the moment billing exists, so this module is imported by the Worker entry beside
 * `./ledger` — one import, at isolate start, before any request is served.
 *
 * Module level rather than per request, because the answer is request-independent: the resolver is
 * a function, and the workspace it answers about arrives as its argument.
 *
 * **The import direction matters.** `base.ts` knows nothing about plans (its `QuotaMetric` is a
 * string alias precisely so the data layer does not pull the browser-safe catalogue in), and this
 * module knows about both. Reversing that would put `#/lib/plans` into every repository's import
 * graph to satisfy a type.
 */

import { setLimitResolver } from '#/server/repos/base'

import { resolveLimit } from './resolve-limits'

setLimitResolver((scope, metric) => resolveLimit(scope, metric))
