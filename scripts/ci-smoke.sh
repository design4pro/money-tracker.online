#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_SHA:?Expected Git SHA}"
export WRANGLER_SEND_METRICS=false
export APP_URL=http://127.0.0.1:8787
export SITE_URL=http://127.0.0.1:8788
export FACTORY_URL=http://127.0.0.1:8789
export SIGN_IN_URL="${APP_URL}${SMOKE_SIGN_IN_PATH:-/login}"
export APP_REGISTER_PATH="${SMOKE_APP_REGISTER_PATH:-/register}"
export APP_PROTECTED_PATH="${SMOKE_APP_PROTECTED_PATH:-/billing}"
export CMS_ADMIN_PATH="${SMOKE_CMS_ADMIN_PATH:-/_emdash/admin}"
export CMS_LOGIN_URL="${SMOKE_CMS_LOGIN_URL:-/_emdash/admin/login}"
export CMS_UNAUTHENTICATED_STATUS="${SMOKE_CMS_UNAUTHENTICATED_STATUS:-}"
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

migrate() (
  local worker=$1 binding=$2
  cd "apps/$worker"
  CI=true ./node_modules/.bin/wrangler d1 migrations apply "$binding" --env staging \
    --local --persist-to "$state/$worker"
)

start() {
  local worker=$1 port=$2
  shift 2
  (
    cd "apps/$worker"
    exec setsid ./node_modules/.bin/wrangler dev --local --env staging --ip 127.0.0.1 \
      --port "$port" --inspector-port "$((port + 100))" --infer-origin-from-routes=false \
      --persist-to "$state/$worker" --var "SOURCE_SHA:$GITHUB_SHA" "$@"
  ) >"$state/$worker.log" 2>&1 &
  pids+=("$!")
}

migrate app "${SMOKE_APP_D1_BINDING:-DB}"
for worker in site factory; do
  binding_var="SMOKE_${worker^^}_D1_BINDING"
  binding=${!binding_var:-}
  if [[ -z "$binding" && -d "apps/$worker/migrations" ]]; then binding=DB; fi
  if [[ -n "$binding" ]]; then migrate "$worker" "$binding"; fi
done

start app 8787 --var "BETTER_AUTH_URL:$APP_URL" \
  --var 'BETTER_AUTH_SECRET:synthetic-ci-only-never-use-outside-local-smoke'
start site 8788 --var "APP_URL:$APP_URL" --var "PUBLIC_APP_URL:$APP_URL" \
  --var "SIGN_IN_URL:$SIGN_IN_URL"
start factory 8789
urls=("$APP_URL" "$SITE_URL" "$FACTORY_URL")
for index in "${!urls[@]}"; do
  url=${urls[index]}
  ready=false
  for ((attempt = 0; attempt < 45; attempt++)); do
    if curl --silent --fail --max-time 1 "$url/health" >/dev/null; then
      ready=true
      break
    fi
    if ! kill -0 "${pids[index]}" 2>/dev/null; then break; fi
    sleep 1
  done
  if [[ "$ready" != true ]]; then
    for log in "$state"/*.log; do cat "$log"; done
    exit 1
  fi
done
node scripts/smoke.mjs "$GITHUB_SHA" --local
