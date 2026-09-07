#!/bin/sh
# om-prepare-test-env: generated entrypoint (contract v2)
# regenerate with: om-prepare-test-env --regenerate
# history:
#   2026-09-06 generated: stops the dev server test-env-up.sh recorded and marks the descriptor
#              stopped. Touches nothing it did not start; safe to run twice.
set -eu

QA_DIR=.ai/qa
ENV_DESCRIPTOR="$QA_DIR/test-env.json"
LOCK_DIR="$QA_DIR/test-env.lock"

cd "$(dirname "$0")/../.."

json_field() { sed -n "s/.*\"$1\": *\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" "$2" 2>/dev/null | head -1 | sed "s/[[:space:]]*$//"; }

[ -f "$ENV_DESCRIPTOR" ] || { echo "test-env-down: nothing recorded"; exit 0; }

if [ "$(json_field startedByThisRepo "$ENV_DESCRIPTOR")" = true ]; then
  PID=$(json_field pid "$ENV_DESCRIPTOR")
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    pkill -TERM -P "$PID" 2>/dev/null || true
    kill -TERM "$PID" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$PID" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "$PID" 2>/dev/null || true
    echo "test-env-down: stopped pid $PID"
  else
    echo "test-env-down: recorded pid ${PID:-none} is not running"
  fi
fi

sed -i.bak 's/"status": "running"/"status": "stopped"/' "$ENV_DESCRIPTOR" && rm -f "$ENV_DESCRIPTOR.bak"

owner=$(json_field pid "$LOCK_DIR/owner.json")
if [ -d "$LOCK_DIR" ] && { [ -z "$owner" ] || ! kill -0 "$owner" 2>/dev/null; }; then
  rm -rf "$LOCK_DIR"
fi
echo "TEST_ENV_STATUS=stopped"
