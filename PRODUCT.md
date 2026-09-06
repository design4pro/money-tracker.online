# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: one person who wants to know where their money went and where it is going.** Somebody
who already tracks money badly — in a spreadsheet, in a notes app, in their head — and wants a
tool that is faster to enter into than the spreadsheet and honest about the arithmetic.

Secondary participants the product serves as first-class:

- **Household members.** A workspace with two to six people sharing one set of accounts, one base
  currency and one net-worth figure. The workspace is the unit of isolation and billing; a
  personal workspace is the degenerate case of the same model, not a separate product.
- **Multi-currency holders.** People paid in one currency and living in another, or holding
  savings abroad. This is not an edge case in Europe; it is the ordinary case, and it is where
  most competing products quietly produce wrong numbers.
- **Workspace administrators** managing members, billing and settings.
- **Platform actors** (`admin`, `curator`) operating across workspaces — currency and FX catalogue
  curation, support, impersonation. Every such action is audited.

## Product Purpose

money-tracker.online is a multi-tenant SaaS personal finance manager: accounts and balances,
transactions with splits and attachments, categories, tags and payees, budgets with rollover,
recurring series, savings goals, automation rules, file import and export, and analytics that a
screen-reader user can actually read.

The **transaction** is the central object and the **account** is what it moves. Everything else —
budgets, categories, recurring series, goals, reports — is a lens over the same rows. There is
exactly one arithmetic, defined in `docs/MONEY.md`, and every surface uses it.

Success is a person who enters a transaction in under ten seconds on a phone, trusts the net-worth
number on the dashboard enough to make a decision with it, and never opens a spreadsheet to check
the product's work.

## Positioning

Five claims, all five checkable:

1. **Manual by design, not by limitation.** No bank connectors, ever. We never ask for banking
   credentials, never hold a token that can read an account, and never pay an aggregator. What a
   connector buys — rows arriving without typing — is bought instead by fast entry, file import
   (CSV, OFX, QIF, and migrations from other trackers), recurring series that materialise
   themselves, and rules that classify on arrival.
2. **The arithmetic is correct and it is written down.** Integer minor units scaled by the
   currency's own `digits`, so JPY and KWD are right rather than approximately right. Exchange
   rates stored as integers, not floats. A historical conversion frozen at the date it happened,
   never recomputed. Balance history rebuilt from held units rather than accumulated from
   converted deltas. Every one of those is a bug we have seen in this category and refuse to ship.
3. **Multi-currency as a first-class model, not a display filter.** A workspace has one base
   currency; every amount carries its own currency, its own reference amount and the rate that
   produced it.
4. **Accessibility as an engineering gate, not a marketing line.** WCAG 2.2 **AA is the hard CI
   gate** across the product, plus a named list of AAA criteria held to AAA. Every chart carries a
   text equivalent, every drag surface carries a keyboard path, and the axe suite runs on every
   route in the visual spec. What is and is not claimed is stated exactly in `docs/ACCESSIBILITY.md`.
5. **Workspace-grade rigour.** Tenant isolation enforced at the data boundary rather than by
   convention, entitlements and quotas asserted at the same boundary, audited platform actions,
   and export-everything at any time on any plan.

## Operating Context

- **Multi-tenant SaaS on Cloudflare Workers.** One Worker, one D1 database, KV, R2, Queues and one
  Durable Object. Two long-lived environments: staging from `develop`, production from `main`.
- **Two locales: English (source) and Polish.** Both LTR. Every user-facing string lives in a
  catalogue and a new key lands in both locales in the same change.
- **Billing through Polar**, three plans (`free`, `plus`, `household`), monthly or yearly. The
  tiers are separated by **people, scale and multi-currency**: free is one person, three accounts
  and one currency; `plus` is one person without ceilings and with as many currencies as they
  keep; `household` is up to six people sharing one workspace with nothing capped. The numbers
  live in `src/lib/plans.ts` and are the ones enforced.
- **Authentication through Better Auth**, sessions in KV, with passkeys, TOTP two-factor and
  optional Google / Apple sign-in.
- **The reference product** (an open-source budget tracker and a commercial competitor's public
  demo) is a **feature and quality benchmark only**. Never copy its source, comments, strings,
  schema names or assets; never use its name, wordmark or logo anywhere in this repository or on
  any public surface. Our copy — including every Polish translation — is authored from our own
  English.
- **Installability is planned, not shipped.** `vite-plugin-pwa` is a declared dependency and
  nothing else: there is no manifest, no registered service worker and no plugin in
  `vite.config.ts`. Until that wiring lands, no surface may describe the product as installable
  or offline-capable, and the design must not assume a standalone display mode.
- **Design language and visual contract** live in `DESIGN.md` and `docs/SPEC.md` §4. This file
  does not restate them and future work must not contradict them.
- **Commit and copy language is English**; the product's source locale is `en`.

## Capabilities and Constraints

**In scope for v1**, as the plan set in `docs/plans/` decomposes it:

| Area              | What ships                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Accounts          | Eight categories, groups, ordering, archive, credit limit, `exclude_from_stats`, balance adjustment as a real row      |
| Transactions      | Income / expense, splits, tags, notes, payment method, attachments, planned rows, templates, bulk edit                 |
| Transfers         | Two-leg internal transfers, one-leg external in/out, unlink-first nature changes, pair suggestions                     |
| Refunds           | Full, partial, split-level, and refunds of something that was never recorded                                           |
| Classification    | Two-level categories, tags with reminders, payees with aliases and enforced or hinted categorisation                   |
| Budgets           | Manual and category budgets, periods, thresholds, alerts, and **rollover** (`none / surplus / all`)                    |
| Recurring         | Subscriptions, bills, instalments and income; frequencies, anchors, auto-record, reminders, detection from history     |
| Goals             | Savings goals with contributions, progress and a projected completion date                                             |
| Rules             | Conditions and actions, ordering, live preview with a match count, self-pausing on a missing reference                 |
| Multi-currency    | Per-workspace currency set, one base, per-day catalogue rates and workspace rate ranges                                |
| Balance history   | Daily sparse snapshots, whole-history rebuild, nightly self-healing sweep                                              |
| Analytics         | Cash flow, net worth, spending by category, a configurable pivot report, annual overview                               |
| Dashboard         | Nine widgets on a saved grid with a period selector, editable by drag **and** by keyboard                              |
| Import            | CSV with saved column mappings, OFX, QIF, and migrations from two other trackers; preview, duplicate detection, revert |
| Export and backup | JSON and CSV by group and date range, R2 artefacts with expiry, full backup and restore                                |
| SaaS layer        | Auth, workspaces and members, notifications, billing, settings, a platform console                                     |

**Planned, and landing after v1's last wave:**

| Area  | What ships                                                                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loans | Terms, an integer amortisation schedule, principal/interest per instalment, settlement against real transactions, extra repayments and a payoff projection |

Loan management was moved out of _Out of scope_ on 2026-09-05 at the product owner's request. It is
decomposed as `docs/plans/28-loans.md`, its stages open at wave 7, and no v1 surface waits on it —
so it is listed apart from the table above rather than inside it, because "in scope for v1" is a
claim about a release and this is not in that release.

**Out of scope, deliberately:**

- **Bank connectors, screen-scraping and aggregators — permanently.** Not "later", not "if a
  customer asks". `docs/adr/0008-no-bank-connectors.md` is the record.
- **Investment position tracking** (lots, cost basis, dividends). An `investment` account holds a
  balance; it does not hold a portfolio.
- **Vehicle-cost flows and depreciating assets with a value curve.** A car is an `other` account
  with a balance a person adjusts; there is no vehicle account category and no modelled value curve
  (`docs/plans/99-boundaries-and-blockers.md` BND-11).
- **Tax reporting, invoicing, and anything that could be read as regulated financial advice.**
- **Realtime multi-user editing.** Household members see each other's rows on reload, not live.

## Undecided / not yet product truth

These are open and **must not be presented as settled** in copy, in a plan, or in code:

1. **Per-plan pricing.** The amounts in `src/lib/plans.ts` are the product owner's first answer,
   not a market-tested one. Changing them is a one-file edit plus four Polar products; changing
   _which metric separates the tiers_ is the expensive change, and that is settled below.
2. **Whether the household tier's six seats is the right number.** The ceiling is one entry in the
   catalogue and is enforced from it, so the cost of moving it is a number and a migration of
   nobody's data.
3. **Per-account sharing inside a household** (`transactionsWriteScope: all | own`). The current
   plan is workspace-level membership only, with per-account scoping deferred; that deferral is
   also the main justification for the Household tier and needs confirming.
4. **Whether Workers AI ships in v1** for import column-mapping assistance. If it does not, the
   binding is removed rather than left declared.
5. **Rollover semantics for an overspent envelope.** The schema supports `none / carry_surplus /
carry_all`; what the budget detail screen does with an overspend is a product answer, not a
   schema one.
6. **A public read-only demo workspace.** A strong acquisition lever and a real security surface.
   Not in any plan; if it ships it becomes plan 28.
7. **Zero-decimal currency support in v1** (JPY, KRW, HUF-style). In scope arithmetically; whether
   the UI ships them in v1 changes the size of plan 03.

## Brand Commitments

- **We never ask for banking credentials.** This is the product's loudest promise and every
  surface may say it plainly.
- **Your data leaves whenever you want it to.** Full JSON and CSV export on every plan including
  free, with no upsell in the path.
- **Deleting means deleting.** The danger zone does what it says, on a stated schedule.
- **The number on the screen is the number in the database.** No rounded-for-display arithmetic,
  no recomputed history, no silent balance overwrite.

## Evidence on Hand

- **Real:** the product itself — actual screens, the seeded demo workspace, the Playwright suites
  under `e2e/`, and the axe results the verification protocol requires every stage to produce.
- **Real, and citable as of this change:** the plan, quota and entitlement catalogue.
  `src/lib/plans.ts` holds the three tiers, their ceilings and their prices; `resolveLimits()`
  reads real subscription rows and `assertWithinLimit()` enforces the published numbers inside the
  repositories. A surface may state a limit or a price **only** by rendering the catalogue — a
  figure retyped into copy is the one thing that can still drift, and drifted pricing is a refund.
- **Not yet real, and so not citable as proof:** the four Polar products themselves. The ids are
  build-time values; a deployment without them renders the pricing honestly and refuses to open a
  checkout rather than half-working.
- **Does not exist and must never be fabricated:** users, testimonials, quotes, customer logos,
  press mentions, ratings, awards, adoption or usage numbers, uptime or performance claims,
  security certifications (we hold none — no SOC 2, no ISO 27001), case studies, named partners,
  and "trusted by" strips. No such element may appear on any public surface, in any locale, in
  any placeholder, in any screenshot.
- **Also must never be fabricated, and specific to this product:** a WCAG conformance claim
  broader than `docs/ACCESSIBILITY.md` states, any implication that data is bank-sourced or
  reconciled against a bank, and any figure presented as an average or typical customer outcome.
- Any future testimonial, logo or certification requires the user to supply the exact wording and
  the permission first.

## Product Principles

1. **The arithmetic is the product.** A beautiful screen showing a wrong number has failed
   completely. When a design and an invariant disagree, the invariant wins.
2. **Entry speed decides retention.** Every feature is measured against the ten-second phone
   transaction. A feature that adds a step to that path pays for itself or it does not ship.
3. **Nothing is silently corrected.** A balance adjustment is a real transaction with a date, an
   amount and an author. A rule that stops matching says so. An import that skips a row names it.
4. **Colour is never the only channel.** Every chart series, every status, every income/expense
   distinction carries a second encoding — a label, a shape, a pattern or a sign.
5. **Not seeing is indistinguishable from not existing.** Tenancy is enforced at the data boundary
   and never leaks through the UI, an error message, a count or a response time.
6. **Manual is a promise, not a compromise.** Every "we could just connect to the bank" shortcut
   is rejected on principle, and the alternative is built properly instead.

## Accessibility & Inclusion

- **WCAG 2.2 AA across the product, as a hard CI gate.** `@axe-core/playwright` runs on every
  route in the visual spec and a `serious` or `critical` violation fails the build.
- **Named AAA criteria held to AAA:** 2.5.5 Target Size (Enhanced, 44×44 CSS px), 2.4.11 and 2.4.12
  Focus Not Obscured, 1.4.8 Visual Presentation, 2.2.6 Timeouts, 3.3.9 Accessible Authentication
  (Enhanced). The palette is designed for a 7:1 contrast floor on body and UI text.
- **We do not claim blanket AAA conformance** and no public surface may imply it. Several AAA
  criteria are unachievable or product-hostile here, and a broader claim than we can evidence
  would be a false accessibility statement. `docs/ACCESSIBILITY.md` names every AAA criterion,
  claimed or excluded, with its reason.
- Keyboard navigable end to end; every interactive element ships hover, focus-visible, active,
  disabled and loading states. Every drag-and-drop surface also ships a non-drag control.
- `prefers-reduced-motion: reduce` is honoured by every animation without exception.
- Two locales, English and Polish, each named in its own language.
- Responsive 360px → 2560px as designed layouts, not squeezed ones.
- Zero console errors or warnings; zero layout shift after paint.
