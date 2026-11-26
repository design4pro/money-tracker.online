import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const [action, tier, ...extra] = process.argv.slice(2)
if (
  !["deploy", "migrate"].includes(action) ||
  !["staging", "production"].includes(tier)
) {
  throw new Error("Expected deploy or migrate and staging or production")
}

const source = JSON.parse(readFileSync("wrangler.jsonc", "utf8"))
const { env: environments, ...shared } = source
const target = environments[tier]
const database = target.d1_databases[0]
const databaseId = process.env.D1_DATABASE_ID || database.database_id
const isUuid = (value) =>
  /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)
if (!isUuid(databaseId) || databaseId.startsWith("00000000-")) {
  throw new Error(
    "Set D1_DATABASE_ID to the target environment's D1 database UUID"
  )
}
database.database_id = databaseId

let config = { ...shared, ...target }
let directory = "."
if (action === "deploy") {
  const output = "dist/server/wrangler.json"
  const built = JSON.parse(readFileSync(output, "utf8"))
  directory = dirname(output)
  const vars = { ...target.vars }
  for (const key of [
    "APP_ORIGIN",
    "EMAIL_FROM",
    "POLAR_MONTHLY_PRODUCT_ID",
    "POLAR_YEARLY_PRODUCT_ID",
    "SOURCE_SHA",
  ]) {
    vars[key] = process.env[key] || vars[key]
  }
  const origin = new URL(vars.APP_ORIGIN)
  if (
    origin.protocol !== "https:" ||
    origin.origin !== vars.APP_ORIGIN ||
    origin.hostname.endsWith(".invalid")
  ) {
    throw new Error("Set APP_ORIGIN to the target HTTPS origin")
  }
  if (
    !/^\S+@\S+\.\S+$/.test(vars.EMAIL_FROM) ||
    vars.EMAIL_FROM.endsWith(".invalid")
  ) {
    throw new Error("Set EMAIL_FROM to the target verified sender")
  }
  if (
    !isUuid(vars.POLAR_MONTHLY_PRODUCT_ID) ||
    !isUuid(vars.POLAR_YEARLY_PRODUCT_ID) ||
    vars.POLAR_MONTHLY_PRODUCT_ID === vars.POLAR_YEARLY_PRODUCT_ID
  ) {
    throw new Error("Set two distinct Polar product UUIDs")
  }
  if (!/^[a-f\d]{40}$/i.test(vars.SOURCE_SHA ?? ""))
    throw new Error("Set SOURCE_SHA to the built commit SHA")
  database.migrations_dir = "../../migrations"
  config = {
    ...config,
    vars,
    main: built.main,
    assets: built.assets,
    rules: built.rules,
    no_bundle: true,
    upload_source_maps: true,
  }
}

const path = resolve(directory, `.wrangler-pilot-${randomUUID()}.json`)
const args =
  action === "deploy"
    ? ["deploy"]
    : ["d1", "migrations", "apply", "DB", "--remote"]
writeFileSync(path, JSON.stringify(config), { flag: "wx", mode: 0o600 })
try {
  const result = spawnSync("wrangler", [...args, "--config", path, ...extra], {
    stdio: "inherit",
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  unlinkSync(path)
}
