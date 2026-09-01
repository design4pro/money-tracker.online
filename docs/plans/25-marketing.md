# 25 — Marketing

## Area brief

The public, unauthenticated surface: home, features, pricing, about, contact, changelog, and the legal
documents. Everything here is rendered by the same Worker as the app — no separate site, no separate
deploy, no CMS.

Two commitments shape every word on these pages:

1. **No blanket accessibility claim.** The product targets WCAG 2.2 **AA** as its hard CI gate and
   holds a **named list** of AAA criteria (2.5.5, 2.4.11, 2.4.12, 1.4.8, 2.2.6, 3.3.9) to AAA. The
   marketing copy may say exactly that, with the list, linking to `docs/ACCESSIBILITY.md` and the
   accessibility statement. It may **never** say "WCAG 2.2 AAA compliant"
   (`docs/adr/0009-scoped-wcag-conformance-claim.md`). This is a legal exposure as much as an honesty
   one, and `25-S2` makes it a **test**, not a guideline.
2. **No bank connectors, said plainly.** The absence of bank connections is the first question every
   visitor has, and burying it is a refund six weeks later. The home page and the features page each
   state it in their own voice, positively (manual entry and file import, by design — your credentials
   never leave your bank), with a link to `docs/adr/0008-no-bank-connectors.md`'s reasoning in
   plain language. `99-boundaries-and-blockers.md` BND-01 is the source.

The pricing page is the only page here blocked on a product decision (`OPEN-1`), and `25-S3` is built
so the numbers arrive as data from `plans.ts` rather than as copy edits.

---

## Stage 25-S1 — The public shell and the home page

### Stage id

`25-S1` · Wave 6 · effort **L**.

### Reference rows

`MKT-01 missing → done` — the public layout, header, footer, locale switcher and skip link.
`MKT-02 missing → done` — the home page.
`MKT-03 missing → done` — SEO: metadata, Open Graph, sitemap, robots, structured data.

### Owned paths

- `src/routes/_public/route.tsx` — new
- `src/routes/_public/index.tsx` — new
- `src/routes/_public/-ui/public-header.tsx` — new
- `src/routes/_public/-ui/public-footer.tsx` — new
- `src/routes/_public/-ui/hero.tsx` — new
- `src/routes/_public/-ui/feature-grid.tsx` — new
- `src/routes/sitemap.xml.ts` — new
- `src/routes/robots.txt.ts` — new
- `src/lib/seo.ts` — new
- `e2e/marketing.spec.ts` — new

### Data and migration

None. Every public page is static content plus i18n strings; nothing here reads D1.

### Server (repo, server function, Zod)

- **No repository, no server function, no session read.** The public shell must render for a visitor
  with no cookie, and a session lookup on every marketing page load is both a latency cost and a
  correctness trap (a stale session redirecting a logged-out visitor). The header renders **Sign in**
  and **Get started** unconditionally; the app's own routes handle the rest.
- `seo.ts` builds per-route metadata: title, description, canonical, `hreflang` pairs for `en` and
  `pl`, Open Graph and Twitter tags, and a JSON-LD `SoftwareApplication` block. It is a pure function
  of route and locale, unit-tested.
- `sitemap.xml` enumerates the public routes in both locales with `xhtml:link` alternates;
  `robots.txt` allows the public tree and **disallows `/app`, `/console`, `/api` and `/invite`** —
  not for security (they are protected) but so a crawler does not waste budget on redirects.

### UI (route, components)

- **Route.** `_public` layout wrapping `/`, with the app under `_app` and the console under
  `/console`, three separate shells sharing tokens and primitives only.
- **Components.** `public-header.tsx` (logo, nav, locale switcher, theme toggle, sign-in and
  get-started); `public-footer.tsx` (product, legal, language, and a link to the accessibility
  statement — in the footer of every page, not hidden on one); `hero.tsx`; `feature-grid.tsx`.
- **Home page sections**, in order: the hero with a single primary action; **how it works** in three
  steps (add accounts → record or import → see where the money goes); the **honest constraint**
  section stating no bank connections and why; a features grid linking to the features page; a
  privacy statement (your data is yours, export it any time, linking to `/settings/data`'s
  capability); and a closing action. **No testimonials, no logo wall, no invented metrics** — this
  product has no customers on launch day, and fabricated social proof is both a lie and instantly
  recognisable as one.
- **States.** There is one state, and that is the point: no loading, no skeleton, no client fetch. The
  page is complete in its first response.
- **Tokens.** The public surface uses the same `tokens.css` (`00-S3`) with a marketing-specific
  spacing scale layered on top — not a second palette, since a marketing page whose contrast differs
  from the app's is the first place a contrast regression hides.
- **Accessibility.** A skip link to `#main` as the first focusable element, visible on focus. One
  `<h1>` per page. The locale switcher is a real link set (`/` and `/pl`), so it works without
  JavaScript and is crawlable. The theme toggle degrades to the system preference with no JS. Every
  target 44px (2.5.5 AAA); body text meets **7:1** (1.4.8's contrast portion), with the measured
  values recorded. Hero imagery is decorative and marked so, or it carries a real alternative — never
  a filename as alt text.
- **No JavaScript required.** The public pages must be fully readable and navigable with JS disabled,
  and `marketing.spec.ts` runs one pass with `javaScriptEnabled: false` asserting the home page's
  headings, links and copy are present. It is the cheapest possible proof that the server-render path
  is real.

### Quota

No countable row.

### Tenant isolation test

The inverse assertion: _no public route reads a session, a workspace or any tenant table_, asserted by
an import-graph check that `src/routes/_public/**` imports nothing from `src/server/repos/**` and does
not call `auth.api.getSession`. A marketing page that leaks a workspace name into a cached response
is the failure this prevents.

### Money invariant

_The only amounts on the public surface are plan prices, and they come from one place._ Case in
`money-invariants.test.ts`: _no public component formats an amount except through `plans.ts`'s
declared price fields_, asserted by a source scan for currency symbols and numeric price literals in
`src/routes/_public/**`, which must find none outside the pricing data. A hard-coded "9 PLN" in a hero
that disagrees with checkout is a chargeback.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Unit: `seo.ts` per route and locale; the sitemap's alternates; `robots.txt`'s disallow list.
- `e2e/marketing.spec.ts`: the skip link's focus behaviour; the locale switcher round trip; the
  **JS-disabled pass**; the heading outline; and an assertion that no request to `/api/**` occurs on
  a public page load.
- Browser evidence: `/` and `/pl` in both themes at **360 / 1280 / 2560 px**, plus the **focused skip
  link**, the **header at 360px** (the nav's mobile disclosure open), and the **footer**.
- Lighthouse on `/`: performance and SEO recorded in the PR; a **regression** in either is a blocker,
  an absolute score is not.
- axe on `/` and `/pl` in both themes: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 25-S2 — Features, about, contact, changelog and the accessibility statement

### Stage id

`25-S2` · Wave 6 · effort **M**.

### Reference rows

`MKT-04 missing → done` — `/features` with the honest capability list.
`MKT-05 missing → done` — `/about` and `/contact`.
`MKT-06 missing → done` — `/changelog` sourced from a repository file.
`MKT-07 missing → done` — `/accessibility`, the conformance statement.

### Owned paths

- `src/routes/_public/features.tsx` — new
- `src/routes/_public/about.tsx` — new
- `src/routes/_public/contact.tsx` — new
- `src/routes/_public/changelog.tsx` — new
- `src/routes/_public/accessibility.tsx` — new
- `src/content/changelog.ts` — new
- `src/content/__tests__/claims.test.ts` — new

### Data and migration

None. The changelog is a typed array in `src/content/changelog.ts` — version, date, and grouped
entries. A file in the repository, reviewed like code, is the right store for a document that changes
when the code changes; a database-backed changelog needs an editor nobody will build.

### Server (repo, server function, Zod)

- **Contact is a `mailto:` link plus the address in text**, not a form. A form needs spam protection,
  a delivery path, a storage decision and a privacy disclosure — four problems bought to avoid one
  click. If volume ever justifies a form, it is a later stage, and this refusal is recorded rather
  than left as an omission.
- No other server code.

### UI (route, components)

- **`/features`** groups capabilities as they actually are: accounts and balances; transactions,
  splits and transfers; categories, tags and payees; budgets with rollover; recurring; rules; goals;
  reports; import and export; multi-currency; accessibility. Each group states what it does and, where
  relevant, **what it does not**: no bank connections, no investment price feeds, no tax advice, CSV
  import only (BND-01, BND-03, BND-04, BND-12, BND-30). The negatives sit inside the groups, not in a
  buried FAQ.
- **`/accessibility`** is the conformance statement and the most carefully worded page on the site. It
  states: the target is **WCAG 2.2 level AA across the product**, verified by automated axe checks on
  every route in CI and by manual keyboard and screen-reader passes; **six named criteria are held to
  AAA** — 2.5.5 target size, 2.4.11 and 2.4.12 focus not obscured, 1.4.8 visual presentation, 2.2.6
  timeouts, 3.3.9 accessible authentication; the **known limitations** (colour-differentiable chart
  series beyond eight, third-party checkout pages outside our control); the **feedback route** and a
  response commitment; and the date of the last review. It links to `docs/ACCESSIBILITY.md`.
- **States.** Static.
- **Accessibility.** `/changelog` is a list of `<section>`s with dated headings, in reverse
  chronological order, with each version's `<h2>` containing the version and the date as text. The
  features page's negatives are in the same visual weight as the positives, not in smaller grey type —
  a disclosure a person cannot read is not a disclosure.

### Quota

No countable row.

### Tenant isolation test

Covered by `25-S1`'s import-graph assertion, extended to these routes.

### Money invariant

_No amount appears on any of these pages._ Case in `claims.test.ts`: _a scan of these five routes
finds no currency symbol, no ISO currency code and no numeric price_, so pricing exists in exactly one
place. A feature page quoting a price is a page that will be wrong.

### Verification

- Command gate.
- **`claims.test.ts` is the stage's central artefact.** It scans every string in `src/routes/_public/**`
  and both locale bundles for:
  - the forbidden phrases **"WCAG 2.2 AAA"**, **"AAA compliant"**, **"fully accessible"** and
    **"WCAG compliant"** (unqualified) — any match fails the build;
  - the phrases **"bank connection"**, **"connect your bank"**, **"sync with your bank"** and their
    Polish equivalents — any match fails, since the product cannot do it;
  - **"tax advice"**, **"financial advice"**, **"investment advice"** and their Polish equivalents —
    any match fails (BND-04);
  - and the **required presence** of the no-bank-connection statement on `/` and `/features`, and of
    all six named AAA criteria on `/accessibility`.
    The forbidden and required lists live in one exported constant so adding a claim is a reviewed
    change. This is what turns a locked decision into an enforced one, and it is the reason a copy edit
    six months from now cannot quietly reintroduce a legal exposure.
- Unit: the changelog renders every entry in the file, in order.
- Browser evidence: `/features`, `/about`, `/contact`, `/changelog`, `/accessibility` in both themes at
  **360 / 1280 / 2560 px**, in both locales for `/features` and `/accessibility`.
- axe on all five routes: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

None. The accessibility statement's content is fully determined by the locked decision and
`docs/ACCESSIBILITY.md`; the review date is filled at merge.

---

## Stage 25-S3 — Pricing and the legal documents

### Stage id

`25-S3` · Wave 6 · effort **M**.

### Reference rows

`MKT-08 missing → done` — `/pricing`, driven by `plans.ts`.
`MKT-09 missing → done` — `/legal/terms`, `/legal/privacy`, `/legal/cookies`, `/legal/dpa`.

### Owned paths

- `src/routes/_public/pricing.tsx` — new
- `src/routes/_public/-ui/pricing-table.tsx` — new
- `src/routes/_public/legal/terms.tsx` — new
- `src/routes/_public/legal/privacy.tsx` — new
- `src/routes/_public/legal/cookies.tsx` — new
- `src/routes/_public/legal/dpa.tsx` — new
- `src/content/legal-meta.ts` — new

### Data and migration

None. `legal-meta.ts` holds each document's `version`, `effectiveFrom` and `lastReviewed`, rendered at
the top of each document. A legal document without a version and a date is unciteable in a dispute.

### Server (repo, server function, Zod)

- **The pricing table is generated from `plans.ts`** (`00-S15`) — the same module `resolveLimits`
  reads. Prices, limit values and feature flags come from that one file, so the pricing page and the
  enforced quota **cannot** disagree. This is the structural answer to the most expensive class of
  bug in a subscription product: an advertised limit that the code does not grant.
- `pricing-table.tsx` renders every plan's every limit key, including the ones where the free tier
  wins nothing — a comparison table with the unflattering rows removed is a table nobody trusts.
- **Get started** links to sign-up with the plan preselected as a search param; the actual checkout is
  `22-S3`'s, behind authentication. No price is charged from a public page.

### UI (route, components)

- **Route.** `/pricing` and the four legal routes.
- **Components.** `pricing-table.tsx` — a real `<table>` with plans as columns and limits as rows,
  with row headers, so a screen reader announces "Accounts, Free, 5". At 360px it becomes **one card
  per plan with the full row list repeated**, not a horizontally scrolled table with a frozen column,
  because the latter is unusable with a screen reader and awkward with a keyboard.
- **Legal documents** share a `legal-document` layout: the version and effective date at the top, a
  table of contents built from the headings, numbered sections, and a **plain-language summary box**
  at the head of the privacy policy stating what is collected and what is not. The summary is
  explicitly marked as a summary that does not replace the text.
- **The cookie page is short and true**: this product sets one session cookie (`mtr` prefix, `04-S1`),
  a theme preference, and a locale preference, and **runs no third-party analytics or advertising
  tags**. Because there are no non-essential cookies, there is **no consent banner** — a banner
  asking permission for cookies we do not set trains people to click through banners that matter.
- **Accessibility.** Every legal heading is linkable with a visible-on-focus anchor. The table of
  contents is a nav landmark. Body text meets 1.4.8's measures: a maximum line length of 80
  characters, no justification, and a line height of at least 1.5 — these are long documents and it is
  where that criterion actually earns its keep.

### Quota

No countable row.

### Tenant isolation test

Covered by `25-S1`'s import-graph assertion, extended to these routes.

### Money invariant

_Every price on `/pricing` is the price the checkout charges._ Cases in `money-invariants.test.ts`:

- _every displayed price is read from `plans.ts` and formatted with the **billing** currency's
  digits_, matching `22-S3` exactly, asserted against a `PLN` and a `JPY` fixture.
- _no price is hard-coded in `pricing.tsx` or the locale bundles_, asserted by the `claims.test.ts`
  scan extended to this route with the pricing data as the sole exception.
- _every limit value shown equals `resolveLimits`'s output for that plan key_, asserted by iterating
  the catalogue and comparing the rendered table cell to the resolver's number — the test that makes
  the "cannot disagree" claim true rather than merely intended.
- _a plan with an unlimited value renders as the word for unlimited in each locale_, never as
  `Infinity`, `-1` or `null`.

### Verification

- Command gate.
- Unit: the pricing table's structure for two and for four plans; the unlimited rendering; the 360px
  card layout containing every row the table does.
- `e2e/marketing.spec.ts` extended: the pricing table's row and column header association read from
  the accessibility tree; the get-started link carrying the plan param through sign-up;
  `/legal/privacy`'s table of contents jumping and returning focus correctly.
- Browser evidence: `/pricing` in both themes at **360 / 1280 / 2560 px** (the 360px capture must show
  the card layout), plus each legal page at 1280px in both themes and `/legal/privacy` at 360px.
- axe on `/pricing` and all four legal routes: zero `serious`, zero `critical`.
- Console silent.

### Definition of done

All six §7 items and all ten §2 clauses.

### Blockers

`OPEN-1` — the plan names, prices and included limits. The page is complete and data-driven; the
numbers land in `plans.ts` and the page follows with no code change.

`OPEN-8` — **the launch blocker.** The DPA and the sub-processor list cannot be written until the
processors are fixed: the transactional email provider (plan 21), Sentry and its scrubber policy
(plan 05), Polar as the payment processor (plan 22), and Cloudflare's own regions for D1, R2 and KV.
`/legal/dpa` ships with the document structure and the sub-processor **table** in place, populated
from a constant; until `OPEN-8` resolves, the route is **excluded from the sitemap and returns 404**
rather than publishing an incomplete legal document — a half-written DPA is worse than a missing one.
The 404 is removed by a one-line change when the constant is filled, and `claims.test.ts` asserts the
route is either fully populated or absent, never partial.
