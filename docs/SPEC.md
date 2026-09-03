# money-tracker.online — Master Build Spec

The master specification. **Its numbered sections are addresses**: `CLAUDE.md`, every plan stage,
every ADR and every pull-request template cite `docs/SPEC.md §N` rather than restating it. When this
document and another disagree, this document wins — except on arithmetic, where `docs/MONEY.md`
wins, and on accessibility conformance, where `docs/ACCESSIBILITY.md` wins. Both exceptions are
named in §5 and §10 respectively.

---

## 1. What we are building

A multi-tenant SaaS personal finance manager, hosted on Cloudflare Workers, serving one workspace
(personal or household) per tenant: accounts and balances, transactions with splits, transfers and
refunds, categories, tags and payees, budgets with rollover, recurring series, savings goals,
automation rules, multi-currency reporting, file import and export, and accessible analytics — with
the SaaS layer around it (authentication, workspaces, notifications, subscription billing, a
platform console).

**Manual entry and file import only. No bank connectors, ever.** This is a product position, not a
staging of work. `docs/adr/0008-no-bank-connectors.md` is the record and it is not reopened by a
feature request.

### 1.1 The clean-room rule

Two products are studied as **feature and quality benchmarks**: an open-source budget tracker and a
commercial competitor's public demo. Collectively they are "the reference product". The rule binds
code, documents, plans, commit messages and copy equally:

1. The reference product's **name, wordmark and logo appear nowhere** in this repository or on any
   public surface — not in prose, not in a heading, not in a filename, not in a URL, not in a test
   fixture. (`docs/agents/reference.md` names a demo URL for the pixel-comparison loop and nothing
   else; it is deleted entirely if that loop is retired.)
2. **No sentence, table name, column name, enum value, class name, identifier or UI string is
   reproduced from it**, nor paraphrased with the same words. If we need to name a thing, we name it
   in our own vocabulary — `CONTEXT.md` is that vocabulary.
3. We describe **behaviour and outcome**, never an implementation to be transcribed. "A refund
   reduces the effective spend of the transaction it points at" is a behavioural statement. A field
   list read off someone else's schema is not.
4. Reading it to learn _what_ a feature does is sanctioned. Carrying its text into this repository is
   not. One of the reference products is AGPL-3.0 with an asserted trademark.
5. The pixel-comparison loop compares **rendered pixels only**. It never reads the reference's DOM,
   never copies a string, and never names the product in any artefact it writes.

### 1.2 What this product is not

Not an investment portfolio tracker (an `investment` account holds a balance, not lots and cost
basis). Not a tax or invoicing product. Not financial advice. Not a realtime collaborative editor —
household members see each other's rows on reload.

---

## 2. Quality bar

Every surface, every stage, without amendment. A stage that ships nine of these has not shipped.

1. **Spacing on the 4px grid**, from `--space-*` tokens. No eyeballed one-off margins.
2. **Every interactive element** has hover, focus-visible, active, disabled and loading states, and
   a **44×44 CSS px hit area**.
3. **Every list and async surface** has a designed empty state, a skeleton, and an error state with
   a recovery affordance. "Has an empty state" is not a plan; the copy and the illustration are named.
4. **Motion** is 150–260ms, transform and opacity only, on a token easing, and
   `prefers-reduced-motion: reduce` is honoured without exception.
5. **Light and dark parity**, with dark shadows and dark semantic hues **re-declared**, never reused
   or derived.
6. **Responsive 360px → 2560px** as designed layouts, not a squeezed desktop.
7. **Keyboard navigable end to end**, sensible focus order, accessible names on everything, and a
   non-drag path beside every drag-and-drop affordance.
8. **Every number that can change is `tabular-nums`** and every amount column is end-aligned.
9. **Every chart** ships a visually-hidden data table, keyboard-reachable points, and a non-colour
   encoding.
10. **Zero console errors or warnings, zero layout shift after paint**, and a clean
    `@axe-core/playwright` run — no `serious`, no `critical`, every `moderate` waiver named.

The visual reference for the benchmark comparison is captured by the advisory pixel loop described
in `docs/agents/reference.md`; it never blocks a merge, and the ten clauses above do.

---

## 3. Stack (pinned — do not change, do not add deps)

Package manager **pnpm 10.15.0**, Node **24.x**, ESM, `#/*` → `./src/*` subpath imports.

Runtime: **TanStack Start** (React 19) on **Cloudflare Workers** via `@cloudflare/vite-plugin` ·
**Drizzle** on **D1** · **KV** (two namespaces) · **R2** · **Queues** · one **Durable Object**
(`AccountLedger`) · **Tailwind 4** · **React Aria Components** with `class-variance-authority` in
the shadcn shape · **`@internationalized/date`** and **`@internationalized/number`** ·
`@tanstack/react-table`, `@tanstack/react-virtual`, `@tanstack/react-form`, `@tanstack/react-query` ·
`d3-scale` / `d3-shape` / `d3-time` · `papaparse` · **Better Auth** with KV secondary storage ·
**Polar** through a hand-rolled REST client · `zod` v4 · Sentry · React Email · `motion` · `sonner` ·
`@dnd-kit/*` · `nanoid` · `date-fns` (formatting only).

Tooling: Vite 8 · Wrangler 4 · TypeScript 6 · Vitest 4 · Playwright · **`@axe-core/playwright`** ·
`drizzle-kit` · ESLint 9 · Prettier · Husky + lint-staged · `@ai-hero/sandcastle` ·
`vite-plugin-pwa`.

Not used, deliberately: **Radix** (React Aria instead — ADR 0005), **any chart library** (ADR 0007),
`xlsx`, `maplibre-gl`, any bank-aggregation SDK.

### 3.1 The dependency freeze

**`package.json` and `pnpm-lock.yaml` are not edited by any stage, and no stage installs a package.**
A feature that cannot be built without a package outside the pinned set is recorded under that
stage's `### Blockers` heading with a disposition — **defer**, **substitute** (a named platform
capability that covers it), **hand-roll** (scope and risk stated), or **drop** (the row moves to
`docs/plans/99-boundaries-and-blockers.md`). It is never planned as though the package were present.

Every dependency is pinned with a caret over a **resolved** version. `latest` is forbidden: an agent
run that installs a different minor than the one the verification ladder was green on produces a
whole class of failures nobody can explain.

`pnpm-lock.yaml` is installed `--frozen-lockfile` in CI and in the agent sandbox.

---

## 4. Design language

Owned by `DESIGN.md`; this section states only what other sections must not contradict.

Cool paper, near-black ink, one deep teal brand, tabular figures everywhere. The palette is designed
to a **7:1 contrast floor on text** in both themes, with two named exceptions (disabled control text;
non-text chart gridlines at 3:1). Four reserved amount hues (`income`, `expense`, `transfer`,
`planned`) that may never be used decoratively. An eight-hue categorical series palette that is
**never the sole channel of information**, for a measured reason: two series can both clear 7:1
against the surface while measuring 1.00:1 against each other.

Tokens live in `src/styles/tokens.css`, declared in all three places — bare `:root`, the
`prefers-color-scheme: dark` media block guarded as `:root:not([data-theme="light"])`, and
`:root[data-theme="dark"]` — so both the system default and the explicit toggle resolve correctly.

---

## 5. Architecture

Owned by `docs/ARCHITECTURE.md`. The load-bearing contracts, stated here because plans cite them:

### 5.1 Request path

One Worker (`src/server/worker.ts`) serves the marketing site, the SSR application, every server
function, the Better Auth mount, the Polar webhook, the file and export routes, the queue consumer
and four cron handlers. The Worker entry is a **custom module**, not the framework's default server
entry, because only the entry module's exports let the runtime find the Durable Object class, the
queue consumer and the scheduled handler.

The environment is chosen at **build** time (`CLOUDFLARE_ENV`), never at deploy time.

### 5.2 Multi-tenancy

Every product table carries `organization_id`, and it is the **leading column of every composite
index**. All SQL lives in `src/server/repos` and goes through the tenant-scoped base repository,
which appends the tenant predicate from a `TenantScope`. Callers may add predicates; they cannot
remove that one. Forgetting the tenant filter is not expressible.

`src/server/catalog` is the **single stated exception** — global tables with no `organization_id`
(currencies, exchange rates, brand logos) — guarded instead by `requirePermission` plus a
`platform_audit_log` write.

`assertScopedWrite` throws when a write composes to an empty predicate list. Transaction reads and
writes additionally require **explicit policies** — planned, balance-adjustment, transfer and
completeness — so that "which rows does this query mean" is always answered, never defaulted.

Rationale: `docs/adr/0002-tenant-scoped-repository-boundary.md`.

### 5.3 Platform roles and workspace roles are two dictionaries

Workspace roles are `owner | admin | member`, read from the membership row and never trusted from a
session claim. Platform roles are `admin | curator | user`, read from the user row. The two are
never mixed, never compared, and never resolved by one helper.

### 5.4 Billing surface

`src/lib/plans.ts` is an isomorphic catalogue with no bindings. `resolveLimits()` is the single
authority: does the row entitle at all → which plan → catalogue limits → **row ceilings win** (so
grandfathering is possible). `assertWithinLimit()` is the only enforcement point and it is called
**inside the repository, before the write**. The published number is the enforced number, and a test
fails when a catalogue metric has no resolver entry.

### 5.5 The money and FX contract

**Owned by `docs/MONEY.md`, which wins over this document on any point of arithmetic.** In one
paragraph: integer minor units scaled by `currencies.digits`; direction is a column and amounts are
non-negative; rates are integers scaled by 10^10; `ref_amount_minor` is historical and never
recomputed; balance history is rebuilt, never accumulated, and always through the `LEDGER` Durable
Object; `booked_on` is a calendar date the person chose and the snapshot grid is UTC-keyed; rounding
is half-to-even and happens once.

### 5.6 Scaling posture

One D1 database for all tenants, with a documented ceiling. The sparse-snapshot rule (`docs/MONEY.md`
§5.2 rung 5) is the main lever that keeps a 15-year workspace small. There is a size alarm and no
sharding in v1; the trade is recorded rather than assumed.

### 5.7 Bindings

`DB` (D1) · `KV` and `SESSIONS` (KV) · `FILES` (R2) · `LEDGER` (Durable Object) · `TASKS` (Queue) ·
`AI` (staging first) · `CF_VERSION_METADATA`. `SANDCASTLE_REGISTRY` exists on staging only.
`wrangler.jsonc` is the one file that declares them and it is a shared path owned by
`docs/plans/00-foundations.md`.

---

## 6. Repo conventions

```
src/
  components/
    ui/            React Aria primitives in shadcn shape. Never fetches. Never imports server/.
    <module>/      product components
  lib/             isomorphic: money.ts, plans.ts, i18n/, charts/, format/, cn.ts
  routes/          TanStack Start file router. -lib/, -server/, -ui/ are private dirs, not routes
  server/
    db/            schema.ts (shared path), auth-schema.ts
    repos/         ALL SQL. Tenant-scoped base repository. __tests__/ lives here
    catalog/       the single tenancy carve-out
    fns/           server functions
    ledger/        the balance-history rebuild and the LEDGER DO client
    import/        ofx/, qif/, csv/ parsers
    billing/       limits.ts, polar client, webhook
    notifications/ dispatch.ts
    queue/         one handler module per job kind
    do/            Durable Object classes
    worker.ts      the Worker entry (shared path)
  styles/tokens.css  (shared path)
  routeTree.gen.ts   (generated — never opened in an editor)
drizzle/             (generated — never hand-edited)
e2e/                 <module>.visual.spec.ts, one per module
```

### 6.1 Layering (contract, not style)

- All SQL lives in `src/server/repos` and goes through the tenant-scoped base repository. The tenant
  predicate must not be removable. `src/server/catalog` is the only carve-out.
- Routes call server functions; server functions call repositories. **No SQL anywhere else.**
- **Money never leaves the integer minor-unit representation.** No float arithmetic on an amount, at
  any layer, ever. Formatting is the only place a decimal appears and it goes through
  `src/lib/money.ts` using `currencies.digits`.
- Every amount crossing the base-currency boundary carries its `rate_e10` and its ref amount. A
  report that recomputes a historical conversion is a defect.
- Balance history is rebuilt wholesale, never accumulated, always through the `LEDGER` Durable
  Object. A direct write to `account_balances` outside `src/server/ledger` is a defect.
- `components/ui` never fetches data and never imports from `server/`. A primitive that needs a
  server value takes it as a prop.
- Every server-function input is validated with Zod, and parsed a **second** time in the repository.
  Validation is shape, never permission. A well-formed id from a client is not an authorised id, and
  `beforeLoad` is UX, never a data boundary.
- Anything slow — import, export, email, backup, ledger rebuild, notification fan-out — is enqueued
  on `TASKS`, never run inline.
- Named exports only, route modules excepted.
- **Generated files are never hand-edited**: `src/routeTree.gen.ts` (`pnpm generate-routes`),
  `drizzle/` (`pnpm db:generate`). CI diffs both.
- Migrations are **additive**; the running Worker must survive the migrate-then-deploy window. No
  column is dropped, renamed or narrowed in the same change that stops writing it.

---

## 7. Definition of done for any task

Seven numbered points, inherited unchanged by every stage, every ticket and every pull request:

1. `pnpm build` succeeds.
2. `pnpm lint` and `pnpm typecheck` are clean — no new errors, no suppressions.
3. New logic has tests and `pnpm test` passes. A new repository function has a tenant-isolation
   case; a new money-touching write path has a money-invariant case.
4. The feature is visually verified in a real browser: light and dark, 360px and 1280px at minimum,
   with the interaction state that is the point of the change captured, not just the resting state.
5. No TODOs, no placeholder copy, no `console.log`, no commented-out code left behind.
6. You did not touch files outside your assigned ownership.
7. **Every number you write down was produced by a command, not by an impression.** A count of
   occurrences, call sites, files or failures that appears in a commit message, a docblock, a
   report or a review comment must come from a `grep -c`, a `wc -l` or a test run whose output you
   actually read. This is the cheapest claim in the repository to verify and the easiest to get
   wrong, because a plausible number reads exactly like a measured one and nothing downstream
   re-checks it. If you cannot run the count, do not write the number — write what you did observe.

   A result of **nothing** is the trap inside the trap. A command aimed at a path that does not
   exist answers `0` and exits quietly; a test filter that matches no test reports no failures.
   Both are the exact shape of the answer you were hoping for and neither complains, so nothing you
   ran is a measurement until you have separately confirmed it was aimed at something. This is the
   one case where a correctly executed command produces a false reading with no signal at all —
   even an invented number looks like a number, and this does not look like anything.

   Nor does a total that reconciles vouch for the parts it was built from. A breakdown can be wrong
   in every line and still add up, and that is worse than a wrong sum: a wrong sum invites the
   question, and a right one closes it.

   The same rule binds a sentence that carries a claim. **A statement that grew stronger between
   two messages, without a new measurement, reverts to the version that had one.** "Saving is safe,
   because the patch fires only on a change" was measured. "You cannot save the form without
   changing the colour" was the same belief with the hedge taken out, and it was false. The number
   rule catches an invented count because a count looks like a count; this one has no such tell,
   and the sharpened sentence is shorter, more useful and more quotable than the careful one, which
   is exactly why it travels. Put the hedge back, or measure it again.

On top of those, the ten clauses of §2 are ticked per surface, and §10's accessibility gate must be
green.

---

## 8. Decomposition rule: one concept, one owner

**A concept is owned by exactly one module, and everything else calls it.**

Corollaries:

- One money module. One rounding function. One formatter. One conversion function. A second
  implementation is a defect, not a duplicate.
- One plan catalogue and one resolver. A metric added to the catalogue and not to the resolver is an
  unenforced published promise.
- One dispatch layer for notifications. One redaction middleware. One `newId()`.
- One primitive per interaction pattern in `components/ui`. Check the index before adding a file.
- One tenant predicate, one place it is appended.

**A stage is sized to one agent and one run.** A stage that needs more than one migration, touches
more than one product area, or cannot be finished in one run is two stages.

Real failures this rule prevents, all of which happen without it: two rounding helpers that disagree
in the last minor unit; a quota published on the pricing page and enforced nowhere; a second dialog
primitive whose focus trap behaves differently; a category tree that two modules both believe they
own the depth invariant for.

---

## 9. Localisation

Owned by `docs/I18N.md`. The contract other sections rely on:

- **Two locales: `en` (source) and `pl`.** Both LTR. There is no third locale in v1 and adding one
  is a plan, not a pull request.
- **No user-facing string is hardcoded.** A new key lands in **both** catalogues in the same change,
  and a parity test fails the build otherwise.
- **Polish plurals have four CLDR categories** (`one`, `few`, `many`, `other`). A message with a
  count uses the plural machinery; an `if (n === 1)` in a component is a defect.
- **Numbers, dates and currencies inside messages** are formatted by the message formatter with the
  active locale, not concatenated in as pre-formatted strings.
- **Notification rows and email envelopes store i18n keys and parameters, never sentences**, so a
  person who switches language sees their history in the new one.
- **The document shell** (`lang`, `dir`, `<title>`, meta) is owned by the root route and by nothing
  else.
- **Locale negotiation order:** user preference → workspace setting → `Accept-Language` → `en`.
  Every input is normalised against a frozen table, never trusted.
- Language names come from that frozen table, never from `Intl.DisplayNames`, which resolves in the
  reader's locale and would print "angielski" where the switcher must say "English".

---

## 10. Accessibility conformance

**Owned by `docs/ACCESSIBILITY.md`, which wins over this document and over any copy.**

- **WCAG 2.2 Level AA is claimed product-wide and is a hard CI gate.**
  `@axe-core/playwright` runs on every route in the visual spec; a `serious` or `critical` violation
  fails the build; a `moderate` finding must be named and justified in the stage's Verification block.
- **Five AAA criteria are additionally met and claimed**, and are verified rather than aspired to:
  **2.5.5** Target Size (Enhanced), **2.4.11** and **2.4.12** Focus Not Obscured, **1.4.8** Visual
  Presentation, **2.2.6** Timeouts, **3.3.9** Accessible Authentication (Enhanced).
- The palette is designed to a **7:1 text contrast floor**, which is 1.4.6's threshold, with two
  named exceptions.
- **No blanket AAA claim is made and none may be written**, in the product, in marketing copy, in a
  commit message or in a plan. Several AAA criteria are unachievable or product-hostile here, an
  overstated published statement is a legal exposure under the European Accessibility Act, and a
  scoped claim is more useful to a reader than a broad one. Every excluded AAA criterion is listed in
  `docs/ACCESSIBILITY.md` with its reason.
- Beyond the automated gate, every stage owes the manual checks §2 lists: keyboard end to end, a
  non-drag path beside every drag, a text equivalent for every chart, and reduced-motion honoured.
