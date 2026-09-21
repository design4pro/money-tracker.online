# Review checklist

The repo-local list `om-code-review` applies on top of its built-in one (`reviewChecklist` in
`.ai/agentic.config.json`). Each line is a finding when it fails; the severity is in
`CODE_REVIEW.md`. The first block is `docs/SPEC.md` §7 unchanged; the second is the quality floor
every agent branch used to be held to by `scripts/agent/floor-guard.mjs`.

## Definition of done (`docs/SPEC.md` §7)

- [ ] `pnpm build` succeeds.
- [ ] `pnpm lint` and `pnpm typecheck` are clean: no new errors, no suppressions.
- [ ] New logic has tests and `pnpm test` passes. A new repository function has a case in
      `src/server/repos/__tests__/tenant-isolation.test.ts`; a new money-touching write path has a
      case in `src/server/repos/__tests__/money-invariants.test.ts`.
- [ ] A user-facing change was looked at in a real browser: light and dark, 360px and 1280px, with
      the interaction state that is the point of the change. Nothing in CI compares a pixel
      (ADR 0016), so the PR names the screens and a human takes the pair with
      `node scripts/visual/capture.mjs`.
- [ ] No `TODO`, no placeholder copy, no `console.log`, no commented-out code.
- [ ] No file outside the change's stated scope was touched.
- [ ] Every number in the PR body, commits and review came from a command whose output the author
      read (§7.7). A count of "0" was aimed at something that exists.

## Quality floor

- [ ] No added `@ts-ignore` or `@ts-expect-error`.
- [ ] No added `eslint-disable` in any form.
- [ ] No added `.skip`, `.only`, `.todo`, `.fixme`, `xit` or `xdescribe`.
- [ ] No deleted or renamed-away test file; no assertion narrowed to make a gate pass.
- [ ] `src/routeTree.gen.ts` and `drizzle/` are regenerated, never hand-edited, and the drift
      commands in `validation.commands` leave no diff.

## Repo contracts

- [ ] Money: integer minor units at every layer; scale from `currencies.digits`; `ref_amount_minor`
      never recomputed; `rate_e10` travels with every cross-currency amount (`docs/MONEY.md`).
- [ ] Tenancy: SQL only in `src/server/repos` through the scoped base repository; the tenant
      predicate cannot be removed; `src/server/catalog` is the single exception (SPEC §5.2).
- [ ] Every server-function input is Zod-validated and parsed again in the repository; permission
      is enforced server-side, the UI only reflects it.
- [ ] Slow work (import, export, email, backup, ledger rebuild, notification fan-out) is enqueued
      on `TASKS`, never inline; balances are rebuilt through the `LEDGER` Durable Object.
- [ ] A new key exists in both `en.ts` and `pl.ts`; a count goes through the plural machinery.
- [ ] Keyboard path beside every drag; a text table beside every chart; colour never the only
      channel; 44px targets; no claim wider than `docs/ACCESSIBILITY.md`.
- [ ] No new dependency (SPEC §3); no bank connector (ADR 0008); nothing copied from the reference
      product (`docs/agents/reference.md`).
- [ ] A change to a surface in `BACKWARD_COMPATIBILITY.md` follows its required path.
- [ ] A change to `DESIGN.md`, `BACKWARD_COMPATIBILITY.md`, `docs/ACCESSIBILITY.md`, `docs/MONEY.md`
      or `docs/adr/` carries `governance-approved`, applied by a person who read the decision - not
      by a skill (`governance-gate`).
- [ ] Every figure written into a spec, plan, ADR or code comment was re-derived on this head, and a
      headline total agrees with the table beneath it.
- [ ] Every file, job, test, label, automation or mechanism a document or comment names exists on
      this branch and does what the text says.
