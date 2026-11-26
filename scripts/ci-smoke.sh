#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_SHA:?Expected Git SHA}"
export APP_URL=http://127.0.0.1:8787
export SITE_URL=http://127.0.0.1:8788
export FACTORY_URL=http://127.0.0.1:8789
export SIGN_IN_URL="${APP_URL}${SMOKE_SIGN_IN_PATH:-/sign-in}"
export APP_PROTECTED_PATH="${SMOKE_APP_PROTECTED_PATH:-/}"
export CMS_ADMIN_PATH="${SMOKE_CMS_ADMIN_PATH:-/admin}"
export CMS_UNAUTHENTICATED_STATUS="${SMOKE_CMS_UNAUTHENTICATED_STATUS:-401}"

logs=$(mktemp -d)
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill -- "-$pid" 2>/dev/null || true; done
  rm -rf "$logs"
}
trap cleanup EXIT

start() {
  local worker=$1 port=$2
  shift 2
  (
    cd "apps/$worker"
    exec setsid ./node_modules/.bin/wrangler dev --env staging --ip 127.0.0.1 \
      --port "$port" --var "SOURCE_SHA:$GITHUB_SHA" "$@"
  ) >"$logs/$worker.log" 2>&1 &
  pids+=("$!")
}

start app 8787
start site 8788 --var "APP_URL:$APP_URL" --var "SIGN_IN_URL:$SIGN_IN_URL"
start factory 8789
for url in "$APP_URL" "$SITE_URL" "$FACTORY_URL"; do
  ready=false
  for ((attempt = 0; attempt < 45; attempt++)); do
    if curl --silent --fail --max-time 1 "$url/health" >/dev/null; then
      ready=true
      break
    fi
    sleep 1
  done
  if [[ "$ready" != true ]]; then
    for log in "$logs"/*.log; do cat "$log"; done
    exit 1
  fi
done
node scripts/smoke.mjs "$GITHUB_SHA" --local
