#!/usr/bin/env bash
# Dev server for a design4pro sandbox: the CLI port overrides vite.config.ts (3010, strictPort).
# vite.config.ts sets no server.allowedHosts, so the public preview host is accepted only because the
# sandbox allows it on its side (e.g. __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS); without that Vite answers 403.
set -euo pipefail

exec pnpm exec vite dev --port "${APP_PORT:?APP_PORT is not set}" --host 0.0.0.0
