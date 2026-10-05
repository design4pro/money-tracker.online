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
| `.ai/specs/archived/`    | `archived`                      | Superseded by a later decision, or abandoned                   |

`assets/` holds the static reproductions a spec is measured against and is not a status directory.
`product-brief.md` is `om-discover`'s product context and is not a spec.

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

A spec written from a plan stage (`afk-plan-to-spec`) carries a fifth row, after those four, naming
the stage and the plan file that holds it: `| **Plan** | 04-S3 (docs/plans/04-budget-and-currencies.md) |`.
Such a spec is `ready` the moment its pull request merges and has no issue yet, because
`afk-to-tickets` files the parent issue when it slices it, so the stage stands in for the `Issue` a
`ready` spec otherwise needs. Older specs have no `Plan` row and need none. Nothing here parses the
row: `pnpm generate-spec-index` reads the fields it knows and ignores the rest, and the Reconciler
finds the stage by the id in the spec's text (`backlog-status.mjs --plan`, ADR 0030).

An **archived** spec carries a `Superseded by` row, last, and only an archived spec may:

```markdown
| **Superseded by** | #382 |
```

It is required exactly when the status is `archived` and refused otherwise, so one value still
decides the shape of the table. The generated index shows `Implementation` for an archived spec
too, in a column beside `Superseded by`, so a spec that shipped phases before it was superseded keeps
its built pull requests listed. The reference can be an issue or a pull request, and more than one,
comma-separated, the way `Implementation` is. A spec that was **abandoned** rather than superseded
says so in the same row, and that is the only value it takes that is not a reference:

```markdown
| **Superseded by** | abandoned |
```

`none` is not that value. It is how every other row spells "empty", so reusing it here would make
forgetting the answer and giving it look the same. `archived` on its own says a design was dropped
and
leaves the reader with the question they came with;
`design4pro/planned.travel#417` is the worked example, where a spec that built nothing recommended
closing its ticket and the ticket was then closed as superseded by another pull request. Without the
row, that chain lives only in a tracker comment. The two repositories run this convention out of the
same file, so the schema is deliberately identical in both.

## Always

- Give a new spec the filename `YYYY-MM-DD-kebab-case-slug.md` and the metadata table above.
- Move a spec between directories with `git mv`, and change `Status` in the same commit. Nothing
  checks that the two agree, so the commit that moves one has to change the other.
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

- A spec at `ready` or `in-progress` with neither an issue nor a `Plan` row. That is precisely how
  `2026-09-08-design-system-plan-reconciliation.md` sat merged and unbuilt for two days with nothing
  to schedule it from, until #201 was filed.
- A spec at `implemented` with an empty `Implementation`. "It shipped" that names nothing that
  shipped it cannot be checked by the next reader, and will not be.
- A spec at `archived` whose `Superseded by` names neither what replaced it nor `abandoned`. A
  dropped design that does not say what happened instead leaves the reader exactly where they
  started.
- A `Superseded by` row on a spec that is not archived. The row is the archived status's, and a
  still-live spec that carries one is saying two things at once.
- A hand edit to `README.md` in this directory (`pnpm generate-spec-index` owns it).
- A PNG in this directory. Frames go to `.ai/qa/artifacts_*/` or a scratchpad; `assets/` takes the
  dependency-free `.html` reproductions a spec measured, and nothing else.

## Validation

```bash
pnpm generate-spec-index && git diff --exit-code -- .ai/specs/README.md
```

The gate checks only that the index is regenerated. The rules above are a convention the author and
the reviewer hold; no test asserts them (ADR 0027).
