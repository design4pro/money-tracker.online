# 16 — Charts

## Area brief

Four chart types, hand-rolled as accessible SVG on `d3-scale`, `d3-shape` and `d3-time`: **line/area**,
**stacked bar**, **donut** and **sparkline**. No chart library
(`docs/adr/0007-hand-rolled-accessible-charts-over-a-chart-library.md`,
`99-boundaries-and-blockers.md` BND-20).

Every chart in this product ships four things, and a chart missing any of them is not done:

1. a **visually-hidden `<table>`** carrying the same numbers,
2. **keyboard-reachable data points** with a real focus ring,
3. a **non-colour encoding** for every series — a pattern, a direct label or a marker shape,
4. a **`prefers-reduced-motion` path** that renders the final state with no transition.

The frame primitive (`chart-frame.tsx`) is a shared path and is built by `00-S10`, which makes the
`dataTable` prop **required**, so a chart without a text equivalent does not type-check. This plan
builds the four chart types on top of it and the axis/scale utilities they share.

---

## Stage 16-S1 — Scales, axes and the line/area chart

### Stage id

`16-S1` · Wave 4 · effort **L**.

### Reference rows

`CHART-01 missing → done` — the scale and axis utilities over `d3-scale` and `d3-time`.
`CHART-02 missing → done` — the line and area chart with keyboard-reachable points.

### Owned paths

- `src/components/charts/scales.ts` — new
- `src/components/charts/axis.tsx` — new
- `src/components/charts/line-chart.tsx` — new
- `src/components/charts/data-table.tsx` — new
- `src/components/charts/__tests__/scales.test.ts` — new
- `src/components/charts/__tests__/line-chart.test.tsx` — new

### Data and migration

None. Charts render data they are given; they never fetch.

### Server (repo, server function, Zod)

None. `src/components/charts/**` is client code and, like `components/ui`, **never imports from
`server/`** — the same ESLint boundary from `01-S3` covers it, extended here to the charts directory.

### UI (route, components)

- **Route.** None; the gallery route (`01-S1`) hosts the visual evidence.
- **Components.** `scales.ts` wraps `scaleTime`, `scaleLinear` and `scaleBand` with our own nice-tick
  logic; `axis.tsx` renders ticks with locale-formatted labels; `line-chart.tsx` composes
  `chart-frame` (`00-S10`) with `d3-shape`'s line and area generators; `data-table.tsx` is the shared
  visually-hidden table renderer every chart type passes to the frame.
- **States.** A chart has three: **empty** (no data — a designed message inside the frame, with the
  axes still drawn so the layout does not jump), **partial** (a gap in the series, rendered as a real
  gap with a legend note, never interpolated across), and **loaded**. There is no skeleton of its own:
  the frame reserves its space and the parent's skeleton covers the wait.
- **Tokens.** The categorical series palette lives in `tokens.css` (`00-S3`). **Eight distinguishable
  series at 7:1 against both themes is at the edge of what sRGB permits**, which is precisely why the
  non-colour encoding is mandatory rather than a nicety — `docs/ACCESSIBILITY.md` §4 records this as
  one of the reasons the blanket AAA claim is not made.
- **Accessibility.** Data points are a roving-tabindex group: `Tab` enters the series, arrow keys move
  between points, `Home`/`End` jump to the ends, and each point's accessible name is
  _"<series>, <date>, <formatted amount>"_. The visually-hidden table is a real `<table>` with a
  `<caption>` naming the chart. The line's colour is paired with a **marker shape per series**, so two
  series remain distinguishable in greyscale.

### Quota

No countable row.

### Tenant isolation test

None — chart components read no row and receive their data as props. Stated rather than skipped.

### Money invariant

_A chart datum is an integer minor-unit amount plus a currency, all the way to the tooltip._ Cases in
`line-chart.test.tsx`:

- _the component's datum type is branded `Minor`_ — passing a plain number does not compile
  (`@ts-expect-error` fixture).
- _the axis labels, the point's accessible name, the tooltip and the visually-hidden table all render
  through `formatAmount`_ with the same `code` and `digits`, so four surfaces cannot disagree.
- _the y-scale's domain is computed from integers_; `d3-scale` returns floats for **pixel positions
  only**, and no float ever travels back into a displayed value.
- _a zero-decimal currency renders no decimal separator anywhere in the chart_, including the axis.

### Verification

- Command gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `scales.test.ts`: nice ticks for a 0–100 range, a 0–3 range, a negative-to-positive range, and a
  single-value series (which must not produce a zero-height domain).
- `line-chart.test.tsx`: the four money cases; the roving tabindex; the visually-hidden table matching
  the series exactly; a gap rendered as a gap.
- Browser evidence on `/_dev/gallery`: the line chart with **three series**, both themes, at
  **360 / 1280 / 2560 px**, plus a **focused data point showing its focus ring**, the **empty state**,
  and the **greyscale rendering** (a forced-colours or grayscale-filter capture) proving the series
  are distinguishable without colour.
- axe on the gallery: zero `serious`, zero `critical`.

### Definition of done

All seven §7 items and all ten §2 clauses, with the chart clause carrying this stage's weight.

### Blockers

None.

---

## Stage 16-S2 — Stacked bar, donut and sparkline

### Stage id

`16-S2` · Wave 4 · effort **L**.

### Reference rows

`CHART-03 missing → done` — the stacked bar chart.
`CHART-04 missing → done` — the donut chart with drill-down.
`CHART-05 missing → done` — the sparkline.

### Owned paths

- `src/components/charts/bar-chart.tsx` — new
- `src/components/charts/donut-chart.tsx` — new
- `src/components/charts/sparkline.tsx` — new
- `src/components/charts/legend.tsx` — new
- `src/components/charts/__tests__/bar-chart.test.tsx` — new
- `src/components/charts/__tests__/donut-chart.test.tsx` — new

### Data and migration

None.

### Server (repo, server function, Zod)

None.

### UI (route, components)

- **Components.** `bar-chart.tsx` (stacked, with a grouped variant), `donut-chart.tsx` (on
  `d3-shape`'s arc, with an interactive centre showing the focused slice), `sparkline.tsx` (no axes,
  no legend, but **still** a visually-hidden table — a small chart is not an exempt chart),
  `legend.tsx` (shared, with a swatch, a **pattern sample** and a direct label per series).
- **States.** The three of `16-S1`. The donut adds a fourth: **a single-slice donut is rendered as a
  labelled full ring**, not a circle with an invisible boundary, and a slice below 1% is grouped into
  _Other_ with its contents reachable — a 0.3% slice is unhittable by pointer and unreadable by
  anyone.
- **Tokens.** The categorical palette plus the pattern set. Patterns are SVG `<pattern>` fills defined
  once in `legend.tsx` and referenced by id, so a chart with eight series does not define eight
  patterns per instance.
- **Accessibility.** The donut's slices are a roving-tabindex group in **value order, not visual
  order**, so tabbing goes largest-first, which is the order a person reasons in. Each slice's
  accessible name is _"<category>, <formatted amount>, <percentage> of total"_. **The percentage is
  never the only information.** The stacked bar's segments are individually focusable and each
  announces its series, its value and the stack's total.

### Quota

No countable row.

### Tenant isolation test

None — no data access.

### Money invariant

_A stack's segments sum to its stated total, and a donut's slices sum to 100% without a rounding
artefact._ Cases:

- _the stacked bar's rendered total equals the integer sum of its segments' minor amounts_, and the
  total is that sum rather than an independently-computed figure.
- _the donut's percentages are computed from integers and the displayed percentages sum to 100_ —
  using the largest-remainder method, the same one `11-S1` uses for split ref-amounts, so a person
  never sees three slices totalling 99%.
- _the "Other" group's amount is the exact integer sum of what it hides_, and expanding it shows
  exactly those items.
- _the sparkline's min and max annotations are the actual data values_, formatted through
  `formatAmount`, not the scaled pixel values.

### Verification

- Command gate.
- `bar-chart.test.tsx` and `donut-chart.test.tsx`: the four money cases; the roving tabindex in value
  order; the sub-1% grouping and its expansion; the single-slice donut.
- Browser evidence on `/_dev/gallery`: all three charts, both themes, at 360 / 1280 / 2560 px, plus a
  **focused donut slice with the centre updated**, a **focused stack segment**, the **legend showing
  patterns**, and the **greyscale capture** for the stacked bar with six series.
- axe on the gallery: zero `serious`, zero `critical`.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.

---

## Stage 16-S3 — The consumer pass

### Stage id

`16-S3` · Wave 4 · effort **S**. The stage that lands the charts into the two screens that shipped
without them.

### Reference rows

`CHART-06 missing → done` — the account history chart on `/accounts/$accountId`.
`CHART-07 missing → done` — the goal progress chart on `/goals/$goalId`.
`CHART-08 missing → done` — the budget period timeline chart on `/budgets/$budgetId`.

### Owned paths

- `src/routes/_app/accounts/-ui/history-chart.tsx` — new
- `src/routes/_app/goals/-ui/progress-chart.tsx` — new
- `src/routes/_app/budgets/-ui/period-chart.tsx` — new
- `e2e/charts.visual.spec.ts` — new

### Data and migration

None. Each chart is fed by the loader its owning stage already built: `06-S2`'s
`loadAccountDetail`, `15-S2`'s `loadGoalDetail`, `12-S2`'s `loadBudgetDetail`.

### Server (repo, server function, Zod)

None. **This stage edits no route file** — each owning stage exposes a slot and this stage fills it
with a component in its own file. That is what keeps three plans from colliding on three route files
in one wave.

### UI (route, components)

- **Components.** Three thin compositions over `16-S1` and `16-S2`'s primitives, each supplying the
  `dataTable` the frame requires and the locale-aware formatting.
- **States.** Each inherits the chart states of `16-S1`; the **empty** state's copy is specific per
  surface (_"History starts at your first transaction"_, _"Add contributions to see progress"_,
  _"This budget has one period so far"_) rather than a shared blank.
- **Tokens.** None new.
- **Accessibility.** Each chart's visually-hidden table **replaces** the placeholder table those three
  stages shipped, rather than adding a second one — two tables of the same numbers is worse than none,
  because a screen-reader user reads both and wonders which is current.

### Quota

No countable row.

### Tenant isolation test

None — the charts render data already scoped by their loaders.

### Money invariant

_Replacing a table with a chart changes nothing about the numbers._ Case in
`money-invariants.test.ts`: _the chart's visually-hidden table is byte-identical to the placeholder
table it replaces_, asserted against the same fixture for all three surfaces. This is the property
that makes the wave-3-ships-the-table, wave-4-adds-the-chart ordering safe.

### Verification

- Command gate.
- Unit: the three compositions render their `dataTable` and pass their formatting through
  `formatAmount`.
- Browser evidence: `/accounts/$id` (history tab), `/goals/$id` and `/budgets/$id` **before and after**
  is not required, but each route is re-captured with its chart, both themes, at 360 / 1280 / 2560 px,
  plus one focused data point per chart.
- `e2e/charts.visual.spec.ts` runs axe on all three routes: zero `serious`, zero `critical`, and
  asserts **exactly one** visually-hidden data table per chart.
- Console silent.

### Definition of done

All seven §7 items and all ten §2 clauses.

### Blockers

None.
