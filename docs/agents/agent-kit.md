# Files rendered by agent-kit

**What this is.** The rule for the files in this repository that `design4pro/agent-kit` generates,
and the decision behind the `agent-kit` block in `.prettierignore`: **a rendered file is outside
Prettier, permanently.** Decided on #122 from the measurement below; the alternative is in
"Why the kit does not render Prettier-shaped output".

## What is rendered, and what holds it in place

- `.ai/agent-kit.lock.json` records a sha256 per rendered path - 33 paths at `kitVersion` 24.
- `node .ai/scripts/agent-kit-check.mjs` re-hashes every one of them and exits 1 on a mismatch. It
  is the **first** entry in `validation.commands` (`.ai/agentic.config.json`), so it is the first
  rung of every gate, local and CI.
- `.prettierignore` carries a `# agent-kit:begin … # agent-kit:end` block listing those 33 paths
  plus the lock itself. The kit's sync writes that block; it is not edited by hand.

The lock's `watched` half is a different thing and is deliberately not in the block: `skills-lock.json`
is pinned, not rendered, `pnpm install-skills` writes it, and it is Prettier-clean under this
repository's config - so there is nothing for the block to protect.

Without the block, three separate things reformat a rendered file, none of them announcing it:

- `prettier --write .` (`pnpm format`), and `pnpm check` reports it,
- `lint-staged` on pre-commit - `"*": "prettier --ignore-unknown --write"`,
- `.claude/hooks/format-file.sh`, the PostToolUse hook that formats whatever an agent just edited.

All three honour `.prettierignore`, including for an explicitly named file. That is the only reason
the block works at all.

## Why the kit does not render Prettier-shaped output

The alternative was for the kit to emit text that is already Prettier-clean in each consumer, so the
block could shrink to the paths that genuinely conflict. Two independent reasons it does not work.

**One template, two renders.** The kit renders the same template into this repository and into
`planned.travel`, and the lock compares bytes. Per-repository substitutions change line width:
`money-tracker-online-db` is nine characters longer than `planned-travel-db`, which is what pushed
three assertions in `.claude/hooks/__tests__/hooks.test.ts` past 80 columns and got them reflowed by
the pre-commit hook while #120 was being written. A single template cannot be Prettier-clean on both
sides of a substitution that changes the width.

**The kit is its own formatting authority.** This repository's `prettier.config.js` is `semi: false`,
`singleQuote: true` and the default `printWidth` of 80. The kit renders `.ai/scripts/agent-kit-check.mjs`
with semicolons and double quotes throughout. Reconciling that means the kit carrying every
consumer's Prettier config and re-rendering all consumers whenever one of them changes a formatting
option - coupling the kit exists to avoid.

## The measurement

On `develop` at `3498f9b`, 13 September 2026, running
`pnpm exec prettier --ignore-path .gitignore --check` over each of the block's 34 entries - the flag
is what makes Prettier look past `.prettierignore` and answer the question at all:

| Entries | Prettier status   | What the ignore entry is doing            |
| ------- | ----------------- | ----------------------------------------- |
| 20      | clean today       | insurance; the next render may not be     |
| 6       | **not clean**     | load-bearing - without it the gate is red |
| 8       | no parser (`.sh`) | a no-op; Prettier never touches them      |

The six are `.ai/scripts/agent-kit-check.mjs`, `.ai/trackers/github.md`,
`.claude/hooks/__tests__/hooks.test.ts`, `scripts/ci/review-threads-label.mjs`,
`scripts/ci/__tests__/review-threads-label.test.mjs` and
`scripts/ci/__tests__/review-workflow-base-checkout.test.ts`. What Prettier wants to change in them
is quote style and semicolons, Markdown emphasis (`*required*` against `_required_`), and line
wrapping in both directions. Those are config-level disagreements, not stray whitespace: they do not
get fixed once and stay fixed.

So the block is not insurance against a hypothetical conflict. #122 opened on the premise that it
was, which was true of the one file it checked and is not true of the set.

## If you are editing a rendered file

**Prettier is not watching it, and the lock is.** A formatting change to a rendered file is
indistinguishable from any other hand edit: `agent-kit-check.mjs` re-hashes it, exits 1, and the gate
goes red on its first command - before typecheck, before the tests.

- **Do not hand-edit a rendered file, formatting included.** Change the template in
  `design4pro/agent-kit`, re-render, and let the sync move the file and the lock in one commit. This
  is true of `.claude/hooks/__tests__/hooks.test.ts` - 700-odd lines that people do edit here -
  exactly as it is of the rest.
- **A rendered file's house style is the kit's, not this repository's.** Do not align its quotes or
  its wrapping with the files around it; the next render undoes the change and the lock reports it.
- `node .ai/scripts/agent-kit-check.mjs` answers "did I touch something managed?" offline, in
  under a second, before CI has to.

## When the block shrinks

When a path leaves the kit - the sync drops it from the lock and from the block in the same commit.
Not by hand, and not because the file happens to be Prettier-clean this week.
