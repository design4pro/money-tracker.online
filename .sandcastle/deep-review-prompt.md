# TASK

Deep code-quality audit of branch `{{BRANCH}}`. Judge how the change is _structured_, not
whether it works — the deterministic ladder already proved it works.

Be ambitious. Do not stop at "this could be a bit cleaner". Look for the reframing that
makes whole branches, helpers, modes or layers disappear, and prefer deleting complexity
over rearranging it.

# THIS IS AN ANALYSIS RUN

Do NOT edit any file. Do NOT commit. Your only output is the `<deep-review>` block.

Findings MAY name code outside the issue's Owned paths — describing a better shape for
adjacent code is not an ownership violation, editing it would be. Say plainly when a
finding needs its own ticket rather than a change on this branch.

# CONTEXT

Design language: @.sandcastle/DESIGN_VOCABULARY.md
Project standards: @.sandcastle/CODING_STANDARDS.md
Layering contract: docs/SPEC.md §6. Domain vocabulary: CONTEXT.md.

## Branch diff

!`git diff {{TARGET_BRANCH}}...{{BRANCH}}`

## Commits on this branch

!`git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline`

# AXES

Every finding names one `axis`, the same five the reviewer before you used, so a run's findings can
be read together: `correctness`, `readability`, `architecture`, `security`, `performance`. The
criteria below are structural, so most of what you find is `architecture` or `readability` — say so
explicitly rather than leaving it implied, and if a structural shape is actually hiding a
correctness or security problem, that is the axis to name and it outranks everything else.

# CRITERIA

1. **Code judo.** Is there a reframing that deletes whole categories of complexity rather
   than moving them around? A refactor that relocates complexity without reducing the
   number of concepts a reader must hold is not an improvement. Prefer the version that
   makes the change feel inevitable in hindsight.

2. **File size, as a threshold crossing.** Flag a diff that pushes a file from under 1000
   lines to over it, and ask whether decomposition should have come first. This repo
   already has files well past that line, so only the _crossing_ is the signal, never the
   absolute count. Exempt: `__tests__/`, `src/routeTree.gen.ts`, `drizzle/`,
   `worker-configuration.d.ts`, `src/lib/i18n/messages/**`, and
   `src/server/catalog/data/currencies.ts`.

3. **Spaghetti growth.** Be suspicious of new ad-hoc conditionals, scattered special
   cases and one-off flags inserted into existing flows. A change that adds weird `if`s
   in random places is a design problem, not a stylistic nit — push the logic behind a
   dedicated seam instead of tangling an existing path. "Temporary" branching becomes
   permanent debt.

4. **Canonical layer.** Routes call server functions (`server/fns`); server functions
   call repos (`server/repos`); `server/catalog` is the single stated exception.
   `components/ui` never fetches and never imports `server/`. Flag feature-specific logic
   leaking into shared paths, and bespoke helpers where a canonical utility already
   exists.

5. **Type and boundary cleanliness.** Question unnecessary optionality, `any`, `unknown`,
   cast-heavy code, and silent fallbacks that paper over an unclear invariant. Prefer an
   explicit typed model over a loosely-shaped ad-hoc object. A new prop or param that is
   always supplied should not be optional.

6. **Thin abstractions.** Apply the deletion test to every new wrapper, helper or layer:
   would deleting it concentrate complexity, or just move it? Identity wrappers and
   pass-through helpers add indirection without buying clarity.

7. **Seams and tests.** Are the new tests at a seam that survives a refactor, or coupled
   to the implementation? Would ONE test boundary replace several small ones? Did this
   change make the feedback loop cheaper or more expensive to run? A pure function
   extracted only for testability, while the real bugs live in how it is called, has
   bought nothing.

Also apply the smell baseline in CODING_STANDARDS.md — but as it says, those are labelled
judgement calls, not violations.

# WHAT NOT TO DO

- Do not flood the output with nits when a structural issue is present. A small number of
  high-conviction findings beats a long list of cosmetic notes.
- Do not report anything `pnpm lint` or `pnpm typecheck` already enforces.
- Do not restate the diff. A finding names a problem and a remedy.
- Do not raise a finding you cannot tie to a specific file.

# OUTPUT

Order findings by severity, structural regressions first, legibility last. At most 6.

`blocker` — a structural regression, or a visible code-judo move that was missed.
`strong` — real design debt worth its own ticket.
`minor` — worth saying once, not worth blocking on.

Emit exactly one block, valid JSON, double quotes, no trailing commas:

<deep-review>
{"verdict": "concerns", "findings": [{"severity": "blocker", "axis": "architecture", "title": "<imperative, searchable>", "summary": "<the problem, one or two sentences>", "files": ["src/..."], "remedy": "<the specific restructuring>"}]}
</deep-review>

`axis` is one of the five above. `verdict` is `"clean"` when there are no findings at all (`findings` then `[]`), otherwise
`"concerns"`. This gate is advisory: it never blocks the merge.
