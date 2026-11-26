import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const target = process.argv[2];
if (!["staging", "production"].includes(target)) {
  throw new Error("Expected staging or production");
}

const sourceSha =
  process.env.SOURCE_SHA ??
  execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceSha))
  throw new Error("SOURCE_SHA must be a full Git commit SHA");

const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;
if (
  !teamDomain ||
  !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain) ||
  teamDomain === "example.cloudflareaccess.com"
) {
  throw new Error("Set CF_ACCESS_TEAM_DOMAIN to the Access team hostname");
}

const databaseId = process.env.SITE_D1_DATABASE_ID;
const cacheId = process.env.SITE_CACHE_KV_ID;
const sessionId = process.env.SITE_SESSION_KV_ID;
const bucket = process.env.SITE_MEDIA_BUCKET;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const kv = /^[0-9a-f]{32}$/i;
if (
  !databaseId ||
  !uuid.test(databaseId) ||
  databaseId.startsWith("00000000-") ||
  !cacheId ||
  !kv.test(cacheId) ||
  /^0{30}/.test(cacheId) ||
  !sessionId ||
  !kv.test(sessionId) ||
  /^0{30}/.test(sessionId) ||
  cacheId === sessionId ||
  databaseId === process.env.D1_DATABASE_ID ||
  !bucket ||
  !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(bucket)
) {
  throw new Error(
    "Set distinct real site D1, KV and R2 bindings for the target environment",
  );
}
function origin(key) {
  const value = process.env[key];
  const url = URL.parse(value ?? "");
  if (url?.protocol !== "https:" || url.origin !== value) {
    throw new Error(`Set ${key} to the target HTTPS origin`);
  }
  return value;
}
const appOrigin = origin("APP_ORIGIN");
const siteOrigin = origin("SITE_URL");

execFileSync("npm", ["run", "build"], {
  env: { ...process.env, CLOUDFLARE_ENV: target },
  stdio: "inherit",
});
const redirect = ".wrangler/deploy/config.json";
const builtPath = resolve(
  dirname(redirect),
  JSON.parse(readFileSync(redirect, "utf8")).configPath,
);
const config = JSON.parse(readFileSync(builtPath, "utf8"));
config.d1_databases.find(({ binding }) => binding === "DB").database_id =
  databaseId;
config.kv_namespaces.find(({ binding }) => binding === "CACHE").id = cacheId;
config.kv_namespaces.find(({ binding }) => binding === "SESSION").id =
  sessionId;
config.r2_buckets.find(({ binding }) => binding === "MEDIA").bucket_name =
  bucket;
config.vars = {
  ...config.vars,
  APP_ORIGIN: appOrigin,
  EMDASH_SITE_URL: siteOrigin,
  SOURCE_SHA: sourceSha,
  CF_ACCESS_TEAM_DOMAIN: teamDomain,
};
config.keep_vars = true;

const path = resolve(
  dirname(builtPath),
  `.wrangler-pilot-${randomUUID()}.json`,
);
writeFileSync(path, JSON.stringify(config), { flag: "wx", mode: 0o600 });
try {
  execFileSync(
    resolve("node_modules/.bin/wrangler"),
    ["deploy", "--config", path, ...process.argv.slice(3)],
    { stdio: "inherit" },
  );
} finally {
  unlinkSync(path);
}
