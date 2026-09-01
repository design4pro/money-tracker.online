Start at `CLAUDE.md` — it holds the project rules, commands and agent-skill configuration.
The block below is generated TanStack guidance (owned by `@tanstack/intent`; do not edit it by
hand): run the matching command before editing TanStack-adjacent files.

Four prohibitions are repeated here on purpose, because some tools read only this file. They are
deliberately duplicated, and if they ever disagree with `CLAUDE.md`, **`CLAUDE.md` wins**:

1. Money is integer minor units, everywhere, at every layer. No float ever touches an amount.
2. All SQL goes through the tenant-scoped repository in `src/server/repos`. Never write raw SQL
   in a route, a server function or a component.
3. `src/routeTree.gen.ts` and everything under `drizzle/` are generated. Regenerate; never edit.
4. No bank connectors, no scraping of a bank, no third-party aggregator. Permanently out of scope.

<!-- intent-skills:start -->
<!-- intent-skills:end -->
