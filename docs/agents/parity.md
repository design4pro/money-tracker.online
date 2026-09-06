# Feature-parity gap register

**What this is.** A one-off audit of our implementation-plan set (`docs/plans/00`–`27`) against the
feature surface of two public reference products, compiled **2026-09-02**. The product owner's scope
decision is that this product should match the reference surface; this file says where the plan set
already does, where it does not, and where not doing so is a decision rather than an omission.

**It is a snapshot and it goes stale.** It was compiled against the plan files at the time of
writing and against two public sources read on that date. Both move. Re-run the audit before using
it to argue about scope, and amend it in the same change as the plan it contradicts.

**Sources.** The two references are the open-source repository `letehaha/budget-tracker` on GitHub
(its readme and its public file tree) and the public marketing page of `moneymatter.app`. They are
the same product: one is the code, the other is the shop window. Naming them is permitted **here**,
because this is a product document and not an artefact of the blind pixel loop. It is not permitted
anywhere else - `docs/agents/reference.md`, clause 7.

**What crossed and what did not.** Only _capabilities_ crossed, and they are written below in our own
words and our own vocabulary (`CONTEXT.md`). No label, sentence, identifier, path, table name, enum
value, provider name, price or quota from either source appears in this file
(`docs/agents/reference.md`, clauses 4-6). Where a capability has no name in our glossary it is
described by what it does. Nothing was read from the running application's markup or network traffic.

**Method, and its limits.** Our side is 169 minted rows across plans `06`–`27`, plus the rows of
plans `02`, `03` and `04` where a reference capability lands there. Coverage was judged strictly: a
plan that mentions a word is not coverage; a row that promises the behaviour is. The reference side
was assembled from a marketing feature list and a public directory tree, which reveals what surfaces
exist but not how good they are - so a "covered" line means _both sides promise the behaviour_, never
that ours is as good.

---

## Covered

| Reference capability, in our words                                                                 | Our row id(s)                              | Plan                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------- |
| Manual account records with a currency, an opening balance and a running balance                   | `ACCT-01`                                  | `06-accounts.md`                             |
| An account list with totals across accounts                                                        | `ACCT-02`                                  | `06-accounts.md`                             |
| Leaving an account out of aggregate figures                                                        | `ACCT-03`                                  | `06-accounts.md`                             |
| An account detail surface with tabs and its own settings                                           | `ACCT-04`                                  | `06-accounts.md`                             |
| A borrowing ceiling on a card-shaped account and how much of it is used                            | `ACCT-05`                                  | `06-accounts.md`                             |
| Retiring an account without losing its history, and bringing it back                               | `ACCT-06`                                  | `06-accounts.md`                             |
| Reconciling a recorded balance against a counted one                                               | `ACCT-07`                                  | `06-accounts.md`                             |
| Arranging accounts into named groups                                                               | `ACCT-08`                                  | `06-accounts.md`                             |
| Brand imagery on an account and on a counterparty                                                  | `ACCT-01`, `CLS-08`                        | `06-accounts.md`, `08-classification.md`     |
| Creating, editing and deleting a movement of money                                                 | `TXN-01`                                   | `07-transactions-core.md`                    |
| Filtering, sorting and paging a dense list, including free text over the note and the counterparty | `TXN-04`, `TXN-05`                         | `07-transactions-core.md`                    |
| A dedicated entry form designed for speed                                                          | `TXN-06`                                   | `07-transactions-core.md`                    |
| A detail surface for one movement                                                                  | `TXN-07`                                   | `07-transactions-core.md`                    |
| Seeing expected future entries alongside recorded ones                                             | `TXN-08`, `REC-02`                         | `07-transactions-core.md`, `13-recurring.md` |
| Two-level classification with colour and icon                                                      | `CLS-01`                                   | `08-classification.md`                       |
| Editing and reordering the classification tree                                                     | `CLS-02`, `CLS-03`                         | `08-classification.md`                       |
| Free cross-cutting labels on a movement                                                            | `CLS-04`                                   | `08-classification.md`                       |
| Reminders driven by a label                                                                        | `CLS-05`                                   | `08-classification.md`                       |
| Counterparty records with a default classification                                                 | `CLS-06`                                   | `08-classification.md`                       |
| Resolving several spellings of one counterparty onto one record                                    | `CLS-07`                                   | `08-classification.md`                       |
| A counterparty list and detail surface                                                             | `CLS-08`                                   | `08-classification.md`                       |
| Moving money between two of your own accounts as one linked pair                                   | `XFER-01`, `XFER-02`, `XFER-04`            | `10-transfers-and-refunds.md`                |
| Breaking one movement into several classified lines                                                | `SPLIT-01`, `SPLIT-02`                     | `11-splits-groups-attachments.md`            |
| Grouping several movements by hand                                                                 | `SPLIT-03`                                 | `11-splits-groups-attachments.md`            |
| Reusable entry templates                                                                           | `SPLIT-04`                                 | `11-splits-groups-attachments.md`            |
| Receipt images attached to a movement                                                              | `SPLIT-05`, `SPLIT-06`                     | `11-splits-groups-attachments.md`            |
| Spending limits over a period, of both the fixed-classification and the hand-picked kind           | `BUD-01`, `BUD-04`                         | `12-budgets.md`                              |
| How much of a limit is used, shown as a bar                                                        | `BUD-02`, `BUD-03`, `BUD-06`               | `12-budgets.md`                              |
| A timeline of a limit's period                                                                     | `CHART-08`                                 | `16-charts.md`                               |
| Repeating expected payments with a frequency and an anchor                                         | `REC-01`                                   | `13-recurring.md`                            |
| Due state per occurrence, and linking a real movement to one                                       | `REC-02`, `REC-05`                         | `13-recurring.md`                            |
| A list and detail surface for repeating commitments                                                | `REC-03`                                   | `13-recurring.md`                            |
| Recording an occurrence without being asked                                                        | `REC-04`                                   | `13-recurring.md`                            |
| Ordered automations: conditions, actions, and the order they run in                                | `RULE-01`, `RULE-02`, `RULE-03`            | `14-rules.md`                                |
| An automation editor with a live preview of what would match                                       | `RULE-04`, `RULE-05`, `RULE-06`            | `14-rules.md`                                |
| Money in against money out over a period                                                           | `ANL-01`, `ANL-03`                         | `17-analytics.md`                            |
| Total value over time                                                                              | `ANL-01`, `ANL-03`                         | `17-analytics.md`                            |
| Spending broken down by classification, and by counterparty                                        | `ANL-01`, `ANL-03`                         | `17-analytics.md`                            |
| A cross-tabulated report and a year-at-a-glance view                                               | `ANL-01`, `ANL-03`                         | `17-analytics.md`                            |
| A period picker with a comparison window, and a granularity choice                                 | `ANL-02`                                   | `17-analytics.md`                            |
| Clicking a bucket in a report through to the rows behind it                                        | `ANL-04`                                   | `17-analytics.md`                            |
| Saved report configurations                                                                        | `ANL-05`                                   | `17-analytics.md`                            |
| Taking a report away as a delimited file                                                           | `ANL-06`                                   | `17-analytics.md`                            |
| Charts as the presentation layer for all of the above                                              | `CHART-02`–`CHART-05`                      | `16-charts.md`                               |
| A home screen of widgets the person arranges, with an edit mode                                    | `DASH-01`, `DASH-02`                       | `18-dashboard.md`                            |
| Widgets for total value, flow, balances, limits, commitments and recent activity                   | `DASH-03`, `DASH-04`, `DASH-05`, `DASH-06` | `18-dashboard.md`                            |
| Importing a delimited file: upload, column mapping, preview, commit                                | `IMP-01`, `IMP-02`, `IMP-03`, `IMP-05`     | `19-import.md`                               |
| Flagging rows that look like something already recorded                                            | `IMP-04`                                   | `19-import.md`                               |
| A record of past imports and the ability to undo one                                               | `IMP-06`, `IMP-07`                         | `19-import.md`                               |
| Taking all of your data away in an open format                                                     | `EXP-01`, `EXP-02`, `EXP-03`, `EXP-04`     | `20-export-and-backup.md`                    |
| Several currencies at once, with reporting in one chosen currency                                  | `MNY-06`, `MNY-08`                         | `03-money-and-currency.md`                   |
| Rates fetched automatically, and a rate the workspace overrides by hand                            | `MNY-03`, `MNY-04`, `MNY-05`, `MNY-07`     | `03-money-and-currency.md`                   |
| An operator-curated currency and rate catalogue                                                    | `MNY-01`, `MNY-02`, `CON-09`               | `03-money-and-currency.md`, `24-console.md`  |
| An in-app message centre with an unread count                                                      | `NOTIF-01`, `NOTIF-06`, `NOTIF-07`         | `21-notifications.md`                        |
| Per-channel, per-event message preferences                                                         | `NOTIF-02`, `NOTIF-08`                     | `21-notifications.md`                        |
| Messages by email, with unsubscribe honoured                                                       | `NOTIF-03`, `NOTIF-04`, `NOTIF-05`         | `21-notifications.md`                        |
| A settings hub with a navigation of its own                                                        | `SET-01`                                   | `23-settings.md`                             |
| Personal preferences: name, locale, time zone, theme                                               | `SET-02`                                   | `23-settings.md`                             |
| Workspace preferences, including the reporting currency and week start                             | `SET-03`                                   | `23-settings.md`                             |
| More than one person in one workspace, with roles and invitations                                  | `SET-04`, `SET-05`, `AUTH-02`, `AUTH-03`   | `23-settings.md`, `04-auth-and-tenancy.md`   |
| Password change, email change and a list of active sign-ins to revoke                              | `SET-06`                                   | `23-settings.md`                             |
| Deleting everything and closing the workspace                                                      | `SET-07`                                   | `23-settings.md`                             |
| A dark theme and an appearance preference                                                          | `SET-02`                                   | `23-settings.md`, `01-design-system.md`      |
| An interface in more than one language, negotiated per person                                      | `I18N-01`–`I18N-03`, `SET-02`              | `02-i18n.md`, `23-settings.md`               |
| An installable phone shell with its own chrome                                                     | `PWA-01`, `PWA-04`, `PWA-05`               | `27-pwa-and-mobile.md`                       |
| Layouts designed for a phone, not squeezed into one                                                | `PWA-06`, `PWA-07`                         | `27-pwa-and-mobile.md`                       |

**66 reference capabilities covered**, citing 106 distinct row ids (a range such as `CHART-02`–`CHART-05` counted by its endpoints).

---

## Gaps

Reference capabilities with **no owning row in any plan**, ranked by how soon a new person would
notice. Everything in this section is a gap in the register: it is either unplanned, or planned
nowhere and deferred in `99-boundaries-and-blockers.md`, which is a gap with a reason attached rather
than a decision to never build.

### 1. Turning an unstructured statement into candidate rows

**What it does.** A person pastes text, or uploads a file that is not a clean delimited export - a
printed statement, a rendered document - and the product proposes rows for review rather than
refusing the file. The reference does this with a language model behind it.

**Why it matters.** `docs/adr/0008-no-bank-connectors.md` is explicit that import is what we bought
instead of connectivity, and that being weak at it means we substituted nothing. A large share of
institutions publish a statement people can read and no export people can map. This is the single
place where our defining constraint is most exposed.

**Natural owner.** `19-import.md`. Blocked on `OPEN-3` in `99-boundaries-and-blockers.md` if the
implementation is a model call; not blocked if it is a parser.

**Observed 2026-09-02, pixels only.** Their import surface is organised by _where the data comes
from_, not by file format, in two groups - loose files and text, then migrations out of other
products - and the unstructured path is the first entry of the first group, above delimited text.
Ours is organised by format, which puts the weakest-signal case last. Ranking this gap first was
independent of that round and the round agrees with it.

### 2. Every import format the ADR promised and no row mints

**What it does.** Reading the two banking interchange formats, and migrating a person's history out
of other personal-finance products - a desktop ledger application, a well-known envelope budgeting
service, a mobile expense tracker's backup.

**Why it matters.** This is our worst internal contradiction, not merely a gap.
`docs/adr/0008-no-bank-connectors.md`, `BND-01` and the scope line for plan `19` in
`docs/plans/README.md` all name these formats as the substitute for connectivity. Plan `19` itself
then restricts v1 to delimited text and defers the interchange formats to `BND-30`, and no row exists
for any migration from another product. We are publishing a promise the row set does not keep.

**Natural owner.** `19-import.md`, with an amendment to `99-boundaries-and-blockers.md` so `BND-30`
and the ADR stop disagreeing.

**Observed 2026-09-02, pixels only.** The two banking interchange formats have no entry on their
import surface at all; the migrations out of other products do. So this gap is narrower than written:
the interchange formats are a promise we made to _ourselves_ in the ADR and owe ourselves regardless,
and the migrations are the part where a person moving between products can tell the difference.

### 3. Assisted classification as a reviewable batch over history

**What it does.** Proposing a classification for many unclassified movements at once, applied as a
run the person reviews and can look back at, rather than one row at a time.

**Why it matters.** Classifying is the chore that makes people stop using a finance tracker. Our
answer is `14-rules.md`, which is excellent for repeating counterparties and useless for the long
tail of one-off spending and for the backlog a fresh import lands.

**Natural owner.** `14-rules.md` for the apply-and-record path; `19-import.md` if it runs as an
import step. Blocked on `OPEN-3`.

### 4. Resolving incoming names onto existing records during an import

**What it does.** A step between column mapping and preview in which the incoming file's account
names and classification names are matched onto records that already exist, with bulk actions for
the ones that repeat, and a decision recorded for the ones that do not.

**Why it matters.** `IMP-03` maps _columns_ and `IMP-04` validates _rows_; neither reconciles the
_values_. Without this step a person importing a year of history either creates a duplicate
classification per spelling or edits several hundred rows afterwards.

**Natural owner.** `19-import.md`.

### 5. Sharing one account or one limit with another person

**What it does.** Granting another person access to a single account or a single spending limit
rather than to the whole workspace, and a surface listing what has been shared with you.

**Why it matters.** Our sharing unit is the workspace (`SET-04`, `AUTH-03`), so a household that
wants one shared account and two private ones has to run two workspaces and gets no combined figure.

**Natural owner.** `23-settings.md` for the surface, `04-auth-and-tenancy.md` for the second
authorisation axis. Recorded as **defer** under `BND-10`, blocked on `OPEN-2`.

### 6. Recomputing a balance after a bulk write, and saying when it disagrees

**What it does.** After an import, comparing the account's recorded balance against what the imported
history implies, telling the person the two disagree, and offering to recompute.

**Why it matters.** A silent disagreement between the balance on the account screen and the sum of
its history is the failure that destroys trust in a finance tracker, and a bulk import is exactly
when it happens. Our rebuild machinery (`BAL-02`, `BAL-05`) can do the arithmetic; no row surfaces
the discrepancy or offers the choice.

**Natural owner.** `19-import.md`, reading `09-balance-history.md`.

### 7. Restoring your own data without an operator

**What it does.** A person uploads the export they took earlier and gets their workspace back.

**Why it matters.** `EXP-07` is an operator script and a documented drill - it restores _for_ someone,
run by us, from our nightly backup. Export without self-serve restore is a promise of portability
that only works in one direction.

**Natural owner.** `20-export-and-backup.md`.

### 8. Erasing the financial data while keeping the login

**What it does.** Emptying a workspace of accounts and movements - a fresh start after a botched
import - without destroying the workspace, its members or its settings.

**Why it matters.** `SET-07` deletes the whole workspace with a typed confirmation, which is the
wrong tool for "my first import went wrong". Without this, the recovery path from gap 6 is to sign up
again.

**Natural owner.** `23-settings.md`.

### 9. Signing in through an identity a person already has

**What it does.** Sign-in delegated to a third-party identity provider, and a surface for managing
which sign-in methods are attached to one login.

**Why it matters.** `AUTH-09` covers email and password with two-factor, `AUTH-11` covers passkeys.
Neither is delegated identity, and the absence shows up at the moment of highest drop-off - the
sign-up form.

**Natural owner.** `04-auth-and-tenancy.md`.

### 10. Debt instruments with a schedule

**What it does.** A borrowing tracked as more than a negative balance: a term, an interest split per
payment, a projected payoff, real payments linked to the schedule, and a settled state at the end.

**Why it matters.** Debt is a large share of most households' financial picture, and an account with
a balance says nothing about when it ends or what it costs.

**Natural owner.** `28-loans.md`, added 2026-09-05. This line said "no plan today" and recorded the
gap as **defer** under `BND-11`; the product owner lifted that deferral and the plan now exists, so
the gap is **planned, not closed** — a plan is a promise and this register only ever recorded
promises on both sides. `06-accounts.md` still carries the account row it hangs off.

### 11. Depreciating assets with a value curve

**What it does.** A physical asset whose value declines on a modelled curve, with manual overrides
recorded as history rather than overwriting.

**Why it matters.** It is a real component of a total-value figure that otherwise has to be
maintained by hand through repeated balance adjustments.

**Natural owner.** No plan today; **defer** under `BND-11` alongside gap 10.

### 12. Reporting what caused a change in total value

**What it does.** Decomposing a movement in total value across a period into its contributors -
which accounts, which classifications, which currency effects - rather than only plotting the line.

**Why it matters.** The line answers _what_; people act on _why_. Our five aggregates (`ANL-01`) are
flow, total value over time, spending by classification, spending by counterparty, and period
comparison. None of them attributes a change.

**Natural owner.** `17-analytics.md`.

### 13. A read-only programmatic interface a person can grant to an outside tool

**What it does.** Scoped, revocable, read-only authorisation letting an external assistant or script
query the workspace's own figures.

**Why it matters.** It is how a finance product stops being a walled garden without shipping an
export button that goes stale the moment it is pressed. No plan owns an outward-facing API at all.

**Natural owner.** `04-auth-and-tenancy.md` would own the grant and revocation model; the surface
itself has no plan and would need one.

### 14. Choosing the model, and paying for it yourself

**What it does.** Per-feature model selection, credentials the person supplies, an endpoint they
point at, and instructions they write.

**Why it matters.** Only once gaps 1 and 3 exist. It is what makes a model-backed feature affordable
to run and acceptable to a privacy-minded person, and it is the difference between a feature and a
per-user cost.

**Natural owner.** `23-settings.md`. Blocked on `OPEN-3`.

### 15. Messages that arrive when the app is closed

**What it does.** Delivering an alert to a device rather than to an inbox the person has to open.

**Why it matters.** Threshold and due-date alerts (`BUD-07`, `REC-06`) are worth much less when they
wait in the app for the next visit.

**Natural owner.** `21-notifications.md`, alongside `27-pwa-and-mobile.md` for the transport.
Recorded as **defer** under `BND-13`; the preference column exists and is disabled.

### 16. An open screen that updates when someone else writes

**What it does.** Pushing a change to a member with the screen already open instead of waiting for
them to refetch.

**Why it matters.** Two people in a household entering movements at the same time currently get
last-write-wins and a stale screen.

**Natural owner.** No plan; **defer** under `BND-14`.

### 17. Trying the product without signing up

**What it does.** A seeded workspace a visitor can open and press things in.

**Why it matters.** It is the top of the funnel, and `MKT-02` ships screenshots instead.

**Natural owner.** `25-marketing.md` for the entry point; the workspace itself needs a plan.
Recorded as **defer** under `BND-15`, explicitly as a security decision.

### 18. Investment contribution and projection reporting, separately from holdings

**What it does.** Reporting what has been put into long-term savings over time, and projecting a
balance forward under an assumed return - neither of which needs an instrument model or a price feed.

**Why it matters.** `BND-03` drops _holdings_ tracking, and correctly. It does not follow that the
two reports are dropped, and they are the part most people actually look at. Nothing in `17-analytics.md`
covers either.

**Natural owner.** `17-analytics.md`.

**Observed 2026-09-02, pixels only.** Confirmed, and the framing above was right. Their reports
surface is an index of named reports in two groups, and the second group holds three of them: what
drove the change in net worth, what has been contributed over time, and a forward projection. Only
the first plausibly wants an instrument model; the other two are arithmetic over movements we
already store. Reading `BND-03` as dropping all three is a misreading of our own boundary, and this
is the evidence.

The same round turned up a report with **no counterpart anywhere in our plan set**: a
cross-tabulation of movements, two chosen dimensions against a chosen measure. It is not a chart, it
is the thing people export to a spreadsheet to build by hand. Recorded here as a candidate rather
than a gap, because nobody has decided we want it.

### 19. More than two interface languages, and a way for others to translate

**What it does.** A locale set that grows without a code change, fed by contributors.

**Why it matters.** `I18N-01` freezes the locale table at two on purpose and `I18N-06` gates on
parity between exactly those two. That is the right v1 and the wrong v3; the gap is worth naming
before the table is load-bearing.

**Natural owner.** `02-i18n.md`.

### 20. Tracking private or illiquid holdings as tracked positions

**What it does.** Following a commitment made outside a market - its milestones, its status changes,
its eventual outcome - as a first-class record rather than an account balance.

**Why it matters.** Honestly: for most people it does not. It is listed for completeness because the
reference has the surface. **Recommendation: refuse it**, with a new entry in
`99-boundaries-and-blockers.md`, rather than leave it as an open gap.

**Natural owner.** None. It should become a boundary.

**20 gaps.** Six of them (5, 10, 11, 15, 16, 17) already carry a recorded disposition of _defer_;
the other fourteen carry none, and gaps 1-4 sit inside the one area our own ADR says we cannot afford
to be weak at.

---

## Deliberately not built

These are **decisions, not gaps**. A ticket asking for one is closed against the record named here,
without triage.

| Capability the reference has                                                                                  | Our record                                      | The decision                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Connecting to financial institutions, aggregating accounts, scraping, syncing balances automatically          | `docs/adr/0008-no-bank-connectors.md`, `BND-01` | Permanent. Not staged, not experimental. The ADR names what we ship instead - fast entry, file import, repeating series, automations, pattern detection - and gaps 1-4 above are the bill for it                                                                                                                                                             |
| Any surface that accepts a banking credential, an institution grant or a card number                          | `BND-02`                                        | Follows from the above and is stated separately because it is the failure mode: a product with no connectors can still be talked into a paste-your-login form. The import pipeline rejects a column mapped to one (`IMP-04`)                                                                                                                                 |
| Holdings-level investment tracking: instruments, quantities, cost basis, corporate actions, a live price feed | `BND-03`                                        | Dropped for v1 and structurally. A second pricing pipeline and a second rounding regime, feeding a total-value figure people make decisions on. The substitute is an investment account whose balance is adjusted, with the adjustment recorded as a real movement (`ACCT-07`) - see gap 18 for the part of this that should _not_ have been dropped with it |
| Tax preparation, tax reporting, financial advice                                                              | `BND-04`                                        | The product records what happened. Exports (`20-export-and-backup.md`) are the hand-off to whoever does the rest                                                                                                                                                                                                                                             |
| Spreadsheet-format import and export                                                                          | `BND-12`                                        | Deferred, not dropped: the need is legitimate, the parser is the problem. Delimited text covers it in v1                                                                                                                                                                                                                                                     |
| Self-hosting the product yourself                                                                             | Not recorded anywhere                           | The reference is open source and deployable by its users; we are a multi-tenant hosted product with a platform console (`CON-01`–`CON-10`) and per-plan quotas (`BILL-04`). This is a business-model difference, not a feature gap, and it deserves an ADR so it stops being re-litigated                                                                    |

---

## Ours that they lack

Where our plan set is ahead. Two caveats, both real: several of these are _absence of evidence_ -
they are not claimed by a marketing page or visible in a directory tree, which is not proof they do
not exist - and a planned row is not a shipped feature.

- **Refunds as first-class links** (`XFER-05`, `XFER-06`), including at the level of a single split
  line, and including a refund whose original purchase was never recorded.
- **Proposing transfer pairs and duplicates that already exist in the ledger**, with dismissals that
  stick (`XFER-07`, `XFER-08`, `XFER-09`) - the same job the import duplicate check does, done for
  data already inside.
- **Proposing repeating series from history** rather than waiting to be told about them
  (`REC-07`, `REC-08`).
- **Carry policies on a spending limit** and a ledger of what each period carried in and out
  (`BUD-05`, `BUD-06`).
- **Savings targets** with contributions linked to real movements and a projected completion date
  (`GOAL-01`–`GOAL-05`). No counterpart is visible on the reference side.
- **An automation that pauses itself and says why** when something it points at disappears, with a
  surface for resolving it (`RULE-07`, `RULE-09`) - the alternative is a rule that silently stops
  matching.
- **Charts written for the keyboard and the screen reader**: a reachable data point, a text
  equivalent per series, no meaning carried by colour alone (`CHART-01`–`CHART-05`,
  `docs/adr/0007-hand-rolled-accessible-charts-over-a-chart-library.md`), plus a published, scoped
  conformance statement (`MKT-07`, `docs/adr/0009-scoped-wcag-conformance-claim.md`).
- **Historical fidelity of converted figures**: a reference amount recorded once at the rate of its
  booked date and never recomputed, so a report run twice returns the same number (`TXN-03`,
  `docs/MONEY.md`, `docs/adr/0006-integer-minor-units-for-money.md`). Automatic conversion is claimed
  on both sides; _reproducibility_ is claimed only on ours.
- **Balance history rebuilt, never accumulated**, serialised per account through one ledger
  (`BAL-01`–`BAL-07`, `docs/adr/0010-ledger-durable-object-for-balance-history.md`).
- **Tenant isolation enforced in the data layer**, not in the UI, with a refusal on an empty
  predicate and an isolation test per stage (`AUTH-04`, `AUTH-05`, `AUTH-06`,
  `docs/adr/0002-tenant-scoped-repository-boundary.md`).
- **Entitlements and quotas enforced at the data-access boundary** (`BILL-04`), and an operator
  console with a mandatory audit write on every privileged action (`CON-01`, `CON-02`, `CON-10`).
- **Entering a movement with no connection**, queued and replayed (`PWA-02`, `PWA-03`) - both sides
  ship an installable shell; only ours plans to be useful inside a tunnel.
- **A designed first run**: presets, a derived checklist, a sample workspace that can be deleted, and
  an audited empty state on every screen (`ONB-01`–`ONB-09`).
- **A complete legal and trust surface** in both locales (`MKT-07`, `MKT-09`).
