#!/usr/bin/env bash
# PreToolUse hook (Edit|Write): blocks hand-edits of generated files.
#
# Each of these has a generator, and the generator is the source of truth. A hand-edit survives
# exactly until the next run of it, and in between produces the worst kind of failure: one that
# reproduces on one machine and not another.
#
# Contract: exit 2 blocks the tool call and feeds stderr back to the model; exit 0 allows.
set -euo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

[ -z "$file_path" ] && exit 0

case "$file_path" in
  */src/routeTree.gen.ts)
    echo "BLOCKED: src/routeTree.gen.ts is generated from the files under src/routes. Run 'pnpm generate-routes' instead of editing it." >&2
    exit 2
    ;;
  */drizzle/*.sql | */drizzle/meta/*)
    echo "BLOCKED: drizzle/ is generated from src/server/db/*-schema.ts. Change the schema and run 'pnpm db:generate' instead of editing SQL or the journal by hand - a hand-written migration is invisible to the drift check in CI, and migrations must stay additive." >&2
    exit 2
    ;;
  */worker-configuration.d.ts)
    echo "BLOCKED: worker-configuration.d.ts is generated from wrangler.jsonc. Change the bindings there and run 'pnpm exec wrangler types' instead of editing it." >&2
    exit 2
    ;;
  */e2e/__screenshots__/*)
    echo "BLOCKED: Playwright baselines change only via 'pnpm e2e:update' (darwin) or the update-snapshots workflow (linux), never by direct edits." >&2
    exit 2
    ;;
esac

exit 0
