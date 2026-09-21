# Code review

How a change to money-tracker.online is reviewed, by a person or by `om-code-review` (the engine
`om-auto-review-pr` runs on every PR). `.ai/review-checklist.md` is the per-PR tick list; this file
is the reasoning behind it and the severity each failure carries. `BACKWARD_COMPATIBILITY.md` lists
the protected surfaces, and `AGENTS.md` the rules every change is written under.

## Priorities, in order

1. **Money and tenancy are correct.** Both fail silently and weeks late. Read `docs/MONEY.md` when
   an amount, a rate, a currency or a date bucket is touched, and `docs/SPEC.md` §5.2 when a query
   is. A reviewer who has not read them cannot approve such a diff.
2. **Contracts hold.** Schema, stored money, queue messages, bindings, public routes, message keys
   (`BACKWARD_COMPATIBILITY.md`). A breaking change without its required path is a blocker.
3. **Security.** Validation is shape, never permission: a well-formed id from a client is not an
   authorised id, and `beforeLoad` is UX, not a data boundary. Secrets never enter a log, a
   screenshot, a test file or a PR body.
4. **The quality bar** of `docs/SPEC.md` §2 and §7, per surface: keyboard, focus, labels, both
   locales, both themes, both viewports, zero console output.

## Repo-specific checks

- **Data access.** Every query goes through the tenant-scoped base repository in
  `src/server/repos`, takes a `TenantScope` as its first parameter, and the tenant predicate cannot
  be removed by a caller. `src/server/catalog` is the single exception, guarded by
  `requirePermission` plus a platform audit-log write.
- **Money.** No float arithmetic on an amount anywhere, including a tooltip or a chart label. The
  scale is `currencies.digits`, never a hard-coded 2. `ref_amount_minor` is written once at the
  booked date's rate and never recomputed. Balances are rebuilt wholesale through the `LEDGER`
  Durable Object, never accumulated or written directly.
- **Server functions.** Input validated with Zod at the boundary and parsed a second time in the
  repository. Named exports only. Anything slow is enqueued on `TASKS`.
- **Queue and Durable Object.** Handlers are idempotent and safe on redelivery; a message shape
  change keeps the old `kind` handled for one release.
- **UI.** React Aria primitives from `components/ui`, which never fetch and never import from
  `server/`. Loading, empty and error states present. A drag surface has a keyboard path; a chart
  has a text table; colour is never the only channel.
- **Localisation.** A new key lands in `en.ts` and `pl.ts` in the same change; counts go through
  the plural machinery; stored rows carry keys, never sentences.
- **Accessibility.** WCAG 2.2 AA is a hard gate and five named AAA criteria are claimed
  (`docs/ACCESSIBILITY.md`). No copy, comment or commit may claim more.
- **Generated files.** `src/routeTree.gen.ts` and `drizzle/` are regenerated, never edited; the two
  drift commands in the validation gate leave no diff.
- **Dependencies.** The set is frozen (`docs/SPEC.md` §3). A new package is a blocker, not a
  judgement call.
- **Tests.** A new repository function has its tenant-isolation case; a money-touching write path
  has its money-invariant case; a behaviour change has a test that fails without it. No added
  suppression, skip or focus; no deleted test file.
- **Clean room.** Nothing is copied from the reference product (`docs/agents/reference.md`): not a
  string, a name, a number or a layout.
- **Numbers.** Every count in the PR body and the review came from a command whose output was read
  (`docs/SPEC.md` §7.7). The same holds for a figure written into a spec, a plan, an ADR or a code
  comment: it is re-derived on the head under review, and a headline total agrees with the table it
  summarises (#170, #191, #222, #250, #252, #253).
- **Governance documents.** `DESIGN.md`, `BACKWARD_COMPATIBILITY.md`, `docs/ACCESSIBILITY.md`,
  `docs/MONEY.md` and `docs/adr/` record decisions a person owns, and the `governance-gate` check
  refuses a PR touching one until a person applies `governance-approved`. Reviewing such a PR means
  reading the decision, not the diff's shape: what changed, what it supersedes, and whether the
  change belongs in that document at all rather than in the code that cites it. An ADR proposed by
  an unattended run arrives as `Status: proposed` and the merge is the acceptance, so the label is
  the point at which somebody accepted it.
- **Documents name what exists.** A spec, ADR, `SDLC.md`, skill or comment that names a file, job,
  test, label, automation or mechanism names one that exists on the branch and does what the text
  says; the reviewer opens each one (#159, #191, #304, #308, #310, #319).

## Severity

| Severity | What lands here                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| blocker  | Any money or tenancy rule above; a missing Zod parse; a client-side-only permission check; a missing tenant-isolation or money-invariant case; a key in one locale only; a hand-edited generated file; a non-additive migration; an added suppression, skip or deleted test; a clean-room violation; a bank connector (ADR 0008); a new dependency; a broken protected surface without its required path |
| major    | An AA accessibility regression; a blanket AAA claim; slow work run inline; a second implementation of an owned concept (SPEC §8); a missing loading, empty or error state; a behaviour change without a failing-first test; a written figure that no command reproduces; a document naming something that does not exist or does not do what it says                                                     |
| minor    | `TODO`, `console.log`, commented-out code, placeholder copy; a scope or naming convention missed; a docblock whose wording has drifted from the code while everything it names still exists and does what it says (a false claim is major)                                                                                                                                                               |
| nit      | Style the linter does not enforce                                                                                                                                                                                                                                                                                                                                                                        |

## Verdict

Any blocker, or any major without a documented waiver on the PR, is **request changes**. Minors
and nits alone are **approve**, listed so the author can pick them up. A review that did not run the
validation gate is not a review.
