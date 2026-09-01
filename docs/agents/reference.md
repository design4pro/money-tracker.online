# The reference surface, and the clean-room rule

The blind A/B pixel loop (`.sandcastle/pixel-capture-prompt.md` → `.sandcastle/pixel-critic-prompt.md`)
photographs one of our screens beside a comparable screen of a public demo, hands both to a critic
who does not know which is which, and files the verdict as an advisory comment. This file is the map
it navigates by, and the rule it works under.

---

## THE CLEAN-ROOM RULE

**Compare rendered pixels. Nothing else crosses.**

This is not a style preference and it is not negotiable. Every stage of the loop, and every human
who runs it by hand, is bound by all seven clauses:

1. **Pixels only.** Point a browser at a public URL and photograph what it paints. That is the
   entire permitted interaction.
2. **Never read the reference's DOM.** No `page.content()`, no `view-source:`, no devtools element
   inspection, no accessibility-tree dump, no `document.querySelector` against their origin.
3. **Never read its network traffic.** No API responses, no JSON payloads, no request logs, no
   `har` capture.
4. **Never copy a string.** Not a label, not a heading, not a tooltip, not an error message, not a
   marketing sentence. If our copy needs writing, it gets written — in `src/lib/i18n/messages/`, in
   English and Polish, by us.
5. **Never copy a name.** Not a table name, not a column name, not an enum value, not a URL shape,
   not a route path, not a query parameter, not a feature's internal identifier. Our domain
   vocabulary is `CONTEXT.md` and it is ours.
6. **Never copy a number.** Not a price, not a limit, not a quota, not a plan boundary.
7. **Never name the reference product.** Not in a filename, not in a commit message, not in an issue
   comment, not in a PR body, not in a code comment, not in `.sandcastle-visual.json`, not in a
   screenshot directory. No artefact this loop writes may contain it. The critic works blind, and a
   product name anywhere in its reading is the end of blindness.

What the loop is allowed to conclude is a statement about _craft_: "the small viewport is a designed
mobile layout on one side and a squeezed desktop on the other", "one side's dark theme has its own
surface separation and the other inverts values", "one side uses tabular numerals in a column of
changing numbers and the other does not". Those are observations about our own work with a second
opinion attached. Anything that reads as "they have X, we should have X" is out of scope for this
loop and belongs in a product decision made by a person.

**If the demo is unavailable, changed, or asks you to sign in — stop.** Report it as
`skippedReason` and let the pipeline continue. This stage is advisory by construction: it never
blocks a merge, so there is never a reason to push past a wall to make it run.

---

## The reference

`https://demo.moneymatter.app` — a public, read-only demo with sample data, reset hourly.

Treat it as a shop window. Do not sign up, do not sign in, do not create data, do not submit a form,
do not press anything that would mutate what the next visitor sees. `capture.mjs` is pointed at it
without `--auth` and without `--state` for exactly this reason: those flags encode _our_ app's
seams, and using them against somebody else's product means interacting with it.

---

## The surface map

The pairing is by **what the screen is**, not by what it is called. Our route is fixed; the
reference path is whatever its own visible navigation leads to for that surface, recorded here the
first time a capture round confirms it so the next round does not re-derive it.

`(confirm)` means nobody has recorded a path yet — navigate the demo's own top-level navigation,
confirm the surface matches the description, and edit this file in the same PR as the capture.

| Our route                      | The surface                                                | Reference path |
| ------------------------------ | ---------------------------------------------------------- | -------------- |
| `/` (marketing)                | Landing page: hero, feature grid, pricing teaser, footer   | `/`            |
| `/pricing`                     | Plan cards with a monthly/yearly toggle and a quota table  | `(confirm)`    |
| `/login`                       | Sign-in form — capture WITHOUT `--auth`                    | `(confirm)`    |
| `/dashboard`                   | Widget grid: balance summary, trend chart, recent activity | `(confirm)`    |
| `/accounts`                    | Account list grouped by kind, with totals                  | `(confirm)`    |
| `/accounts/$accountId`         | One account: balance header, tabbed transaction list       | `(confirm)`    |
| `/transactions`                | Dense transaction table with a filter bar                  | `(confirm)`    |
| `/transactions/new`            | Amount-first entry form                                    | `(confirm)`    |
| `/transactions/$transactionId` | Transaction detail: splits, tags, attachments              | `(confirm)`    |
| `/budgets`                     | Budget cards with utilisation bars                         | `(confirm)`    |
| `/budgets/$budgetId`           | One budget: category breakdown and timeline                | `(confirm)`    |
| `/recurring`                   | Recurring series with a next-due calendar                  | `(confirm)`    |
| `/goals`                       | Savings goals with progress and a projected date           | `(confirm)`    |
| `/analytics/cash-flow`         | Income vs expense over a period                            | `(confirm)`    |
| `/analytics/net-worth`         | Net-worth history line                                     | `(confirm)`    |
| `/analytics/spending`          | Category donut with drill-down                             | `(confirm)`    |
| `/settings/categories`         | Editable two-level category tree                           | `(confirm)`    |
| `/settings/data/import`        | Import mapping step of a file import                       | `(confirm)`    |
| `/settings/billing`            | Current plan, usage, invoices                              | `(confirm)`    |

**No equivalent surface is a valid answer.** These have no counterpart worth pairing, and a capture
agent that improvises one produces a comparison of two unrelated screens, which is worse than no
comparison:

- `/transactions/rules` and `/transactions/suggestions` — automation surfaces
- `/settings/currencies` and everything multi-currency
- `/console/*` — the platform console
- `/settings/members` — shared workspace
- `/legal/*`

For those, set `captured: false` with a `skippedReason` naming the screen.

---

## What we are looking for

The critic prompt carries the full list. The short version, and the reason each matters for a
product made almost entirely of numbers:

- **Typography.** Tabular numerals wherever a number can change — a column that reflows as values
  update is the single most legible tell of a spreadsheet dressed as an app. Type-scale discipline
  over arbitrary sizes.
- **Spacing.** An honest 4px rhythm. Dense tables are where eyeballed padding shows first.
- **Colour.** Restraint, and a semantic reservation: income, expense and transfer hues mean
  something and are never decorative. Every text/background pair carries its contrast.
- **State completeness.** Designed empty, loading and error states — a finance app is full of
  screens a new user sees with nothing in them.
- **Responsive.** A designed small-viewport layout, not a desktop squeezed until it fits. Transaction
  entry is the mobile use case.
- **Dark parity.** A designed dark theme with its own surface separation, not a light theme with
  inverted values.

---

## Running one round by hand

```bash
bash .sandcastle/setup-e2e.sh --if-needed
mkdir -p .sandcastle-shots/manual

node scripts/visual/capture.mjs \
  --url http://localhost:3010/dashboard \
  --out .sandcastle-shots/manual --label A \
  --viewports 1440x900,360x800 --themes light,dark --auth

node scripts/visual/capture.mjs \
  --url https://demo.moneymatter.app/<path> \
  --out .sandcastle-shots/manual --label B \
  --viewports 1440x900,360x800 --themes light,dark
```

`.sandcastle-shots/` is gitignored. A pair exists only when both sides produced a frame for the same
viewport and theme; a lone frame is not evidence and must not be handed to a critic as one.
