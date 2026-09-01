# 0007. Charts are hand-rolled accessible SVG, not a chart library

Status: accepted
Date: 2026-09-01

## Context

The product needs line, area, stacked bar, donut and sparkline charts across the dashboard, the five
analytics surfaces and the budget and goal detail screens. The obvious move is a chart library:
Recharts, Chart.js, Nivo, visx, ECharts. Any of them would have charts on screen in a day.

The commitment that makes that a bad trade is `docs/ACCESSIBILITY.md`. Every chart in this product
owes four things: a text equivalent carrying exactly the data drawn, keyboard-reachable data points
with accessible names containing full unabbreviated amounts, a non-colour encoding per series, and a
`prefers-reduced-motion` path.

Measured against the candidates:

- **Canvas renderers** (Chart.js, ECharts by default) produce no DOM at all. There is nothing to
  focus, nothing to name, and the text equivalent has to be built beside the chart from the same
  data anyway — at which point half the work is done and the library is drawing pixels we cannot
  reach.
- **DOM renderers** (Recharts, Nivo) produce a DOM we do not control: the element order, the
  tabindex behaviour, the tooltip's live-region semantics and the legend's markup are the library's
  decisions. Overriding them means fighting the library on every release.
- **Low-level toolkits** (visx) are close to what we want, and are essentially `d3-scale` plus React
  wrappers — the thing we would write ourselves, with an extra dependency and an extra abstraction.

There is a second, quieter reason. Our chart surface is _narrow_: five chart forms, one visual
language, one palette, one interaction model. A library is priced for breadth we will never use, and
breadth is what makes its markup un-opinionated in exactly the places we need it opinionated.

## Decision

Charts are hand-rolled accessible SVG built on `d3-scale`, `d3-shape` and `d3-time` — scales, path
generation and tick arithmetic only. No chart library.

Every chart primitive ships, in the same component that draws it:

1. A visually-hidden `<table>` with a caption, carrying exactly the data the chart draws.
2. Keyboard-reachable data points — arrow keys along a series, Home/End to the ends — each with an
   accessible name containing the full, unabbreviated amount.
3. A non-colour encoding per series: a marker shape, a dash pattern, or a direct in-place label.
4. Gridlines and axes at 3:1 minimum; axis labels in the caption scale at 7:1.
5. A reduced-motion path in which no draw-in animation runs.

`src/lib/charts/` is the primitive layer; `16-charts.md` is the plan that builds it and every
analytics stage consumes it rather than drawing its own.

## Consequences

**The cost is real and it is front-loaded:** roughly two weeks of primitive work before the first
analytics screen can be built, and plan 16 sits in wave 4 as a hard dependency of 17 and 18. Tooltip
positioning, axis tick selection at awkward ranges, stacked-bar zero handling, donut label collision
and responsive tick thinning are all problems a library had already solved and that we now solve
ourselves. Some of them we will get wrong first.

We also give up things we may later want: brushing and zooming, a treemap, a sankey, animated
transitions between datasets. Each of those becomes a build rather than a prop.

What we get in exchange is that "every chart has a text equivalent and a keyboard-reachable data
point" is a **property of our code** rather than a hope about a vendor's next release. It is testable,
it is enforced by the chart primitive's own API — a chart that is constructed without its data table
does not type-check — and it cannot regress when a dependency updates.

Given that two of this product's five claimed AAA criteria and a large share of its AA surface live
inside charts, that property is worth two weeks.
