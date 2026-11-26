# Contributing to Money Tracker

The pilot follows MoneyMatter v0.34.3 where the pilot scope calls for it. Keep changes scoped to the pilot and use English for code, documentation, commits, and external artifacts.

Each workspace under `apps/` has its own npm lockfile. Use `npm ci` and run `npm run check`, `npm test`, and `npm run build` in the affected package. Run `npm test --prefix scripts` when changing repository verification or operations scripts. Commit lockfile updates with dependency changes.

Land changes through reviewed pull requests. Keep production credentials and data out of the repository, local builds, pull-request checks, and logs. Changes to live resources, access controls, payment settings, and the first production cutover require operator approval. See the [operator runbook](README.md) for environment and release requirements.
