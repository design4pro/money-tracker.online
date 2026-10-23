# Pre-flight

Written by `super-board lint` on 2026-10-22. Every `[ ]` is a halt gate for `super-board run`: the
loop does not start until it is `[✓]`. A `[✓]` means the command next to it was run and its output
read; re-run it before trusting the line after a toolchain or account change.

Scanned: project 20 ("Money-tracker board"), the card on it (#747), and `docs/super-board/PROJECT.md`.

## Credentials the loop needs

- [✓] GitHub account `design4pro-agent` is signed in and active (`GH_CONFIG_DIR=$HOME/.config/gh-agent gh auth status`).
  Token scopes: `gist`, `project`, `read:org`, `repo`, `workflow`.
- [ ] The robot token's expiry date. GitHub returns no `github-authentication-token-expiration`
      header for it (`gh api -i user`), so the date cannot be read from here. Check it under
      Settings -> Developer settings -> Tokens (classic) for `design4pro-agent`, renew before it
      lapses, then mark this line.
- [✓] No login for the end-to-end suite is needed by #747: `e2e/toast-close-button.spec.ts` mounts a
  harness (`./support/mount-harness`) and imports no sign-in helper. A card that does sign in
  needs the role and `passwordEnv` name from `.ai/qa/test-env.json`, which does not exist in this
  checkout.
- [✓] No Sentry token is needed: `sentry` is not in `collect.sources`.

## Tools the loop needs

- [✓] Node v26.12.0 (`engines.node` is `>=24`).
- [✓] pnpm 10.15.0 (`packageManager` is `pnpm@10.15.0`); `pnpm install --frozen-lockfile` succeeds in a fresh worktree.
- [✓] `gh` 2.103.0, which is past the 2.82.1 the robot's `gh issue edit` exception needs (`docs/agents/super-board.md`).
- [✓] Playwright 1.62.1 with the Chromium it expects: `pnpm exec playwright install --dry-run chromium`
  names `chromium-1234`, `chromium_headless_shell-1234` and `ffmpeg-1011`, and all three are in
  `~/Library/Caches/ms-playwright`.

## Environment

- [✓] Ports 3010-3020 are free (`lsof -nP -iTCP:3010-3020 -sTCP:LISTEN` prints nothing). Playwright
  refuses a base URL outside that range; agents in a shared checkout use 3011-3020.
- [✓] The local D1 database is migrated and the demo workspace is present. On 2026-10-23
  `wrangler d1 migrations list money-tracker-db --local` named `0004_saas_billing_events.sql` and
  `0005_useful_professor_monster.sql` as pending; `pnpm db:migrate:local` applied both and the same
  command now prints `No migrations to apply!`. The `demo-household` organization holds 624
  transactions. The seed's own audit (`scripts/seed/verify.mjs`) was not run.
- [✓] The board lists its cards. On 2026-10-22 `gh project item-list 20 --owner design4pro`
  returned 0 items while #747 reported `projectItems` 1; on 2026-10-23 it prints `total=1`, `#747`
  in `Ready`. The earlier 0 was a delay on GitHub's side. Item #747 had an empty Status that day
  and was set to Ready again. The project's "Auto-add sub-issues to project" workflow is now
  disabled (no workflow is enabled), so a parent added to the board no longer drags its sub-issues
  in with an empty Status.
