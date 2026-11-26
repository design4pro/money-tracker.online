import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

const wrangler = JSON.parse(readFileSync("wrangler.json", "utf8"));
const env = wrangler.env[target];
const databaseId = env.d1_databases[0].database_id;
const kvIds = env.kv_namespaces.map(({ id }) => id);
if (
  /^00000000-0000-4000-8000-00000000000[123]$/.test(databaseId) ||
  kvIds.some((id) => /^0{30}[123][01]$/.test(id))
) {
  throw new Error(
    `Replace the synthetic ${target} D1 and KV IDs in wrangler.json`,
  );
}

execFileSync("npm", ["run", "build"], {
  env: { ...process.env, CLOUDFLARE_ENV: target },
  stdio: "inherit",
});
execFileSync(
  resolve("node_modules/.bin/wrangler"),
  [
    "deploy",
    "--var",
    `SOURCE_SHA:${sourceSha}`,
    "--var",
    `CF_ACCESS_TEAM_DOMAIN:${teamDomain}`,
  ],
  { stdio: "inherit" },
);
