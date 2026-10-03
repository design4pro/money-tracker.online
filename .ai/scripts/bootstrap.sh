#!/usr/bin/env bash
# Leading check step of a cezar workflow: dependencies installed with retries, then the route tree.
#
#   bash .ai/scripts/bootstrap.sh
#
# Why a script and not the one-liner it replaces (`HUSKY=0 pnpm install --frozen-lockfile
# --prefer-offline && pnpm generate-routes`): a check step cannot retry itself (`onFail.retry`
# re-runs an AGENT step, and a run's leading step has none to run), so one failed `pnpm install` -
# a registry blip, a 5xx from the CDN, a reset socket - ended the whole run `failed` before any
# agent had started. The Reconciler repairs failed runs, but a transient network error is cheaper
# to absorb here than to repair from outside. A real failure (a lockfile that does not match, a
# package that does not exist) fails all three attempts the same way and still ends the step red.
#
# HUSKY=0 skips `prepare: husky`, which would rewrite core.hooksPath in the host clone's config that
# every worktree shares; the one-liner set it unconditionally and so does this.
#
# `BOOTSTRAP_RETRY_DELAYS` is the seconds to wait before each further attempt, so its length sets
# the attempt count; the default is three attempts with 30 s and 60 s between them. It exists for the
# test, which would otherwise sleep for a minute and a half.
set -euo pipefail
cd "$(dirname "$0")/../.."

# shellcheck disable=SC2206 # splitting the delay list on whitespace is the point
delays=(${BOOTSTRAP_RETRY_DELAYS:-30 60})
attempts=$((${#delays[@]} + 1))

for ((attempt = 1; attempt <= attempts; attempt++)); do
  if HUSKY=0 pnpm install --frozen-lockfile --prefer-offline; then
    break
  fi
  if ((attempt == attempts)); then
    echo "bootstrap: pnpm install failed after ${attempts} attempts" >&2
    exit 1
  fi
  delay=${delays[attempt - 1]}
  echo "bootstrap: pnpm install failed (attempt ${attempt} of ${attempts}); retrying in ${delay}s" >&2
  sleep "$delay"
done

pnpm generate-routes
