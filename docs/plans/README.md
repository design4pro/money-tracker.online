# money-tracker.online — implementation plans

`docs/` holds the spec and the architecture notes. This directory adds the third kind of document:
**staged implementation plans**, one per product area, that carve the product into stages small
enough for one agent to own end to end.

A plan is not a design document and not a backlog. It is a sequence of **stages**, each of which
names its owned paths, its data change, its server functions, its UI, its quota, its tenant-isolation
test, its **money invariant** and its verification — so that two agents working two stages in the
same wave can never write the same file. The stage shape is fixed by `TEMPLATE.md` and is not
negotiable per plan.

---

## How a plan becomes work

The plan set is the **backlog source**; GitHub Issues is the **execution surface**.

```
docs/plans/NN-area.md   →   spec in .ai/specs/ (`om-spec-writing`; its Phasing = the stages)
                                                        ↓
                                     one issue per stage (`om-prepare-issue`), in stage order
                                                        ↓
                                     a human adds `autofix` to one issue (or hands it to
                                     `issue-autofix` from the cockpit)
```

A stage's twelve headings are shaped to fill an issue body (`docs/agents/issue-tracker.md`).
`om-prepare-issue` writes one issue per stage with the category, priority and risk labels;
dependencies between stages are stated in the body (`Blocked by #n`), not as native sub-issues,
and a stage is picked up only when the issues it names are closed. When a plan and an
already-worked issue disagree, the issue wins and the plan is amended to say so.

---

## The concurrency contract: waves

**Stages inside a wave may run in parallel. A stage never depends on another stage in its own wave.**

That is the whole contract, and three properties enforce it:

1. **Owned paths are disjoint within a wave.** Two stages in one wave may not name the same file.
2. **The eight shared paths belong to `00-foundations.md` and to nothing else**, in any wave.
3. **No stage runs a tree-wide git operation while another stage is open.** Stashing, discarding
   the whole working tree, or resetting it hard respects no path ownership whatsoever: stashing
   with `-u` in particular removes every untracked file in the repository, so a stage that has
   written a new test but not yet committed it watches that file vanish and return underneath
   itself. The damage is not the lost work — popping the stash restores the bytes — it is that
   **every gate run inside that window lies, in both directions**: green against deleted tests,
   red against code from before a fix. To compare the working tree against `HEAD` while another
   stage is open, use a separate `git worktree`, or say so and wait. A gate result is evidence
   only if the files did not move under it; checksum them before and after if there is any doubt.

Waves are sequential: wave _n+1_ opens when wave _n_ is closed. A wave-0 stage owning a file that a
wave-3 stage later edits is fine — disjointness is a _within-wave_ rule.

`MAX_PARALLEL` in the orchestration loop is **2**, not because the wave contract limits it but
because the sandbox VM runs a Vite dev server, a local D1 simulation and two browser engines per UI
validation.

---

## The thirty-two files

Every authored file in this directory is listed here. There are no others, and nothing outside this
list may be added without amending this table first. Nothing sits beside the table either: an audit
of these plans writes no file into this directory, and _Where a finding goes_ below says where its
findings do go.

| File                              | Scope — one line each                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `TEMPLATE.md`                     | The stage block every plan copies: twelve required headings in a fixed order, plus the inherited definition of done |
| `00-foundations.md`               | The eight shared files no feature stage may claim; mints one stage per wave per concern, only on request            |
| `01-design-system.md`             | Tailwind 4 theme, `tokens.css`, the React Aria primitive set, the 7:1 palette, states, the motion contract          |
| `02-i18n.md`                      | The EN + PL layer: locale table, negotiation, catalogue, provider, Polish plurals, the parity gate                  |
| `03-money-and-currency.md`        | `src/lib/money.ts`, the currency catalogue, `rate_e10`, the FX client and refresh, workspace currencies             |
| `04-auth-and-tenancy.md`          | Better Auth, KV sessions, passkeys, workspace provisioning, the tenant-scoped repository, the auth screens          |
| `05-error-and-observability.md`   | `classifyFailure`, the redaction middleware, the failure envelope, `ErrorPanel`, the logger, Sentry, `/api/health`  |
| `06-accounts.md`                  | Accounts, groups, ordering, archive, credit limit, `exclude_from_stats`, balance adjustment, the account screens    |
| `07-transactions-core.md`         | Transaction CRUD with policies, `ref_amount` computation, the query layer, the list and entry screens               |
| `08-classification.md`            | Two-level categories, tags with reminders, payees with aliases and categorisation modes                             |
| `09-balance-history.md`           | `account_balances`, the rebuild algorithm, the `LEDGER` DO, `runWithLedgerBatch`, the nightly sweep                 |
| `10-transfers-and-refunds.md`     | Two-leg internal and one-leg external transfers, the four ref-amount cases, unlink-first, refunds, suggestions      |
| `11-splits-groups-attachments.md` | Splits with the sum invariant, manual transaction groups, R2 attachments, templates                                 |
| `12-budgets.md`                   | Manual and category budgets, periods, rollover, thresholds, utilisation, the budget screens                         |
| `13-recurring.md`                 | Series, periods, links and candidates; frequencies, anchors, auto-record, reminder presets, detection               |
| `14-rules.md`                     | The rule engine: conditions, actions, ordering, live preview, `paused_reason`, run-on triggers                      |
| `15-goals.md`                     | Savings goals, contributions, progress and projected completion                                                     |
| `16-charts.md`                    | The accessible SVG chart primitives: line/area, stacked bar, donut, sparkline, each with a text equivalent          |
| `17-analytics.md`                 | Cash flow, net worth, spending by category, the pivot report, the annual overview                                   |
| `18-dashboard.md`                 | The widget registry, the grid with edit mode, drag **and** keyboard move, the saved layout, nine widgets            |
| `19-import.md`                    | The import pipeline as queue jobs, the CSV mapper with presets, OFX and QIF parsers, two migrations, revert         |
| `20-export-and-backup.md`         | JSON/CSV export by group and range, R2 artefacts with expiry, full backup and restore                               |
| `21-notifications.md`             | The dispatch layer, i18n-keyed rows, the preference matrix, the inbox, the email templates                          |
| `22-billing.md`                   | The Polar client, checkout and plan change, the webhook, entitlements, `resolveLimits`, `assertWithinLimit`         |
| `23-settings.md`                  | Every settings surface: general, appearance, language, notifications, members, security, data management            |
| `24-console.md`                   | The platform console: users, sessions, impersonation, catalogue curation, the run registry, the audit log           |
| `25-marketing.md`                 | Landing, pricing, features, security, changelog and legal — EN and PL, SSR, SEO, OG images                          |
| `26-onboarding.md`                | The guided first run and the empty states across the app                                                            |
| `27-pwa-and-mobile.md`            | The installable shell, the offline entry queue, the mobile keypad, the designed 360px layouts                       |
| `28-loans.md`                     | The loan model, the integer amortisation engine, the schedule, settlement against a transaction, extra repayments   |
| `98-verification-protocol.md`     | **Protocol.** What a stage executes and what it leaves behind. Owns the evidence format; plans no feature           |
| `99-boundaries-and-blockers.md`   | **Boundary.** Where a dropped row goes and why. Carries no build work                                               |

### Filename scheme

`NN-kebab-area.md` — a two-digit ordinal that fixes reading order, then a lowercase kebab-case area
name. `TEMPLATE.md` is the only authored file exempt from the ordinal. **One plan per area; a plan
never spawns a second file, it grows another stage.**

### Where a finding goes

An audit that measures a plan against the tree produces findings, and none of them becomes a file
here. There is no findings register in this directory and there is not meant to be one: the plan set
is the backlog source and GitHub Issues is the execution surface, so a register would be a second
backlog competing with the tracker. Three destinations, chosen by what the finding is:

- **It stops a stage** → that stage's own **Blockers** heading, stated before the stage is scheduled
  rather than discovered mid-run (`TEMPLATE.md` → _Blockers_).
- **It is work, and no stage owns it yet** → a tracker issue (`om-prepare-issue`), back-linked from
  the plan it came from so the next reader of that plan meets it rather than having to search. The
  reconciliation of `00-foundations.md` filed #105–#108 that way, and that document names all four.
- **It will not be done** → an entry in `99-boundaries-and-blockers.md` under one of its four
  dispositions, added deliberately and with the reason written down.

A finding that fits none of the three has not been decided yet, and deciding it is the work.

---

## Row ids

There is no inherited gap matrix. Row ids in this plan set are **minted here**, in the plan that owns
them, as `<PREFIX>-NN`. They are safe to cite anywhere and are the preferred way for one plan to
point at a feature owned by another.

| Plan | Prefix | Plan | Prefix  | Plan | Prefix  |
| ---- | ------ | ---- | ------- | ---- | ------- |
| 00   | `FND`  | 10   | `XFER`  | 20   | `EXP`   |
| 01   | `DSY`  | 11   | `SPLIT` | 21   | `NOTIF` |
| 02   | `I18N` | 12   | `BUD`   | 22   | `BILL`  |
| 03   | `MNY`  | 13   | `REC`   | 23   | `SET`   |
| 04   | `AUTH` | 14   | `RULE`  | 24   | `CON`   |
| 05   | `OBS`  | 15   | `GOAL`  | 25   | `MKT`   |
| 06   | `ACCT` | 16   | `CHART` | 26   | `ONB`   |
| 07   | `TXN`  | 17   | `ANL`   | 27   | `PWA`   |
| 08   | `CLS`  | 18   | `DASH`  |      |         |
| 09   | `BAL`  | 19   | `IMP`   | 28   | `LOAN`  |

A row is closed by **exactly one stage**. A row that is only partly addressed says which behaviour is
deferred and to which stage id.

---

## The wave table

Read it as: _this plan's stages may start once every wave above it is closed._

| Wave | #   | Plan                              | Scope                                                                   | Depends on         |
| ---- | --- | --------------------------------- | ----------------------------------------------------------------------- | ------------------ |
| 0    | 00  | `00-foundations.md`               | The eight shared paths; one stage per wave per concern, only on request | —                  |
| 1    | 01  | `01-design-system.md`             | Theme, tokens, ~45 React Aria primitives, states, motion                | 00                 |
| 1    | 02  | `02-i18n.md`                      | Locales, negotiation, catalogue, plurals, parity gate                   | 00                 |
| 1    | 03  | `03-money-and-currency.md`        | `money.ts`, currency catalogue, rates, FX client, workspace currencies  | 00                 |
| 1    | 04  | `04-auth-and-tenancy.md`          | Better Auth, tenancy, the repository base, the auth screens             | 00, 01, 02         |
| 1    | 05  | `05-error-and-observability.md`   | Failure classification, redaction, logging, Sentry, health              | 00                 |
| 2    | 06  | `06-accounts.md`                  | Accounts, groups, archive, adjustment, the account screens              | 03, 04             |
| 2    | 07  | `07-transactions-core.md`         | Transaction CRUD, policies, the query layer, list and entry             | 03, 06             |
| 2    | 08  | `08-classification.md`            | Categories, tags, payees                                                | 07                 |
| 2    | 09  | `09-balance-history.md`           | Snapshots, the rebuild, the `LEDGER` DO, the nightly sweep              | 03, 06, 07         |
| 3    | 10  | `10-transfers-and-refunds.md`     | Transfers, the four cases, refunds, suggestions                         | 07, 09             |
| 3    | 11  | `11-splits-groups-attachments.md` | Splits, groups, attachments, templates                                  | 07                 |
| 3    | 12  | `12-budgets.md`                   | Budgets, periods, rollover, thresholds                                  | 07, 08             |
| 3    | 13  | `13-recurring.md`                 | Series, periods, links, candidates, auto-record                         | 07, 08             |
| 3    | 14  | `14-rules.md`                     | Conditions, actions, ordering, preview, self-pausing                    | 07, 08             |
| 3    | 15  | `15-goals.md`                     | Goals, contributions, projection                                        | 06, 07             |
| 4    | 16  | `16-charts.md`                    | The accessible chart primitives                                         | 01, 03             |
| 4    | 17  | `17-analytics.md`                 | Cash flow, net worth, spending, pivot, annual                           | 09, 12, 16         |
| 4    | 18  | `18-dashboard.md`                 | Widget registry, grid, nine widgets                                     | 12, 13, 15, 16, 17 |
| 4    | 19  | `19-import.md`                    | The import pipeline, CSV/OFX/QIF, two migrations, revert                | 07, 08, 09         |
| 4    | 20  | `20-export-and-backup.md`         | Export by group, R2 artefacts, backup and restore                       | 07, 12, 13         |
| 5    | 21  | `21-notifications.md`             | Dispatch, preferences, inbox, email templates                           | 02, 04, 12, 13     |
| 5    | 22  | `22-billing.md`                   | Polar, webhook, entitlements, quota enforcement everywhere              | 03, 04             |
| 5    | 23  | `23-settings.md`                  | Every settings surface                                                  | 04, 21, 22         |
| 5    | 24  | `24-console.md`                   | The platform console                                                    | 04, 05             |
| 6    | 25  | `25-marketing.md`                 | Landing, pricing, features, security, changelog, legal                  | 01, 02, 22         |
| 6    | 26  | `26-onboarding.md`                | The guided first run and empty states                                   | 06, 07, 12, 19     |
| 6    | 27  | `27-pwa-and-mobile.md`            | Installable shell, offline queue, mobile keypad, 360px layouts          | 01, 07             |
| 7    | 28  | `28-loans.md`                     | Loans: the amortisation engine, the schedule, settlement, payoff        | 06, 07, 13, 21, 22 |

**Not plans:** `98-verification-protocol.md` owns the evidence format and carries no row;
`99-boundaries-and-blockers.md` is where dropped rows go.

**One figure in the scope column is not a measurement.** Plan `01` reads `~45 React Aria primitives`.
That number is not derivable from the tree: measured at `119242d`, `src/components/ui/` holds 40
modules besides the barrel and `src/components/ui/index.ts` re-exports them in 80 statements, and
nothing in the repository says which of those a "primitive" is. The counting rule is the primitive
inventory that stage `01-S3` owns; it has not been written. Once that stage lands, the figure is
re-stated from the inventory's own count and cites it. Until then it stays approximate and is **not**
to be replaced by another unsourced number (#218). The inventory's path and the full measurement are
recorded under `01-S3`'s **Blockers** in `01-design-system.md`. They are named there rather than here
because the register may not name a document the tree does not have.

Three placements are editorial rather than mechanical and are stated so nobody goes looking for a
missing edge:

- **`16-charts.md` opens wave 4 rather than wave 3** even though its only real dependencies are 01
  and 03. It is placed with its consumers because 17 and 18 cannot start without it and there is no
  benefit to finishing it a wave early.
- **`22-billing.md` sits in wave 5**, after the write paths it must gate, because `assertWithinLimit`
  has to be wired at call sites that do not exist until plans 06–20 have landed. The catalogue
  (`src/lib/plans.ts`) is a wave-0 foundations file and exists from the start; only the enforcement
  wiring waits.
- **`27-pwa-and-mobile.md` is wave 6**, not wave 2 with transactions, because the offline entry queue
  needs the final shape of the transaction write path and the 360px layouts need every surface that
  has to fit into them.
- **`28-loans.md` enters at wave 7 and its stages span waves 7 to 10**, which is the only plan in
  this set that spans more than two. It is post-v1 work on a v1 codebase, so nothing in it can share
  a wave with what it depends on: `00-S17` lands the tables (wave 7), `28-S1` the engine and the
  repository that need them (wave 8), `28-S2` and `28-S3` the two screens that need the engine
  (wave 9, disjoint from each other), and `28-S4` the payoff work that edits the detail route
  `28-S3` owns (wave 10). The wave column above records where the plan **opens**; the stage ids
  record the rest.

---

## The eight shared paths

**Never claimed by a feature stage, in any plan, in any wave.**

| Path                      | Why it is shared                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/server/db/schema.ts` | One module for every table. Two stages adding columns in parallel corrupt each other silently                       |
| `src/server/worker.ts`    | Re-exports the DO classes, the queue consumer and the cron handler. A missing export fails isolate startup outright |
| `wrangler.jsonc`          | Bindings, migrations, limits, triggers — one file, one deployment, one owner. A new binding is a cost-model change  |
| `src/styles/tokens.css`   | The whole token contract of `DESIGN.md`. A second writer is silent visual drift                                     |
| `src/components/ui/**`    | Design-system primitives. A duplicate primitive is a defect, not a merge conflict                                   |
| `src/routeTree.gen.ts`    | Generated. Travels inside a stage's diff but is **never listed** under Owned paths                                  |
| `src/lib/plans.ts`        | The plan catalogue. A metric added here and not to the resolver is an unenforced published promise                  |
| `src/lib/money.ts`        | The money primitives. A second rounding function is the worst kind of duplicate                                     |

`00-foundations.md` owns all eight and carries a **stage register** table
(`Wave | Schema stage | Bindings + worker stage | Token stage | Primitive stage | Money stage`).

**A wave with no reported requirement mints no stage.** An empty stage is worse than a missing one:
it invites an agent to invent work in the one file where invention is most expensive.

A feature stage that needs a change to a shared path writes the requirement under its own **Data and
migration**, **UI** or **Quota** heading and stops. The requirement is then minted as a stage in
`00-foundations.md`. A stage whose Owned paths list contains one of these eight is malformed and is
rejected before it is scheduled. The rejection is the reviewer's to make; no test asserts it
(ADR 0027).

---

## Label vocabulary

The labels a plan-derived issue carries, and the ones the skills read. Full contract: `SDLC.md`;
meaning of each label: `.github/labels.yml`.

| Label                                                             | Meaning                                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `feature` / `bug` / `refactor` / `security` / `documentation`     | Category, exactly one per issue; a plan stage is a `feature`               |
| `priority-*` / `risk-*`                                           | One of each; `om-prepare-issue` sets them from the stage's risk section    |
| `in-progress`                                                     | A run holds the issue (assignee + label + claim comment); nothing restarts |
| `review` / `changes-requested` / `qa` / `merge-queue` / `blocked` | The pull request's pipeline state, at most one at a time                   |
| `needs-qa` / `skip-qa` / `qa-approved`                            | The QA gate; only a human sets `qa-approved`                               |

Body marker: `<!-- sentry-issue: SHORT-ID[#n] -->`.
Commits: Conventional Commits in English, agent runs included. There is no agent-only prefix.

---

## Rules that bind every plan in this directory

- **Extend, never recreate.** A stage that would write a second implementation of something already
  on disk is a defect, not a plan. Check `src/components/ui/index.ts` and the repository index first.
- **The dependency freeze is absolute.** `package.json` and `pnpm-lock.yaml` are not edited by any
  stage, and no stage installs a package (`docs/SPEC.md` §3.1). A package need is a **Blockers** entry
  with a disposition, and the row moves to `99-boundaries-and-blockers.md` if the disposition is drop.
- **A stage is sized to one agent and one run.** More than one migration, more than one route file, or
  more than one product area means it is two stages.
- **Money is a first-class stage heading.** `### Money invariant` is mandatory and is never skipped.
- **Protect what is already ahead of the reference.** Repository-enforced tenant isolation, integer
  minor units scaled by `digits`, integer `rate_e10`, the rebuild-not-accumulate balance history, the
  serialising `LEDGER` DO, and the accessible chart primitives. **No stage may regress one of these
  to match a reference behaviour** — that is the single most likely way the pixel-comparison loop's
  advice does damage.
- **The clean-room rule binds every word.** `docs/SPEC.md` §1. The reference product is never named,
  nothing is carried across, and plans describe behaviour rather than transcribing an implementation.
- **A plan that contradicts another plan's row says so and gives its own evidence**, measured at
  HEAD, rather than silently planning around it.

---

## Coverage

The register states its completeness claim once, here, so no plan has to carry it:

- Plans `00`–`28` plan the **in-scope surface** of `PRODUCT.md` → _Capabilities_, area by area.
- `99-boundaries-and-blockers.md` **bounds** everything `PRODUCT.md` → _Out of scope_ names, each
  with a recorded disposition and, where one exists, a named alternative.
- `98-verification-protocol.md` is **protocol**: it owns how every stage proves itself and plans no
  feature of its own.

Every capability is therefore either **planned**, **consciously bounded**, or **protocol**. A feature
that fits none of the three is a gap in this register and is filed by amending it — never by an
unregistered file.
