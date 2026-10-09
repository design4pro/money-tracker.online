# Software delivery process

## Purpose

This file documents how work flows from ticket to merged PR in this repository. The agent skills configured in `.ai/agentic.config.json` enforce the process; humans read it here. Issues and PRs live in GitHub, with every tracker operation the skills run defined in `.ai/trackers/github.md` (edit that file to extend or override tracker behavior).

Everything above the `BEGIN per-repo` marker near the end of this file is written to be shareable with the sibling repositories that run this pipeline; `## This repository`, below that marker, is the section that is specific to this repository. Nothing checks either half against a sibling: ADR 0027 (decision 6 and Consequences) deleted the text-parity test, so the halves may drift, and review is what catches it. So this document never names the base branch, the merge mechanics, or the automations by hand: **the base branch is `.ai/agentic.config.json` → `baseBranch`, and it is named once, in `## This repository`.** Everything below that says "the base branch" means that value.

Work enters through two paths: a free-form task brief handed to an agent, or a filed ticket. Both converge on the same review loop, the same validation gate, and the same merge rules.

Before intake, the work is shaped: `om-discover` establishes the product context every later decision reads (`.ai/specs/product-brief.md` — who the users are, what hurts, what the product is not, which rules and decisions bind the work), `om-brainstorm` turns a single idea or question into a routing decision and a brief, and the spec skills (`om-spec-writing`, `om-auto-write-spec`) turn a feature into a design document before anything is built. Those steps feed the table below; they are not the ticket flow itself, and the Definition of Ready is the contract between them and Intake.

## Roles

- **Author** — the human or agent who writes the change. Owns the ticket from claim to a merge-ready PR.
- **Reviewer** — reads the diff and approves or requests changes. May be a human or the `om-auto-review-pr` skill; the `om-code-review` checklist applies either way. The reviewer is also the second person a `risk-high` change needs and signs off the spec when a feature requires one; a team that names a tech lead or an architect puts them here.
- **Designer** — owns the flow and its states before the code exists, and the design contract the UI review reads back. May be a human, `om-ux-shape` for the shaping, `om-ux-review-pr` for the pass over a PR's screens.
- **QA reviewer** — exercises user-facing changes before they merge, with `om-prepare-test-env` to boot the app once and `om-auto-qa-pr` to walk it in a real browser. Manual means a person judges the result and can grant `qa-approved`; it does not mean the work is unassisted. Unattended, a specialist panel is the QA reviewer (ADR 0031). Always referenced by role, never by name or handle: assignments change.
- **Product owner** — owns the why and the value: the product brief, the scope split (now, later, not doing), the success criteria, and the ticket-level tier of the Definition of Ready. Confirms the brief before it is written and the backlog tree before it is filed; owns every product decision in the brief that names no other owner. Referenced by role, never by name. <!-- discovery -->
- **Maintainer** — owns branch protection, the label taxonomy, the config, this document, and the installed skills with their repo-local overrides under `.ai/skills/`; arbitrates when gates conflict. Acts as the release manager unless the team names one.

## Ticket lifecycle

| Stage                   | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Driven by                                                                                             | Done when                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Discovery               | The product context is established before any idea is weighed — problem and who has it, stakeholders, rules, flows, success criteria, scope — from material that exists, with every claim tagged by its evidence and every decision owned by a person. Then an idea, question, or itch is talked through: the problem is questioned, alternatives (including building nothing) are weighed, and the conversation ends in a routing decision.                                                                                                         | `om-discover` (product level) and `om-brainstorm` (one idea), or a human                              | A product brief, or a routed conversation with a brief when the work continues                        |
| Intake                  | A ticket or task brief is filed in GitHub and meets the Definition of Ready below. `om-prepare-issue` files it with SDLC labels and the ready sections; `om-auto-manage-issues` grooms what is already filed and reports what it still lacks. Agents file tickets too: `afk-to-tickets` slices a merged spec into tracer-bullet tickets, and `afk-architecture-review` files deepening candidates.                                                                                                                                                   | Anyone, `om-prepare-issue`, `om-auto-manage-issues`, `afk-to-tickets`, `afk-architecture-review`      | Ticket exists and is ready, or its gaps are named on the ticket                                       |
| Triage                  | Confirm the issue is real, still unfixed on the base branch, and not already claimed or covered by an open PR. Then write an Agent Brief, or put a `blocked` hold on it naming what a person must do (see Readiness below). Read-only on code; stops the chain cleanly when there is nothing to do.                                                                                                                                                                                                                                                  | `afk-triage`, `om-verify-in-repo`, or a human                                                         | An Agent Brief posted or a hold set, or stopped as no-action                                          |
| Claim                   | The author claims the ticket so concurrent agents back off. See the claim protocol below.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `om-fix` / `om-auto-create-pr`, or a human                                                            | Claim visible on the ticket                                                                           |
| Design                  | For a user-facing change, the flow and its states are settled before the code exists: what the screen does when empty, loading, in error, and without permission, and what the change deliberately does not do. A ticket that touches no UI skips this stage.                                                                                                                                                                                                                                                                                        | `om-ux-shape`, or a human designer                                                                    | The flow and its states are decided, or the ticket is not user-facing                                 |
| Implement               | Locate the minimal change surface (`om-root-cause`, read-only), then implement the change with regression tests and run the validation gate. Task briefs without a ticket go through `om-auto-create-pr`, which plans, implements phase by phase in an isolated worktree, and runs the same gate.                                                                                                                                                                                                                                                    | `om-root-cause` + `om-fix`, `om-auto-create-pr`, or a human author                                    | Change complete, validation gate green                                                                |
| PR                      | Commit, push, and open a PR against the base branch with normalized labels. On a hand-worked branch, `om-check-and-commit` runs the gate, fixes obvious drift, and pushes when green.                                                                                                                                                                                                                                                                                                                                                                | `om-open-pr`, `om-auto-create-pr`, or `om-check-and-commit`                                           | Open, labeled PR                                                                                      |
| Review loop             | The reviewer reads the diff against the `om-code-review` checklist and approves or requests changes. Requested changes are addressed (`om-auto-continue-pr` resumes agent PRs from the tracking plan, and adopts a PR that has none by reconstructing the plan from the PR's own context) and the PR is re-reviewed until approved. A user-facing change also gets a design pass: `om-ux-review-pr` walks the changed screens and reports findings ranked by user impact. That pass is advisory — it informs the review, it does not hold the merge. | `om-auto-review-pr` (single PR), `om-review-prs` (sweep), `om-ux-review-pr` (design pass), or a human | Approving review submitted                                                                            |
| QA                      | A PR carrying `needs-qa` waits for QA. The reviewer boots the app once with `om-prepare-test-env`, walks the change in a real browser with `om-auto-qa-pr` — which attaches screenshots and a pass/fail report and touches no labels by default — and records the outcome. A flow worth keeping becomes `om-integration-tests` coverage. See the QA gate below.                                                                                                                                                                                      | QA reviewer, with `om-prepare-test-env`, `om-auto-qa-pr`, `om-integration-tests`                      | `qa-approved` applied by a QA reviewer or the permitted self-QA exception; `qa-failed` routes it back |
| Merge                   | `om-merge-buddy` reports, read-only, which PRs can merge now and which are close but blocked. `om-approve-merge-pr` re-checks every gate, approves, and merges by whatever mechanism `## This repository` names.                                                                                                                                                                                                                                                                                                                                     | `om-merge-buddy` + `om-approve-merge-pr`, or a human                                                  | PR merged into the base branch                                                                        |
| Post-merge housekeeping | Close issues the merged PR fixes; comment on issues whose PRs were closed without merging; turn leftover asks or review comments into tracked follow-up issues.                                                                                                                                                                                                                                                                                                                                                                                      | `om-close-fixed-issues`, `om-followup-issue-from-pr`                                                  | Tracker reconciled, follow-ups filed                                                                  |

## Definition of Ready

A ticket is ready for implementation when the answers below are on the ticket or in a spec it links. They come in two tiers, because a spec can supply the second but never the first.

**Ticket-level — a human supplies these, or the readiness verifier resolves them (below):**

- the problem or need, and who has it (a user or a role);
- the expected outcome, and how it will be checked;
- what is out of scope;
- open questions, each marked blocking or non-blocking — no blocking question left unanswered;
- any autonomous assumption confirmed by a human (the resolved-assumptions comment on a spec PR).

**Spec-level — a covering spec supplies these, and `om-auto-write-spec` writes them when they are missing:**

- acceptance criteria;
- business rules;
- the happy path and the main unhappy paths;
- impact on data and permissions;
- dependencies;
- a link to the prototype or mockups when the change is user-facing.

For a bug, ready means reproducible: `om-verify-in-repo` is that gate, and the list above applies only to its ticket-level items. Enforcement: `om-prepare-issue` files tickets with these sections; `om-auto-manage-issues` records `READY_STATUS` per issue and posts a not-ready comment naming what is missing; `om-auto-fix-issue`'s feature route stops on a ticket that fails the ticket-level tier instead of speccing around the gap, the way `om-verify-in-repo` stops on a bug that is not real. Spec-level gaps are not a stop — the spec is authored. A maintainer may waive an item by saying so on the ticket. Before either skill stops on a missing ticket-level item, the `readiness-verifier` sub-agent (`.claude/agents/readiness-verifier.md`) reads the ticket, its thread and the repository, and resolves each item from evidence or with a documented assumption; when it resolves them all, its table goes on the ticket as a `readiness verified` comment and the ticket is ready, and a maintainer revokes that with a `veto` reply. It never decides `risk-high` or `security` work, a blocking question nobody answered, a product choice the repository has not made, or a problem statement it would have to invent; a decision among those goes to the specialist sub-agent of § Delegated decisions in the same run, and only what nobody but the reporter knows waits for a human.

**The Definition of Ready is the gate an unattended pipeline is built on.** `READY_STATUS` is the one machine-readable verdict that says a ticket can be worked without asking a person a question, so every automatic hand-off from grooming to triage reads it and nothing downstream re-derives it. A ticket that is not ready is commented on and left alone; it is never handed to an implementing agent on the theory that the agent will work the gap out.

## Product decisions as a protected contract

When `om-discover` has written `.ai/specs/product-brief.md`, its **Non-goals**, **Business rules**, and **Decisions** tables are protected the way `BACKWARD_COMPATIBILITY.md` protects contract surfaces. Each entry carries a stable id (`N01`, `R03`, `D07`), an owner, a status (`active` or `superseded`), a review-by date, and a required path for changing it. The rules:

- A PR that builds something a non-goal excludes, or contradicts a business rule or a decision, without a superseding entry in the same PR is a **blocker** in review, quoting the entry and its id. The way out is never "delete the code": it is "change the decision explicitly" — a superseding row approved by the entry's owner, with the maintainer arbitrating a dispute, as in Roles.
- The decisions in play are surfaced where people work, not remembered: `om-auto-manage-issues` lists them in its implementation-notes comment, `om-spec-writing` carries a _Decisions in play_ section, and every PR body carries _Decisions touched_. A newcomer or a new agent reads them at the issue, the spec, or the PR, not in a chat history.
- An autonomous assumption a human confirmed on a spec PR (the resolved-assumptions comment) is recorded as a decision on the next `om-discover --refresh`, with the confirmer as owner, so the reason a thing is the way it is survives the people who decided it.
- Decisions age: an entry past its review-by date is flagged in review as due for a look, not enforced blindly. Which entries block more than they protect is a retro question.

## Scoping rule (SLC)

Every spec, ticket and agent-sized issue is scoped **Simple, Lovable, Complete** (Jason Cohen, "Your customers hate MVPs. Make a SLC instead"), not as a minimum viable product:

- **Simple**: the narrowest scope that does one job. Split anything that does not fit one ticket, or one fresh agent context.
- **Lovable**: no rough edge is left "for later" inside that scope. Error states, empty states, docs and tests ship with the change.
- **Complete**: the slice is useful and verifiable on its own. A change that only works once a later ticket lands is a layer, not a slice: merge it into the slice it serves.

A request that fails the rule is re-scoped (a spec, or tickets), not implemented partially. `afk-triage` and `afk-to-tickets` both gate on this rule: a ticket too large for one fresh agent context never gets an Agent Brief as it stands. The skill splits it, on a product owner specialist's verdict (§ Delegated decisions), into a first slice it briefs and follow-up issues it files.

## Label state machine

Pipeline labels are mutually exclusive: a PR carries at most one, and it names where the PR sits in the flow.

- A ready, non-draft PR carries `review`.
- The reviewer moves it: request changes → `changes-requested`; after fixes it returns to `review`; approval → `merge-queue`.
- `merge-queue` is routing, not proof of QA: a `needs-qa` PR legitimately sits there until QA signs off. The label is this state machine's and is not GitHub's merge queue: a PR carrying it is waiting for the merge step `## This repository` describes, and only that step puts it in whatever queue GitHub runs.
- Only a QA reviewer sets the `qa` pipeline label. They move a queued `needs-qa` PR from `merge-queue` to `qa` while testing, then back to `merge-queue` with `qa-approved` on pass, or to `qa-failed` on failure. Automated skills request QA with `needs-qa`; they never set `qa`.
- `blocked` and `do-not-merge` stop the flow wherever it is. A skill may set `blocked` on an issue with a 🤖 comment naming what a person must do. `do-not-merge` and `do-not-close` are a person's to clear. A `blocked` an agent set can also be lifted by `afk-unblock` on an independent specialist's verdict (§ Readiness, ADR 0030); one a person set, or took over by commenting after it, stays. `set_pipeline_label` never removes `blocked`, so a PR a review skill blocked stays blocked until a person clears it; that is deliberate.

| Group    | Labels                                                                                     | Exclusivity                   | Meaning                            |
| -------- | ------------------------------------------------------------------------------------------ | ----------------------------- | ---------------------------------- |
| Pipeline | `review`, `changes-requested`, `qa`, `qa-failed`, `merge-queue`, `blocked`, `do-not-merge` | one at a time                 | Workflow state                     |
| Category | `bug`, `feature`, `refactor`, `security`, `dependencies`, `documentation`                  | additive                      | Kind of change                     |
| Meta     | `needs-qa`, `skip-qa`, `qa-approved`, `qa-self-verified`, `in-progress`, `ci-monitoring`   | additive                      | Process signals                    |
| Priority | `priority-low`, `priority-medium`, `priority-high`, `priority-extreme`                     | one at a time; unset = medium | Urgency of the work                |
| Risk     | `risk-low`, `risk-medium`, `risk-high`                                                     | one at a time; unset = medium | Blast radius of the change         |
| Outside  | `do-not-close`                                                                             | additive                      | A human hold no skill may override |

An issue carries the category, priority and risk groups and the holds, and nothing else: no label says an issue is ready or starts a run (§ Readiness). `do-not-close` is the one label outside the Open Mercato taxonomy, and no other is created. Every group is also `labels.*` in `.ai/agentic.config.json`, and that file is what the skills read — a label this document names and the config does not is a label no skill will apply.

Priority is how urgent the work is; risk is how dangerous the change is to ship. A one-line fix for an outage can be `priority-extreme` and `risk-low`; a large auth refactor that can wait can be `priority-low` and `risk-high`. A PR inherits both from its source issue unless the scope clearly changed. When an automated skill adds or changes a pipeline or meta label, it leaves a short comment explaining why.

When no priority label is set, infer one:

- `priority-extreme` — production outage, data loss, or an active security incident.
- `priority-high` — security hardening or a release-blocking regression.
- `priority-medium` — ordinary bug fixes and net-new features (also the default reading of unset).
- `priority-low` — cosmetic, docs-only, dependency bumps, follow-up cleanup.

When no risk label is set, infer one:

- `risk-high` — auth, sessions, data scoping, money, schema migrations, shared contract surfaces, or broad cross-cutting edits. `## This repository` names the surfaces that are `risk-high` here.
- `risk-medium` — an ordinary single-area change that ships with tests (also the default reading of unset).
- `risk-low` — docs-only, test-only, typo, or isolated cosmetic changes.

When signals conflict, pick the higher label and say why in the label comment. A `risk-high` PR is not merely advised to get more scrutiny; it carries the evidence below, and it sends the issue past a security and tenancy specialist (§ Delegated decisions) before any unattended implementing skill may take it:

| Area behind `risk-high`     | What the PR must carry                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Auth, sessions, permissions | an integration test for the denied path and the wrong-scope read                                                                    |
| Data scoping                | an isolation test proving one scope cannot read another                                                                             |
| Money                       | tests for the failure, retry, and idempotency paths                                                                                 |
| Schema migrations           | a migration test up and down, and a rollback plan in the PR body                                                                    |
| Shared contract surfaces    | the consuming side exercised, per `BACKWARD_COMPATIBILITY.md`                                                                       |
| Any `risk-high`             | `needs-qa` when user-facing; no self-QA; `om-code-review` blocks without the evidence above unless a maintainer waives it on the PR |

## Readiness

No label says an issue is ready, and no label starts a run. The taxonomy above is the whole vocabulary; readiness is computed.

An issue is **ready** when all of these hold: it is open; a maintainer opened it (the `authors` gate of the issue automations) and it was not filed from production error data (a `sentry-issue` marker); its body or a maintainer's comment carries an `## Agent Brief`; it has a category, a priority and a risk label; every issue under its `Blocked by` is closed; no PR addresses it, open or merged and not yet closed (`develop` is not the default branch, so a merge does not close the issue by itself; an issue a person deliberately reopens after its PR merged stays out of `--next` until that PR ages out of the 30 most recent merged ones, or a person starts the run from the cockpit); no 🤖 not-ready or `STOP:` comment waits for an answer; and it carries none of `blocked`, `do-not-merge`, `do-not-close` or `in-progress`. A later trusted `🤖 RESOLVED:` comment (what `afk-unblock` posts) answers a not-ready or `STOP:` comment, as a human reply does. A comment that says `HUMAN-ONLY:` names what only a person can do, and no run is started on that issue. `.ai/scripts/backlog-status.mjs` is the one implementation of that rule. It prints the report a person reads, with `--next` it picks the issue the next `implement-ticket` run takes: highest priority first, then oldest, and nothing while three PRs are **waiting for a person**, and with `--plan` it lists everything the Reconciler may start right now (§ The Reconciler, ADR 0030). A PR waits for a person when it is open, by a maintainer, not the `develop` -> `main` promotion (base `main`), and it is `blocked`, `do-not-merge`, or `changes-requested` with no update for 24 hours (an autopilot that stopped at `changes-requested` is parked on a decision no run is making): those are the PRs only a person can move. A PR the pipeline merges by itself (`review`, a fresh `changes-requested`, `merge-queue`, a plain draft) is not inventory, so it does not hold back the next implementation. Trusted authors are the `authors` gates of the issue automations plus the retired `design4pro-agent`, every issue of which came out of an agent run (ADR 0027, amendment of 2026-10-01).

- **How an issue gets there.** Opening it starts grooming and triage in one run: `om-auto-manage-issues` adds the SDLC labels, the Definition of Ready check and implementation notes, then `afk-triage` writes the Agent Brief, or puts a `blocked` hold on it with a comment that starts `🤖 HUMAN-ONLY:` and names the one thing a person must do. One run, two steps, so the two never race on the same labels. `afk-to-tickets` files tickets whose body is their brief; `afk-plan-to-spec` writes the spec for a stage of `docs/plans/` that nothing covers yet, which `afk-to-tickets` then slices.
- **How it leaves a hold.** A hold an agent set that does not say `HUMAN-ONLY:` is offered to `afk-unblock`, which asks a specialist (§ Delegated decisions): on a verdict it removes `blocked` and posts `🤖 RESOLVED:`, otherwise it posts `🤖 HUMAN-ONLY:` and leaves the hold. A hold a person set, or a person commented on last, and a `HUMAN-ONLY:` one stay until a person removes `blocked`; that event grooms and triages the issue again.
- **Limits on skills:** an implementing run takes `risk-high` or `security` work only on a security and tenancy specialist's approving verdict, recorded with its conditions as acceptance criteria, and it re-derives the risk from the area the brief touches rather than trusting the label. Skills never close an issue and never remove a hold a person set or took over; they lift only what an agent set, and only on a specialist's verdict or a checked fact.
- **Human override:** a person starts any workflow on any issue from the cockpit at any time.

## The QA gate

The one hard rule of this process: **a PR carrying `needs-qa` must not merge until it also carries `qa-approved`, even when every other check is green.** `om-merge-buddy` classifies such a PR as blocked; `om-approve-merge-pr` refuses to merge it.

- Apply `needs-qa` to UI changes, new features, and other user-facing behavior that needs manual exercise. Which paths make a PR `needs-qa` here is in `## This repository`.
- For a UI change, QA covers more than "it works": the state matrix (default, empty, loading, error, no-permission, long content, narrow viewport) is part of the pass/fail, and so is conformance to the design contract in `.uxproof/` when the repository has one. A missing state fails QA. `om-ux-review-pr` remains the advisory design review; its objective checks are the ones QA runs.
- `skip-qa` is the explicit opt-out for docs-only, dependency-only, CI-only, test-only, and similarly low-risk non-user-facing changes. Never combine it with `needs-qa`.
- `qa-failed`, `do-not-merge`, and `blocked` are hard blocks regardless of every other signal. An active `qa` pipeline label means a tester is on the PR right now — never merge under an active tester.
- The gate is satisfied when a QA reviewer tests the PR and applies `qa-approved`.
- **Unattended sign-off**: the unattended run is the QA reviewer for every PR, `risk-high` and `security` included (owner decision 2026-10-06, ADR 0031). `om-auto-qa-pr --self-qa-signoff` attaches the evidence, a panel of specialist sub-agents judges it (`.ai/skills/afk-decide/SKILL.md`; the security and tenancy reviewer sits on it for a `risk-high` or `security` PR), and on every member's approving verdict the run applies `qa-approved` + `qa-self-verified`; the self-QA exception below is for a person signing off, not for this panel. A rejection goes to `om-auto-fix-pr` and QA again, at most three rounds; then the PR is `blocked` for a person (`.ai/skills/om-pr-autopilot/SKILL.md`).
- **Self-QA exception**: when no QA reviewer has capacity in time, any engineer may sign off instead, on a `risk-low` or `risk-medium` PR only — but only by (1) checking the PR out and running it locally, (2) exercising the affected flow, and (3) attaching evidence to the PR that names the scenario exercised, the environment, the test data, the observed result, and the negative cases tried. Then apply both `qa-approved` (so the merge skills treat QA as done) and `qa-self-verified` (so the exception is auditable). No evidence, no `qa-approved`.
- **No self-QA by a person on `risk-high`.** A PR labeled `risk-high`, or one whose diff touches auth, sessions, data scoping, money, schema migrations, or shared contracts (the `risk-high` inference above), needs a QA reviewer, or a maintainer's explicit exception stated on the PR, when a person signs off. The unattended panel above signs it off too, with the security and tenancy reviewer on it (ADR 0031).

## The claim protocol

Before mutating an issue or PR, an agent claims it with all three signals: it assigns itself, adds the `in-progress` label, and posts a claim comment saying what it is doing. Any agent that finds an existing claim backs off instead of colliding. A PR carrying `in-progress` is also skipped by the merge tooling.

`in-progress` means **actively working**. Once an agent's work is finished and fully reported — labels applied, review submitted, comments posted — it swaps `in-progress` for `ci-monitoring` if it still intends to report the CI outcome. `ci-monitoring` is **not** a claim and blocks nobody: it says only that the CI-result follow-up comment is still owed, so another agent or a human may act on the PR freely. That distinction matters because CI runs long: an agent that reported its work and then died while watching a run leaves an honest, self-describing state instead of a lock nobody holds. The label comes off when the follow-up lands, or when the agent gives up waiting at `ci.maxWaitMinutes` and says so.

The claim is released when the work finishes — on success and on failure alike. A stale `in-progress` with no recent activity may be cleared by the maintainer.

### Reporting is decoupled from CI

Agents apply labels, submit reviews, and post comments **as soon as their work is done**, without waiting for CI to go green. A review submitted while checks are still running says so in its body: the required checks and the QA rule hold the actual merge, and the approval covers the code, not a green run. The CI outcome arrives afterwards as a follow-up comment, which also corrects the pipeline label if the result changes the verdict.

The wait for that outcome is bounded by `ci.maxWaitMinutes` (default 40). When it expires with checks still running, the agent stops waiting, runs the local validation gate as its own evidence, posts that together with the still-pending check names and an explicit statement that no further follow-up is coming, drops `ci-monitoring`, and finishes.

A red signal does not short-circuit the review either. A failing required check or a conflicted head is collected as a **blocker finding** and reported together with the full code review, never instead of it: one review cycle gives the author the failing check, the conflict, and every code finding at once, rather than the cheapest red flag first and another cycle to discover the rest. Such a verdict is still `changes-requested` — completeness changed, the gate did not.

None of this touches the merge rules. Reporting early is safe; merging early is not — required checks still gate every merge, and the merge tooling refuses until they are genuinely green.

## The automation contract

The `om-auto-*` skills run this process unattended and are chainable: each accepts the artifact the previous one produced (an issue id, a spec path, or a PR number from the `PR: #<number> (link: <url>)` reference line every PR-producing skill emits), and each detects work already started — an open PR referencing the issue or plan — and continues on it rather than opening a duplicate. A completed autonomous run leaves a **ready** (non-draft), fully labeled PR — one pipeline label, category, QA meta, one priority, one risk — with a run-summary comment and, for user-facing changes, screenshots from the working app attached as PR evidence. Draft PRs are reserved for explicitly incomplete states: spec-only design PRs, interrupted hand-offs, or autonomous defaults flagged for human confirmation. Automation applies `qa-approved` only through the unattended sign-off in the QA gate, `risk-high` included (ADR 0031).

Two properties bound the whole unattended loop, and both are worth stating plainly because they are what make it safe to leave running:

- **Merge policy is repository-specific.** The pipeline's output is a reviewed PR; `## This repository` states who merges a reviewed PR and how.
- **The cap is on inventory, not on rate.** `--next` and `--plan` start no implementation while three PRs wait for a person (`blocked`, `do-not-merge`, or `changes-requested` with no update for 24 hours; QA and risk labels are the agents', ADR 0031), so a burst of intake cannot outrun the review only a person can give. Raising throughput means reviewing those PRs, not tuning the schedule.

## Unattended decisions

The `afk-*` skills (`.ai/skills/`) run with no human to ask. Where a person would be consulted, the skill picks the most reversible reasonable option and records it as a row in a **Resolved assumptions** table (`# | Question | Applied default | Why`) in the brief, spec or PR body it writes. Humans review those rows at the PR, and overturning one is an ordinary review finding. Domain terms and decisions follow `afk-domain-modeling`: `CONTEXT.md` is updated in the same change, and ADRs are written only when a decision is hard to reverse, surprising, and a real trade-off.

### Delegated decisions

A choice between options is not a reason to stop or to hand an issue to a person. An unattended skill that would present options, a "Decision for the implementer", a "human's call" or a `blocked` hold hands the question to an **independent specialist sub-agent** instead (product owner, software architect, security and tenancy, accessibility and UX, manual tester, test engineer, or configuration guardian), applies the verdict, records it as a Resolved assumptions row, and continues the work in the same run. The protocol, the verdict format and the short list of cases that still need a person are in `.ai/skills/afk-decide/SKILL.md`. A skill that stops on a question this protocol could settle is a defect to fix in the skill.

A state an unattended pipeline can enter needs an exit that does not require a human to type something. When a state's only on-by-default exit is a person noticing it, work accumulates there silently: name the exit when the state is introduced, or do not introduce the state.

## Validation gate

Every PR passes the full validation gate before review sign-off. **The command list lives in exactly one place: `.ai/agentic.config.json` → `validation.commands`, in order.** This section deliberately does not repeat it, and neither should `AGENTS.md`, `CONTRIBUTING.md`, a skill, or a workflow file — a gate written down twice is a gate that disagrees with itself, and the copy an agent happens to read is the one that wins.

Any non-zero exit fails the gate and blocks the PR. The implementing skills run the configured gate before opening a PR, and `om-check-and-commit` runs it before pushing a hand-worked branch. Changing the gate means editing that one key; anything that needs the list at runtime reads it from there.

## Repo automations

The cezar cockpit runs this process unattended: an automation watches GitHub for one event, and launches one workflow from `.ai/cezar/workflows/` when a record matches its filters. The automations this repository runs are tabulated in `## This repository`; the definitions are committed, and the cockpit's copy under `.ai/cezar/` is runtime state that is rebuilt from them.

These operating rules were learned the hard way and apply to every repository running the cockpit:

- **`maxRecords` is an evaluation budget, not a launch cap.** A poll turns each record into observations — one per opened event, one per reconstructed label event — sorts them oldest-first and evaluates only the first `maxRecords`. A triage run applies four labels within seconds and the decisive one lands last, so a small budget evaluates the noise and never reaches the label that matters: the trigger reads as dead. Keep the schema default of 25. Cost is bounded by the WIP limit and the per-skill caps, never by starving this budget.
- **A repo-local skill is not invocable by name.** The cockpit injects a step's skill body as the agent's system prompt, but materializes only a _team_ skill into `.claude/skills/`. An agent that sees an `afk-*` name and calls the `Skill` tool gets `Unknown skill` and must recover on its own. So write an `afk-*` skill that never asks to be invoked, and point cross-references at `.ai/skills/<name>/SKILL.md` rather than naming a skill as something to load.
- **A cause is not established until an experiment reproduces it.** State a mechanism as a hypothesis until a controlled run reproduces it, and cite that run.
- **A substring match and a success banner are not evidence; read the field the system writes.** Searching a run's NDJSON for a token matches the _content_ of events — including files the agent read while it worked — not the system's own telemetry. The authoritative reading is each event's `type`. The shell form of the same error: capture an exit status before anything else runs, and when a search matches, confirm which field matched before concluding anything from it.
- **Never file an issue carrying the label that triggers its own automation.** The opened event and the label event are two records in one batch, and the receipt that prevents a relaunch keys on the automation plus the event rather than on the issue, so two concurrent runs start on one ticket.
- **Pausing an automation and enabling it again silently drops everything that arrived in between.** `enable` sets `baselineAt` to now and moves the cursor with it, and every candidate at or below the baseline is discarded. That is deliberate on a first enable — a backlog is never launched — and a trap for an operator who paused to investigate. To act on an item already pending, use `cez automation check <id> --execute`, which launches it without touching the baseline.
- **An automation resolves its workflow from the working tree, so switching branches disables every automation.** A branch that does not carry `.ai/cezar/workflows/` empties the directory, and the next poll logs `unknown workflow`. Switching back does not undo it: failures back off `60 s × 2^(failures-1)` capped at six hours. Treat any branch switch in the main checkout as pausing every automation, and read the log after one.
- **A failed launch still consumes the event: the receipt is reserved before the run starts and never released.** An event that failed for a transient reason is suppressed permanently — every later poll reports `duplicate`. Recovery is manual: delete the matching lines from `.ai/cezar/automation-receipts.ndjson`, which is runtime state, and re-check.
- **Read an automation's next poll time from its state file; never compute it.** Any operation that rewrites the working tree must run between polls. The authoritative value is `nextCheckAt` for that automation in `.ai/cezar/automation-state.json`. Read it, and abort when the margin is thin instead of trusting arithmetic over the system's recorded state.

**Bootstrap** on a running cockpit:

1. `cez automation create --file <definition>` for each definition. They are created paused.
2. `cez automation check <id>` for polls, or `cez automation run <id>` for schedules.
3. `cez automation enable <id>`.
4. After editing a definition, run `cez automation update <id> --file ...`.

The labels in `.ai/agentic.config.json` must exist first (`gh label create <label>`). To stop it all, `cez automation pause <id>`, or start the cockpit with `CEZ_AUTOMATIONS=0`.

## Amending this process

This document and `.ai/agentic.config.json` describe the same process: change them together, and re-run the `om-setup-agent-pipeline` skill when the toolchain or label taxonomy changes. Per-skill deviations — extra review rules, a different PR body template, an added gate step — belong in a repo-local skill of the same name at `.ai/skills/<skill-name>/SKILL.md`, which takes precedence over the installed skill (and can `@`-import or reference it to extend rather than replace it); local rules win, but a repo-local skill cannot grant what the installed skill's safety rules forbid.

Three amendment rules are specific to this document's shape:

- **A change above the `BEGIN per-repo` marker is a change to every repository that carries this text.** Make it in all of them, or make it in `## This repository` instead. No test compares the halves any more (ADR 0027), so a sibling that was not updated drifts until a reviewer notices. The marker is the boundary — never a section count, which goes stale the first time a section is added, and was wrong here for as long as it was written down. Name the marker in prose the way this bullet does, without its comment syntax: a second literal copy of it above the real one is a false cut point, and truncating there silently drops every line between the two.
- **A section above the marker may not point at a repo-relative path that is missing from any repository that carries it.** A bare path reads as "here", so a reader who follows it in a sibling finds nothing — that is how the intake-bridge spec, which exists in only one of these repositories, came to be cited as though it were local in every one of them. Name the repository that holds it, or move the sentence into `## This repository`. This binds a path a reader is sent to follow, not one named as an output the process writes or as a place that must _not_ repeat something.
- **This file deliberately diverges from the `om-setup-agent-pipeline` SDLC template** by naming the base branch, the merge mechanics, the QA routing and the automations once, in `## This repository`, instead of rendering them throughout. Re-running that skill must not push those values back into the sections above the marker.

<!-- BEGIN per-repo -->

## This repository

- **The base branch is `develop`.** Eligible PRs enter `develop`'s **merge
  queue** (ADR 0020), which runs the suite on the commit it builds and merges it minutes later. A
  merge into `develop` does not close an issue natively, so the merger then runs
  `om-close-fixed-issues` — once the merge has landed, not while the PR is still queued — and it
  honours the PR's `Closes #n`. The `develop` → `main` promotion is a separate PR, merged directly
  with **a merge commit** and no queue (ADR 0003).
- **Who starts a run.** No label does (ADR 0029). An issue a maintainer opens is groomed and
  triaged on the event (`issue-groom`: `om-auto-manage-issues`, then `afk-triage`); a ready issue
  is implemented by the two-hour schedule, which asks `backlog-status.mjs --next` for it, or by the
  Reconciler (§ The Reconciler); a PR is driven by its own automations. A person can start any
  workflow from the cockpit. The pipeline
  runs from a filed issue to a merged PR with nobody in it, and `implement-ticket` ends by running
  `om-pr-autopilot --allow-merge`, which merges the PR into `develop`; QA is signed off by the
  run on a specialist panel's verdict, and a `risk-high` or `security` PR merges on the security
  and tenancy reviewer's verdict on its diff (ADR 0031). Beyond events and schedules, the Reconciler sweeps the backlog: it triages, one at
  a time, an issue opened before an Agent Brief existed.
- **Risk here.** `risk-high` means anything touching auth, tenant scoping, money, the ledger,
  billing, a migration, a protected decision document or a merge-policy surface. The label is
  triage information for the reviewer, not a gate. `docs/MONEY.md` is not background reading: representation, rounding and
  currency have rules a plausible-looking change breaks silently, so read it before touching any
  amount and prefer the helpers in `src/lib/money/`.
- **QA routing.** A PR that reaches `src/routes/**`, `src/components/**`, `src/styles/**` or
  `src/lib/i18n/messages/*` carries `needs-qa`; docs, CI, tests, `scripts/**`, `.ai/**` and
  dependency bumps carry `skip-qa`. A `needs-qa` PR merges only after `qa-approved`. The QA
  reviewer takes the blind pair with
  `node scripts/visual/capture.mjs` at 360x800 and 1280x900 in both themes (ADR 0016);
  `om-auto-qa-pr` evidence complements it and never replaces it. An unattended run passes
  `--self-qa-signoff` and signs off on its specialist panel's approving verdicts (the unattended
  sign-off in the QA gate above), `risk-high` included (owner decision 2026-10-06, ADR 0031).
- **What a ticket contains** beyond the Definition of Ready: `docs/agents/issue-tracker.md` (tenant
  isolation test, money invariant, visual change expected).

### Stacked pull requests

"PRs target `develop`" has one exception: a PR based on the branch of another open PR. It does not
target `develop` until its base merges, which is expected, not a finding.

- **When to stack.** Only when the ticket or its spec says the work ships as more than one PR,
  usually because the halves are reviewable separately and would bury each other. Never as a way
  to split a PR that grew large. The unattended pipeline stacks only on that explicit instruction.
- **How to open it.** Base the second PR on the first PR's branch. The first carries `Refs #<n>`
  and the last `Closes #<n>`, so the issue closes exactly once. Merge them in order, base first.
- **Retargeting is not automatic here.** GitHub retargets a stacked PR when the base PR's head
  branch is deleted, and this repository has `delete_branch_on_merge=false`, so nothing does. After
  the base PR merges, retarget by hand with the REST operation (`gh pr edit` is unusable on this
  host, `.ai/trackers/github.md`):
  `gh api -X PATCH repos/{owner}/{repo}/pulls/{prNumber} -f base=develop`. Retarget **before**
  anyone deletes the base branch: GitHub closes a PR whose base branch disappears under it (its
  documented behaviour; not exercised in this repository).
- **CI does not run on the way.** `.github/workflows/ci.yml` triggers on `pull_request` against
  `main` or `develop` only, so a PR whose base is another feature branch gets no CI run, and
  merging into that branch passes through no required check: it is not a quality gate. A retarget
  alone starts none either, because it fires `edited`, which the workflow does not listen to
  (#175 merged 88 seconds after #172 with none of the required checks ever reported on it). After the retarget the
  author merges `develop` into the branch and pushes, which fires `synchronize` against `develop`
  and starts CI. The PR does not merge until the required checks are green on that run. A local
  validation-gate pass is review evidence, never a substitute for them. No force-push, no
  `--no-verify`.
- **CI does not start on a retarget, by design (#546).** Listening to `edited` would make every
  title or body edit a CI trigger, and two things make that unsafe. A run for `edited` joins the
  `ci-<ref>` concurrency group, which cancels in-flight pull request runs, so an edit could cancel
  a real run on the same ref. A job guarded to skip unless the base changed would report as skipped
  under the required check names, and GitHub counts a skipped required check as passing, so a
  failing or cancelled result could be masked. The ruleset already keeps a PR whose required checks
  never reported from merging, so the cost of the gap is the remedy above: one merge commit and one
  push per stacked PR. A merge without the required checks is an admin bypass, and it is reported as
  one. Revisit only after a second stacked-PR incident: then a trigger on `edited` with a per-event
  concurrency key and no cancellation on `edited`.

### The Reconciler

The Reconciler is a level-triggered loop on the cezar host (a cron every ten minutes; `docs/agents/cezar.md`
§ The Reconciler, ADR 0030). It starts work only when there is work and a free `maxParallel` slot, and it repairs a
run that failed by continuing it. What there is to do is not decided in the cron: it asks
`node .ai/scripts/backlog-status.mjs --plan`, which prints its candidates per kind, in this order, best first, each with
the workflow and task text to send. `implement`, `unblock` and `triage` rank up to three, so a candidate the Reconciler
cannot start hands its turn to the next; `slice` and `write-spec` name one:

| Kind         | Candidate                                                                                                                         | Workflow           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `implement`  | the READY issues in `--next` order, the first being the one `--next` picks (nothing at the WIP limit)                             | `implement-ticket` |
| `unblock`    | the issues whose `blocked` hold, or unanswered not-ready or `STOP:` comment, an agent left and that do not say `HUMAN-ONLY:`      | `unblock`          |
| `triage`     | the issues that need an Agent Brief or a category, priority or risk label                                                         | `triage`           |
| `slice`      | the oldest `ready` spec directly in `.ai/specs/` that no issue (open or closed) opens with `Spec: <path>`                         | `spec-to-tickets`  |
| `write-spec` | the first stage of `docs/plans/` nothing covers, while no PR adds a spec or marks stages delivered and no spec waits to be sliced | `plan-to-spec`     |

Every candidate is dropped while a cockpit run already holds it: an issue by its `issueNumber`, a spec path or a stage
id by the run's task text. A run holds it while it is `queued`, `running` or `waiting`, and a `failed` run holds it
while `autoResumeAt` says the cockpit resumes it by itself. Nothing in it is an engine feature: the cron, the
cockpit API and these scripts and workflows are all there is.

Two limits keep it from running away. WIP is counted as in § Readiness: only PRs a person has to clear. And the
pipeline never asks a person a question it can put to a specialist: a person is named by a `HUMAN-ONLY:` comment, which
is also what stops the Reconciler from starting the same run again.

### Automations

Workflows live in `.ai/cezar/workflows/`; the committed definitions are
`docs/agents/cezar-automations.json`, applied with `.ai/scripts/cez-automations.sh`.

| Automation                         | Trigger                               | Workflow                                          |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------- |
| Autopilot new pull requests        | `pull_request.opened` by a maintainer | `pr-autopilot`                                    |
| Merge reviewed agent pull requests | agent PR reviewed into `merge-queue`  | `pr-autopilot`                                    |
| Weekly architecture review         | Mondays 06:00                         | `architecture-review` (`afk-architecture-review`) |
| Weekly lessons                     | Fridays 16:00                         | `lessons` (`afk-lessons`)                         |

The Reconciler (§ The Reconciler) starts triage, implementation, slicing and unblocking. The
automations that used to start the same work - **Implement the next ready issue** and **Spec to
tickets** on a schedule, **Groom and triage new issues** and **Re-triage when a hold is cleared** on
an issue event - are retired, because each would start an issue or a spec a second time. The two
issue ones stay in the file with `"enabled": false`: their `authors` gate is the trusted-author list
`backlog-status.mjs` reads, and without it the Reconciler would start nothing.

`housekeeping` (`om-review-prs`, `om-merge-buddy` report, `om-close-fixed-issues`) has **no cezar
automation but does run on a schedule**: the launchd agent `dev.money-tracker.housekeeping` calls
`.ai/scripts/housekeeping.sh` on weekdays at 07:00, 12:00 and 17:00. It is not in the table above
because that table lists cezar automations, and this one is a host-level timer — which is exactly
why this paragraph used to say the opposite. So the review sweep and post-merge reconciliation do
run unattended; an issue whose PR merged closes at the next run rather than waiting for a person,
and a merger's manual `/om-close-fixed-issues` matters only between those three runs.

Twelve workflows have **no automation and no schedule**: `backlog`, `brainstorm`, `implement-spec`,
`pr-review`, `issue-autofix`, `issue-groom`, `spec`, `triage`, `unblock`, `plan-to-spec`,
`implement-ticket` and `spec-to-tickets`. The Reconciler (§ The Reconciler) starts `triage`,
`unblock`, `plan-to-spec`, `implement-ticket` and `spec-to-tickets`; a person starts any workflow
from the cockpit.

The `authors: ["rafalwolak"]` filter on the issue and PR automations is a security gate, not a
convenience: those runs read the issue or PR body as a prompt and hold Bash with no allowlist, so
anything from anyone else waits for a maintainer to start a run from the cockpit. The same list is
what `backlog-status.mjs` trusts, so such an issue is never picked by the Reconciler either.

Applying the retirement on the host: the Reconciler's sync re-applies the file without `--prune`,
which disables the two issue automations and lists the two schedules as `not in file`. Disable
**Implement the next ready issue** and **Spec to tickets** in the cockpit (Automations), then run
`.ai/scripts/cez-automations.sh --dry-run --prune` and `.ai/scripts/cez-automations.sh --prune`:
the script refuses to delete an enabled stray.

**Guardrails:**

- Cezar merges into `develop` with `om-pr-autopilot --allow-merge`: the last step of
  `implement-ticket` and of `plan-to-spec` (a spec PR the specialist panel approved, or the docs-only PR that marks delivered plan stages, ADR 0030), a PR a maintainer opened, and an agent PR reviewed into `merge-queue`
  (ADR 0027, amended 2026-10-01). A spec PR `implement-ticket` writes for a spec task is not among them: it is spec-only with an `Issue` row and no `Plan` row, so a person merges it. It never merges into `main`: the `develop` -> `main` promotion
  carries `do-not-merge` (ADR 0029) and is the owner's. A person merges everything else, with `gh pr merge`, or with `gh pr merge --auto` to
  land it once the required checks pass. The rulesets require only the three CI checks (`docs/agents/cezar.md`);
  every label rule in this document is a convention that `om-merge-buddy` and
  `om-approve-merge-pr` read and the person merging honours, and nothing in CI enforces it
  (ADR 0027). The process label `merge-queue` is not a GitHub merge queue entry.
- A `risk-high` or `security` PR gets a deeper review: the security and tenancy reviewer sits on
  its QA panel and judges its diff before it merges (ADR 0031). A `needs-qa` PR waits for
  `qa-approved` from the unattended sign-off or a QA reviewer. Promotion from `develop` to `main` merges after the
  release decision.
- `backlog-status.mjs --next` and `--plan` pick no implementation while three PRs are waiting for
  a person (`blocked`, `do-not-merge`, or `changes-requested` with no update for 24 hours; QA and
  risk labels are the agents', ADR 0031), and
  that cap is shared: a cockpit-started `issue-autofix` PR counts against it too, because every run
  publishes under the same `gh` identity. A PR the pipeline merges by itself does not count (ADR 0030),
  and neither does the promotion (base `main`).
- Triage sends `risk-high` or `security` work to an agent only on a security and tenancy
  specialist's approving verdict (§ Delegated decisions), and the implementing automation still
  requires `risk-low` to start by itself. The PR still passes every review and QA gate above.
- **Governance documents are `risk-high`.** `DESIGN.md`, `BACKWARD_COMPATIBILITY.md`,
  `docs/ACCESSIBILITY.md`, `docs/MONEY.md` and `docs/adr/` record decisions a human owns. A change
  to one takes a second reviewer and merges on the security and tenancy specialist's verdict at the
  head it judged (ADR 0031), not on a person's reading. `.github/CODEOWNERS` routes the same paths
  to a reviewer, which is informational: both rulesets keep `require_code_owner_review: false`. For
  such a change a person is the merger only where `afk-decide` § 5 and ADR 0031 name one: the
  `develop` -> `main` promotion, a `do-not-merge` PR, and a PR `blocked` after the third failed
  round.
- A person's `qa-failed` or an active `qa` label stops a PR (ADR 0031 § Consequences) but is
  deliberately not counted by the WIP cap: only `blocked`, `do-not-merge` and a parked
  `changes-requested` count.
- To stop it all, `cez automation pause <id>`, or start the cockpit with `CEZ_AUTOMATIONS=0`.

**The agent layer is this repository's.** `.ai/cezar/workflows/`, `.ai/scripts/`,
`.ai/skills/afk-*/`, `.claude/hooks/`, `docs/agents/cezar-automations.json` and the Claude
`.github/workflows/` were rendered from `design4pro/agent-kit` until it was retired (ADR 0021).
They are ordinary files now: edit them here, in the pull request that needs the change — a cezar
run included, since a branch's diff is read before anything merges. They stay listed in
`.prettierignore` so a change to one is readable as a diff, not as a reflow.
<!-- END per-repo -->
