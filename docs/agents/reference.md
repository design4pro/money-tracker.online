# The reference surface, and the clean-room rule

The blind A/B pixel loop (`.sandcastle/pixel-capture-prompt.md` → `.sandcastle/pixel-critic-prompt.md`)
photographs one of our screens beside a comparable screen of a public demo, hands both to a critic
who does not know which is which, and files the verdict as an advisory comment. This file is the map
it navigates by, and the rule it works under.

---

## THE CLEAN-ROOM RULE

**Compare rendered pixels. Nothing else crosses.**

This is not a style preference and it is not negotiable. Every stage of the loop, and every human
who runs it by hand, is bound by all eight clauses.

Clauses 1 to 3 are about the **comparison loop**, and they are strict because a comparison that
reached past the pixels would stop being a comparison of craft. Clause 8 is about **everything
else** - it was amended on 2026-09-03 and now permits reading the reference's published source
outside the loop. Clauses 4 to 7 hold everywhere, without exception, and they are the ones that
carry the licence.

1. **Pixels only, inside the loop.** Point a browser at a public URL and photograph what it paints.
   That is the entire permitted interaction for a capture round - see clause 8 for what may be read
   outside one.
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
8. **The reference's source may be read to check what it does. Nothing from it may be
   transcribed.** Amended 2026-09-03 by the product owner, who lifted the previous blanket ban on
   opening the repository: it is a public open-source project, and everything here is rewritten
   onto Cloudflare's platform regardless, so consulting how a behaviour actually works is allowed
   where it was not before.

   What did **not** change is clauses 4, 5 and 6, and they are what keeps this workable: no string,
   no name, no number, no schema, no snippet, in any file, commit, issue or comment. A close
   paraphrase of an implementation is that implementation. Read it, close it, write ours - and if
   the result would be recognisable to somebody holding their file open beside it, it is derived
   whatever route it took. Rewriting for a different runtime is not by itself the distance that
   makes something ours; the same structure expressed in another framework is still the same
   structure.

   Clause 7 is also untouched, so a consultation happens outside the blind loop or not at all - a
   critic that has read their source is no longer blind, and neither is a capture round that names
   them in an artefact.

   When a consultation changes what gets built here, say so in the change that carries it. One
   sentence - "checked against the reference" - is what makes the boundary auditable later, and it
   costs nothing while the reasoning is still in somebody's head.

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

## Why clause 8 exists, and why it outranks the rest

The other seven clauses protect a blind comparison. **Clause 8 protects the product's licence**, and
it applies everywhere - to a capture round, to a feature stage, to an agent, to a person reading on a
train.

The reference is published under the **GNU Affero General Public License v3.0**. AGPL is the
strongest copyleft in common use, and its section 13 is the one that matters here: with AGPL, making
the software available **over a network is enough** to trigger the obligation. Nothing has to be
distributed. If this product contained code derived from that project, every person who opened it in
a browser would be entitled to its Corresponding Source - this repository, the billing integration
and all.

The saving distinction, and the reason the product owner's parity directive is entirely buildable:

- **Functionality is not copyrightable.** That an application has envelope budgets, split
  transactions, a rules engine or a net-worth chart is an idea, and ideas are free to reimplement.
  Building the same capability independently is lawful and is exactly what `parity.md` is for.
- **Expression is.** Source code, copy, schema, and the specific arrangement of a screen are the
  protected part. Those are what clauses 4, 5 and 8 keep out.

So: **match the feature, never the file.** Clause 8's amendment moves where the line sits without
moving what it protects. Reading published source is lawful; what creates exposure is shipping
something derived from it. Which makes the test a question about the artefact, not about the
reading:

- **Nothing is transcribed.** Not a snippet, not a schema, not an identifier, not a close
  paraphrase. The check is the file, not the intent behind it.
- **A port is not a rewrite.** Moving a design from their runtime to Workers, D1 and Durable
  Objects changes the words and keeps the arrangement, and the arrangement is the protected part.
  The distance that makes something ours is a different decision, not a different API.

The residual risk is worth naming rather than reassuring away: a reader who has seen an
implementation cannot unsee it, and "arrived at independently" is a weaker account once a
consultation is on the record. That is the trade the owner made in exchange for being able to check
solutions rather than guess at them - so consult where it settles something, write down that you
did, and keep answering the ordinary questions from our own spec, `docs/MONEY.md`, the framework's
documentation or first principles, which is faster anyway.

This is an engineering rule written from the plain text of the licence, not legal advice. Before
anything ships commercially, a lawyer should confirm it.

---

## The reference

`https://demo.moneymatter.app` **no longer resolves — it returns a 404.** Confirmed 2026-09-02. The
demo now lives behind the marketing site's own demo entry point on the main host, which states
`No signup required` and seeds sample data that resets on a timer. Reaching it costs one click on
that entry point, and nothing else: it asks for no credentials, so clause 1 still holds — we point
a browser at a public URL and photograph what it paints.

Treat it as a shop window. Do not sign up, do not create data, do not submit a form, do not press
anything that would mutate what the next visitor sees. `capture.mjs` is pointed at it without
`--auth` and without `--state` for exactly this reason: those flags encode _our_ app's seams, and
using them against somebody else's product means interacting with it. **`capture.mjs` reaches the
demo with `--enter '<selector>'`** — it navigates to the URL, clicks that one control, waits for the
page to settle and photographs where it lands. One click, and it must be a click that _navigates_,
never one that mutates what the next visitor sees. The selector is not recorded here and never will
be: clause 5 forbids copying a name, and a CSS selector is a name, so whoever runs a round reads the
entry point off the page and supplies it on the command line. `--enter` is refused together with
`--auth`, and a control that never appears times out into a warning with no frame filed, which the
loop reports as a `skippedReason` like any other wall.

A navigation round on 2026-09-03 confirmed the entry point still behaves as described and settled
one question the section left open. The entry control navigates straight to the demo's dashboard -
no form, no credential, no interstitial - and from there every other surface answers at its own URL,
so a round can point a browser directly at a path once the click has happened. It has to happen in
**every** context, though: `capture.mjs` opens a fresh one per invocation and the demo session does
not survive it, so `--enter` is needed on each call and not only on the first. The banner it lands
on states the sample data resets on a timer measured in hours, which is the other reason a round is
worth finishing in one sitting.

---

## The surface map

The pairing is by **what the screen is**, not by what it is called. Our route is fixed; the
reference path is whatever its own visible navigation leads to for that surface, recorded here the
first time a capture round confirms it so the next round does not re-derive it.

Where the two products file a surface differently, **our route is ours and the difference is not
an error to correct**. Import is the clearest case: theirs sits under a data-management branch of
settings, ours is top-level at `/import`. That is a consequence of `docs/adr/0008-no-bank-connectors.md`,
not an imitation of anything - with no connectors, importing a file is not one way data arrives, it
is the way, and the only path into the product does not belong behind two levels of settings. The
pairing still holds, because the pairing is by what the screen is.

`(confirm)` means nobody has recorded a path yet — navigate the demo's own top-level navigation,
confirm the surface matches the description, and edit this file in the same PR as the capture.

| Our route                      | The surface                                                | Reference path                                                |
| ------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------- |
| `/` (marketing)                | Landing page: hero, feature grid, pricing teaser, footer   | `/`                                                           |
| `/pricing`                     | Plan cards with a monthly/yearly toggle and a quota table  | `(confirm)`                                                   |
| `/login`                       | Sign-in form — capture WITHOUT `--auth`                    | `(confirm)`                                                   |
| `/dashboard`                   | Widget grid: balance summary, trend chart, recent activity | `/dashboard`                                                  |
| `/accounts`                    | Account list grouped by kind, with totals                  | `/accounts`                                                   |
| `/accounts/$accountId`         | One account: balance header, tabbed transaction list       | `(confirm)`                                                   |
| `/transactions`                | Dense transaction table with a filter bar                  | `/transactions`                                               |
| `/transactions/new`            | Amount-first entry form                                    | `(confirm)`                                                   |
| `/transactions/$transactionId` | Transaction detail: splits, tags, attachments              | no route — the surface is a modal over `/transactions`        |
| `/transactions/groups`         | Grouped transactions: a set treated as one movement        | `/transaction-groups` - top-level, not under transactions     |
| `/budgets`                     | Budget cards with utilisation bars                         | `/planned/budgets`                                            |
| `/budgets/$budgetId`           | One budget: category breakdown and timeline                | `(confirm)`                                                   |
| `/recurring`                   | Recurring series with a next-due calendar                  | `/planned/recurring-payments`                                 |
| `/goals`                       | Savings goals with progress and a projected date           | `(confirm)`                                                   |
| `/analytics/cash-flow`         | Income vs expense over a period                            | `/analytics/cash-flow`, reached from an index at `/analytics` |
| `/analytics/net-worth`         | Net-worth history line                                     | `/analytics/net-worth-history`                                |
| `/analytics/spending`          | Category donut with drill-down                             | `(confirm)`                                                   |
| `/settings/categories`         | Editable two-level category tree                           | `/settings/categories`                                        |
| `/import`                      | Import mapping step of a file import                       | `/settings/data-management/import/csv`                        |
| `/settings/billing`            | Current plan, usage, invoices                              | `(confirm)`                                                   |

**No equivalent surface is a valid answer.** These have no counterpart worth pairing, and a capture
agent that improvises one produces a comparison of two unrelated screens, which is worse than no
comparison:

- `/console/*` - the platform console
- `/legal/*`

**Two entries left this list on 2026-09-03, and one caveat came with them.** `/transactions/rules`
and `/transactions/suggestions` were filed here as automation surfaces with no counterpart. They
have one: a navigation round reached two sibling surfaces under the reference's transactions branch,
one shaped like a rules list and one shaped like a suggestions queue, at `/transactions/automations`
and `/transactions/optimizations`. Pairing them is now valid.

`/settings/currencies` and `/settings/members` are a weaker case and stay out for now. The
reference's settings index lists a currency entry and a sharing entry, but the round only saw that
index - the surfaces behind those rows were not opened, and an index row is not evidence that the
screen behind it is comparable to ours. Open them before pairing either.

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
  --url https://<the demo's main host>/<path> \
  --out .sandcastle-shots/manual --label B \
  --viewports 1440x900,360x800 --themes light,dark \
  --enter '<entry-control selector>' --enter-from 'https://<the demo's main host>/'
```

`<entry-control selector>` is a placeholder on purpose, and stays one: you read the entry point
off the page in front of you and pass it at call time. Nothing about their markup gets written down
here.

`--enter-from` is what makes any surface past the front door reachable. The entry click grants a
session that lives in the browser context that clicked and nowhere else, and a signed-out deep path
does not carry the control at all - so without it the second call photographs the marketing page
under the dashboard's filename. With it, the run lands on the entry page, clicks once, and only then
asks for the path. It is needed on **every** invocation, not just the first: each call opens a fresh
context. Drop both flags only for a surface that answers to an anonymous visitor at its own URL.

`.sandcastle-shots/` is gitignored. A pair exists only when both sides produced a frame for the same
viewport and theme; a lone frame is not evidence and must not be handed to a critic as one.

---

## Three ways the shutter invents a finding, and one thing it cannot hide

Found the first time this loop was actually run end to end, on 2026-09-03. Each produces a defect
that exists only in the photograph - which the critic then charges to the product, because the
critic has nothing else to go on. The first two are properties of `fullPage: true`; the third is
the dangerous one, because it produces a frame with nothing visibly wrong with it at all.

**Anything positioned against the viewport lands in the wrong place.** `position: fixed` resolves
against the window, so in a 1600px full-page frame a mobile tab bar is not at the bottom - it is
stranded a fifth of the way down, painted over whatever content sits behind it. That would be
harmless if it hit both sides equally. It does not: a layout that scrolls the document produces a
tall frame carrying the artefact, while a layout that scrolls an inner container produces a
viewport-height frame with its chrome exactly where a visitor sees it. Ours took the damage and the
reference did not, and the pair read as us shipping a broken navigation bar.

**A virtualised list photographs as a hole.** `/transactions` renders about fifty of six hundred
rows into a container sized for all six hundred. Scrolled by a person it fills in; photographed
whole it is a 4487px frame with roughly 2500px of empty ground between the last row and the footer.
Nothing is wrong with the screen. Everything is wrong with the picture of it.

**A deep path asked for too early photographs a front door.** The entry click is asynchronous on
the far side: the demo provisions a workspace before it hands over a session, so a deep path
requested before that finishes bounces to a sign-in screen. Nothing about the resulting frame looks
broken. It is sharp, it is complete, it is correctly named, and it is a photograph of somebody's
front door filed under a feature's name. A critic handed it does not report a bad capture - it
reports the product as having no such screen, and that is exactly what happened: one verdict had to
be thrown away after a critic described "a centred login card in an otherwise empty viewport" as a
finding against the reference. It was found only because the critic wrote the artefact down instead
of scoring it silently.

`capture.mjs` now compares the path it landed on against the path it asked for and files no frame
when they differ, warning instead. The path is the test rather than the whole URL, because a screen
that answers on its own and then appends its default query has not gone anywhere. A longer
`--settle` is the usual fix; 16s was not enough for every surface and 26-30s was. Check `warnings`
on every reference run and treat a refusal as a missing pair, never as a screen that does not exist.

So a comparison frame is shot with `--viewport-only` at every viewport where either side pins
anything or virtualises anything, which in practice means all of them. Identical treatment, and the
frame is what a visitor actually arrives at. The cost is that composition below the fold goes
unjudged; pay it.

**And the blind is not as blind as the procedure implies.** Both products paint their own wordmark
in the sidebar, so a critic reading the frames can name them, and in this round all seven did -
each disclosed the recognition unprompted and said it changed nothing, one adding that it made them
hunt harder for our faults. That is the right way for a critic to handle it, and it is still a
weaker claim than "blind". What the labels protect is which side the runner is on; they do not
protect brand identity, and a verdict must not be reported as though they do.
