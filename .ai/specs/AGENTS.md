# Specifications — agent rules

A spec is a designed change: the problem, the solution, the phases and the assertions that say each
phase landed. `docs/plans/` is the backlog source and GitHub Issues the execution surface
(`docs/plans/README.md`); a spec is what sits between them, and `SDLC.md` places it before Intake.

This file is the contract for the directory. The workflow that writes a spec is the `om-spec-writing`
and `om-auto-write-spec` skills plus `.ai/skills/om-auto-write-spec/SKILL.md`, which adds the two
sections this repository requires of every spec.

## Where a spec lives

The directory **is** the state. Nothing else in this repository records it.

| Directory                | Status field                    | Meaning                                                        |
| ------------------------ | ------------------------------- | -------------------------------------------------------------- |
| `.ai/specs/`             | `draft`, `ready`, `in-progress` | Being written; merged and waiting for a build; a build is open |
| `.ai/specs/implemented/` | `implemented`                   | Every phase shipped                                            |
| `.ai/specs/archived/`    | `archived`                      | Superseded by a later spec, or abandoned                       |

`assets/` holds the static reproductions a spec is measured against and is not a status directory.

## The metadata table

Directly under the `H1`, before the first section, exactly these four rows in this order:

```markdown
| Field              | Value       |
| ------------------ | ----------- |
| **Status**         | implemented |
| **Issue**          | #167        |
| **Spec PR**        | #162        |
| **Implementation** | #172, #175  |
```

`none` is a valid value for `Issue`, `Spec PR` and `Implementation`, and is written out rather than
left blank so that an empty cell always means somebody forgot. `Implementation` lists the pull
requests in the order they merged.

## Always

- Give a new spec the filename `YYYY-MM-DD-kebab-case-slug.md` and the metadata table above.
- Move a spec between directories with `git mv`, and change `Status` in the same commit. The guard
  fails when the two disagree, which is the point of recording it twice.
- Append the implementation pull request to `Implementation` when a phase merges — every phase, not
  only the last.
- Run `pnpm generate-spec-index` after any of that. The index is generated; the validation gate
  compares it.
- Record what shipped differently from the design as an `## Amendment` section in the spec, with its
  pull request number. A spec that quietly disagrees with the product is worse than no spec.

## Ask First

- Moving a spec to `implemented/` when a phase is unbuilt. Partial delivery keeps `Status:
in-progress` and the built pull requests listed.
- Moving a spec to `archived/` at all. Abandoning a designed decision is a product call, and
  `docs/agents/out-of-scope.md` is where a rejection is recorded so it is not re-litigated.
- Editing the metadata table of a merged spec other than to append an implementation pull request.

## Never

- A spec at `ready` or `in-progress` with no issue. That is precisely how
  `2026-09-08-design-system-plan-reconciliation.md` sat merged and unbuilt for two days with nothing
  to schedule it from, until #201 was filed.
- A spec at `implemented` with an empty `Implementation`. "It shipped" that names nothing that
  shipped it cannot be checked by the next reader, and will not be.
- A hand edit to `README.md` in this directory (`pnpm generate-spec-index` owns it).
- A PNG in this directory. Frames go to `.ai/qa/artifacts_*/` or a scratchpad; `assets/` takes the
  dependency-free `.html` reproductions a spec measured, and nothing else.

## Validation

```bash
pnpm generate-spec-index && git diff --exit-code -- .ai/specs/README.md
pnpm exec vitest run --project=tooling scripts/specs
```

Both are in the gate. The assertions live in `scripts/specs/registry.ts` and are documented there;
`scripts/specs/__tests__/spec-registry.test.ts` is what fails on them.
