import { defineConfig } from 'drizzle-kit'

/**
 * Migrations are generated into `./drizzle` and applied to D1 with
 * `wrangler d1 migrations apply money-tracker-db` (the `db:migrate:*` scripts). `drizzle` is
 * also the `migrations_dir` in every environment of `wrangler.jsonc`, so a generated file is
 * applied by the deploy without a second registration step.
 *
 * Both schema files are listed explicitly rather than going through `src/server/db/index.ts`,
 * so that generation never depends on the barrel's re-export order. The Better Auth tables live
 * in their own file but are the same database and the same migration history.
 */
const schema = ['./src/server/db/auth-schema.ts', './src/server/db/schema.ts']

/**
 * Two shapes, one config.
 *
 * Migration *generation* — everything `pnpm db:generate` and the CI "schema edit without a
 * committed migration" rung do — is pure SQL diffing against the schema files. It needs no
 * credentials and must keep working in a fork's CI, so plain `dialect: 'sqlite'` is the default.
 *
 * The `d1-http` driver is only for talking to the live database (`drizzle-kit studio`, remote
 * introspection). It activates when all three credentials are present, and is otherwise absent
 * rather than half-configured — a driver with a missing token fails at a confusing depth.
 */
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const databaseId = process.env.D1_DATABASE_ID
const token = process.env.CLOUDFLARE_API_TOKEN

export default accountId && databaseId && token
  ? defineConfig({
      dialect: 'sqlite',
      driver: 'd1-http',
      schema,
      out: './drizzle',
      strict: true,
      verbose: true,
      dbCredentials: { accountId, databaseId, token },
    })
  : defineConfig({
      dialect: 'sqlite',
      schema,
      out: './drizzle',
      strict: true,
      verbose: true,
    })
