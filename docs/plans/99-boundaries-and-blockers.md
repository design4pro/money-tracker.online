# 99 — Boundaries and blockers

**This file carries no build work.** It is where a row goes when it is dropped, deferred or
substituted, and it exists so that "we decided not to" is a record rather than an absence. Every
entry names the disposition, the reason, and — where one exists — the thing we ship instead.

Four dispositions, and nothing else is allowed:

| Disposition    | Meaning                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| **drop**       | Never in this product. The reason is a product or legal position, not effort |
| **defer**      | Wanted, not in v1. Names the release or the precondition that unblocks it    |
| **substitute** | Not built as asked; a named capability already in the product covers it      |
| **hand-roll**  | No usable package exists; we write it. Names the plan that owns the writing  |

A stage's **Blockers** heading may cite an entry here. A stage may not invent a new entry: a new
boundary is an amendment to this file, made deliberately, with the reason written down.

---

## 1. Dropped permanently

### BND-01 — Bank connectors, open banking, and any automated account aggregation

**drop.** This is the product's defining constraint, not a gap. Full reasoning:
`docs/adr/0008-no-bank-connectors.md`, and `PRODUCT.md` → _Capabilities and Constraints_.

What we ship instead: manual entry designed to be fast (plan `07`, plan `27`'s numeric keypad),
file import from CSV / OFX / QIF / YNAB / Wallet backups (plan `19`), recurring series that
materialise expected rows before they happen (plan `13`), and rules that categorise on import
(plan `14`). A ticket asking for "connect my bank", "Plaid", "GoCardless", "Nordigen", "Salt Edge",
"TrueLayer", "screen-scraping" or "automatic sync" is closed against this row without further
triage.

### BND-02 — Any surface that transmits or stores a bank credential

**drop.** Follows from BND-01 and is stated separately because it is the failure mode: a product
with no connectors can still be talked into a "just paste your login so we can fetch it" form. No
route, no field, no import format and no support flow accepts an online-banking credential, an app
password, an OAuth grant to a financial institution, or a card PAN. The import pipeline rejects a
column mapped to anything that looks like one (plan `19`, `IMP-04`).

### BND-03 — Investment portfolio tracking with live security prices

**drop for v1 and structurally.** An `investment` account category exists and holds a balance in
its own currency; what does not exist is a holdings model (instrument, quantity, cost basis,
corporate actions) or a market-data feed. Doing it properly means a second pricing pipeline, a
second rounding regime and a regulated-adjacent data source. Doing it badly means a net-worth
figure that is wrong in a way people make decisions on.

Substitute available today: an investment account whose balance the person adjusts, with the
adjustment recorded as a real `is_balance_adjustment` transaction (plan `06`, `ACCT-07`), so the
history is auditable and the net-worth chart is honest about where the number came from.

### BND-04 — Tax preparation, tax reporting and regulated financial advice

**drop.** The product records what happened; it does not tell anyone what to do about it, and it
files nothing. Exports (plan `20`) are the hand-off to whoever does. Any copy that could read as
advice is a `docs/SECURITY.md`-adjacent review item, not a feature.

---

## 2. Deferred beyond v1

### BND-10 — Per-account sharing with a `transactionsWriteScope` of `all | own`

**defer to v2.** v1 ships **workspace-level** membership: a member of a household workspace sees
every account in it. Per-account scoping is a second authorisation axis on every read path and on
every aggregate, and it interacts badly with the balance-history rebuild (a rebuild is
account-wide; a scoped reader would see a total they cannot reconcile).

Precondition to unblock: a decided answer to `PRODUCT.md` → _Undecided_ → _household sharing
granularity_, and a design for how a scoped member's net-worth figure is described on screen.
Plan `04` ships the membership model that v2 would extend; nothing in it forecloses this.

### BND-11 — `vehicle` dedicated account flows

**defer.** A vehicle whose value declines on a modelled curve, with manual overrides recorded as
history rather than overwriting, is a real component of a net-worth figure that otherwise has to be
maintained by hand through repeated balance adjustments. It is still not v1's: it needs a valuation
model, a curve the person can argue with, and an override history, and none of those has an owner.
Nothing in plan `06` blocks it — the account row already carries `category` and a note.

**The `loan` half of this entry was lifted on 2026-09-05** by the product owner, who asked for loan
management as a feature rather than an account category. It is now planned as `28-loans.md`, with
its schema requisitioned as `00-S17`, and it is no longer a boundary. `PRODUCT.md` → _Capabilities_
carries the scope change and `docs/agents/parity.md` → gap 10 records that its register line moved.
This paragraph stays because a lifted deferral that leaves no trace reads, six months later, like
a boundary nobody ever set.

### BND-12 — XLSX import and export

**defer, with a substitute shipping in v1.** SheetJS is large and has a history of parser CVEs
that is not worth carrying for a format CSV already covers. v1 exports CSV and JSON (plan `20`)
and imports CSV, OFX, QIF, YNAB and Wallet JSON (plan `19`). Revisit only if a maintained,
audited, tree-shakeable reader appears **and** a real user need survives the CSV path.

Disposition if it returns: **defer**, not drop — the need is legitimate, the package is the problem.

### BND-13 — Push notifications

**defer.** The `push` channel exists as a column in `notification_preferences` and is disabled in
v1 (plan `21`). Web Push needs a VAPID key pair, a subscription store, a service-worker message
path and a per-browser permission flow that is its own UX problem. The PWA shell (plan `27`) does
not depend on it. Enabling the column without shipping the transport would publish a promise the
product does not keep.

### BND-14 — Realtime multi-user sync

**defer.** There is no live collaborative surface in v1: two members of a household editing at once
get last-write-wins plus a refetch, not a merged document. `partysocket` is deliberately absent
from the dependency set (`docs/SPEC.md` §3). If it returns it is a Durable Object per workspace and
a patch protocol, and it is a plan of its own.

### BND-15 — A public, writable demo workspace ("try it without signing up")

**defer, and it is a security decision, not a marketing one.** A shared, publicly reachable,
writable workspace is a live abuse surface: storage, queue jobs, outbound email and AI calls all
run on our meter, and the tenant boundary becomes the only thing between an anonymous visitor and
somebody's real data. If it ships it needs its own plan (`28`), a hard TTL, its own quota ceiling,
outbound email disabled for the tenant, and a row in `docs/SECURITY.md`.

Marketing (plan `25`) ships product screenshots of the seeded demo workspace instead, which
carries no runtime surface at all.

### BND-16 — Per-workspace database sharding

**defer, with a stated ceiling instead.** D1 is 10 GB per database and has no read replicas by
default. `docs/ARCHITECTURE.md` §7 states the ceiling, the sparse-snapshot rule that keeps us far
from it, and the alarm that fires before it matters. Sharding now is expensive; discovering the
need later is worse, so the alarm — not the shard — is the v1 deliverable.

---

## 3. Substituted

### BND-20 — A chart library

**substitute: our own primitives.** `recharts`, `chart.js`, `visx` and `nivo` all lose on the same
axis: none of them gives a per-series text alternative, a keyboard-reachable data point and a
non-colour encoding without being fought. Plan `16` writes line/area, stacked bar, donut and
sparkline on `d3-scale` / `d3-shape` / `d3-time`. Reasoning: `docs/adr/0007-hand-rolled-accessible-charts-over-a-chart-library.md`.

### BND-21 — A Radix-based shadcn registry

**substitute: React Aria Components.** We keep shadcn's _shape_ — owned copy-in components under
`src/components/ui/**` with `cva` recipes over Tailwind tokens — and take the behaviour from
`react-aria-components`. Reasoning: `docs/adr/0005-react-aria-over-radix.md`. Consequence for
plans: a stage that reaches for a Radix primitive by name has mis-read plan `01`'s inventory.

### BND-22 — `vaul` for the mobile drawer

**substitute:** a variant of the React Aria `Modal` primitive (plan `01`). One overlay
implementation, one focus-trap, one dismiss contract.

### BND-23 — The Polar SDK

**substitute:** a hand-rolled REST client on `fetch` + WebCrypto (plan `22`). The SDK pulls a
Node-shaped dependency tree into a Worker isolate for four endpoints and one HMAC check. Reasoning:
`docs/adr/0012-polar-for-subscription-billing.md`.

---

## 4. Hand-rolled

### BND-30 — OFX and QIF parsers

**hand-roll, owned by plan `19`.** Scope is deliberately narrow: OFX 1.x SGML and OFX 2.x XML,
`STMTTRN` records only — no investment statements, no `INVSTMTMSGSRSV1`, no balance
reconciliation against `LEDGERBAL`. QIF is the `!Type:Bank` / `!Type:CCard` subset. The npm
options are unmaintained and their failure mode on a malformed file is an exception with no row
number, which is exactly the information the import preview needs.

Risk accepted: real-world files from real institutions violate both specs, so the parser's contract
is _"every row either parses or produces an `import_row_errors` entry naming the row index"_ —
never a thrown parse that loses the batch.

### BND-31 — The i18n runtime

**hand-roll, owned by plan `02`.** No `i18next`, no `react-intl`, no `lingui`. Two locales, a
frozen locale table, `import.meta.glob` catalogues, CLDR plural rules for Polish's four forms, and
a parity test as the completeness gate. The libraries are all larger than the problem and none of
them makes the parity gate any easier.

### BND-32 — The passkey / WebAuthn plugin

**hand-roll, owned by plan `04`**, ported from the reference implementation's shape. Better Auth's
own passkey plugin is not carried; ours is under `src/server/auth/passkey/**`.

---

## 5. Blocked on a product decision

These are not dispositions yet. Each is an open item in `PRODUCT.md` → _Undecided / not yet product
truth_, and a stage that needs one **cites it here and stops** rather than choosing silently.

| Id       | Open question                                                                   | Blocks           |
| -------- | ------------------------------------------------------------------------------- | ---------------- |
| `OPEN-1` | Is multi-currency a paid module or a core capability? Free 3 accounts or 5?     | `22`, `25`, `03` |
| `OPEN-2` | Household sharing granularity — workspace-level only in v1? (see BND-10)        | `04`, `23`       |
| `OPEN-3` | Does Workers AI import assist ship in v1? If not, the `AI` binding is removed   | `19`, `00`       |
| `OPEN-4` | FX provider: keyless free primary, or a paid keyed provider with an SLA         | `03`             |
| `OPEN-5` | `rollover_policy` semantics — what happens to an overspent envelope             | `12`             |
| `OPEN-6` | Are zero-decimal currencies (JPY, KRW, HUF-style) in v1 scope                   | `03`, `16`       |
| `OPEN-7` | Category-budget attribution when one transaction has two splits in one category | `11`, `12`, `17` |
| `OPEN-8` | DPA, sub-processor list and the Sentry money-scrubber policy                    | `05`, `25`       |

`OPEN-8` is the only one on this list that is a launch blocker rather than a scope question: the
product stores financial data for EU residents, and `docs/SECURITY.md` names what is still owed.
