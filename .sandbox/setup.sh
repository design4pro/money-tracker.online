#!/usr/bin/env bash
# Provisions this checkout inside a design4pro sandbox (github.com/design4pro/sandbox).
# The sandbox exports APP_PORT (the dev server port) and APP_URL (the public preview URL).
set -euo pipefail

HUSKY=0 pnpm install --frozen-lockfile

# Throwaway secrets for a database that lives and dies with the sandbox; real credentials never land here.
if [ ! -f .dev.vars ]; then
  grep -v -E '^(BETTER_AUTH_SECRET|APP_URL)=' .dev.vars.example > .dev.vars
  echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .dev.vars
  echo "APP_URL=${APP_URL}" >> .dev.vars
fi
[ -f .env.local ] || { [ -f .env.local.example ] && cp .env.local.example .env.local; } || true

pnpm db:migrate:local
