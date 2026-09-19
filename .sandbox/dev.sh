#!/usr/bin/env bash
# Dev server for a design4pro sandbox: the CLI port overrides vite.config.ts (3010, strictPort).
exec pnpm exec vite dev --port "$APP_PORT" --host 0.0.0.0
