/// <reference types="vite/client" />

/**
 * The build-time public values this application reads, declared so a typo is a type error.
 *
 * Only the names `.env.local.example` inventories belong here. Everything a *Worker* reads lives
 * in `worker-configuration.d.ts` and arrives through `env`, never through `import.meta.env`:
 * while a `.dev.vars` file exists Cloudflare loads no `.env` file into the Worker's environment,
 * so a runtime secret placed in `.env.local` is silently `undefined` rather than an error.
 *
 * `vite/client` declares `ImportMetaEnv` with an index signature, so these are additive: an
 * unlisted `VITE_*` name still compiles. They are listed because the four product ids decide
 * whether a checkout opens, and `undefined` is a supported value for each of them.
 */
interface ImportMetaEnv {
  readonly VITE_POLAR_PRODUCT_PLUS_MONTHLY?: string
  readonly VITE_POLAR_PRODUCT_PLUS_YEARLY?: string
  readonly VITE_POLAR_PRODUCT_HOUSEHOLD_MONTHLY?: string
  readonly VITE_POLAR_PRODUCT_HOUSEHOLD_YEARLY?: string
}
