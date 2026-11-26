#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_SHA:?Expected Git SHA}"
export WRANGLER_SEND_METRICS=false
export APP_URL=http://localhost:3000
export SITE_URL=http://127.0.0.1:8788
export FACTORY_URL=http://127.0.0.1:8789
export SIGN_IN_URL="${APP_URL}${SMOKE_SIGN_IN_PATH:-/login}"
export APP_REGISTER_PATH="${SMOKE_APP_REGISTER_PATH:-/register}"
export APP_PROTECTED_PATH="${SMOKE_APP_PROTECTED_PATH:-/billing}"
export CMS_ADMIN_PATH="${SMOKE_CMS_ADMIN_PATH:-/_emdash/admin}"
export CMS_LOGIN_URL="${SMOKE_CMS_LOGIN_URL:-/_emdash/admin/login}"
export CMS_UNAUTHENTICATED_STATUS=403
unset APP_ACCESS_CLIENT_ID APP_ACCESS_CLIENT_SECRET SITE_ACCESS_CLIENT_ID SITE_ACCESS_CLIENT_SECRET
unset FACTORY_ACCESS_CLIENT_ID FACTORY_ACCESS_CLIENT_SECRET CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY

state=$(mktemp -d)
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill -- "-$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
  rm -rf "$state"
}
trap cleanup EXIT

start() {
  local worker=$1 port=$2
  shift 2
  (
    cd "apps/$worker"
    exec setsid ./node_modules/.bin/wrangler dev --local --ip 127.0.0.1 \
      --port "$port" --inspector-port "$((port + 100))" \
      --persist-to "$state/$worker" --var "SOURCE_SHA:$GITHUB_SHA" "$@"
  ) >"$state/$worker.log" 2>&1 &
  pids+=("$!")
}

(
  cd apps/app
  CI=true ./node_modules/.bin/wrangler d1 migrations apply DB \
    --config wrangler.jsonc --local --persist-to "$state/app"
)
start app 3000 --config dist/server/wrangler.json --var "APP_ORIGIN:$APP_URL" \
  --var 'BETTER_AUTH_SECRET:synthetic-ci-only-never-use-outside-local-smoke'
start factory 8789 --env staging

# Seed via Astro dev on a separate loopback port. Test access against the
# production build with the same local D1 state and without any admin cookies.
(
  cd apps/site
  unset CLOUDFLARE_ENV
  export SITE_LOCAL_STATE="$state/site"
  exec setsid ./node_modules/.bin/astro dev --ignore-lock --host 127.0.0.1 --port 8790
) >"$state/site-seed.log" 2>&1 &
seed_pid=$!
pids+=("$seed_pid")

ready() {
  local url=$1 pid=$2
  for ((attempt = 0; attempt < 60; attempt++)); do
    if curl --silent --fail --max-time 2 "$url" >/dev/null; then return; fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done
  for log in "$state"/*.log; do cat "$log"; done
  return 1
}
ready 'http://127.0.0.1:8790/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin' "$seed_pid"
ready 'http://127.0.0.1:8790/health' "$seed_pid"
kill -- "-$seed_pid"
wait "$seed_pid" || true
unset 'pids[2]'

start site 8788 --config dist/server/wrangler.json --var "APP_ORIGIN:$APP_URL" \
  --var 'CF_ACCESS_TEAM_DOMAIN:example.cloudflareaccess.com' \
  --var 'CF_ACCESS_AUDIENCE:synthetic-local-access-audience'

ready "$APP_URL/health" "${pids[0]}"
ready "$FACTORY_URL/health" "${pids[1]}"
ready "$SITE_URL/health" "${pids[2]}"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 \
  "$SITE_URL/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin")" = 403
node scripts/smoke.mjs "$GITHUB_SHA" --local
