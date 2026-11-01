---
name: money-tracker.online
description: A passbook kept at the kitchen table - every line is an entry, a balance follows each one, and one violet stamp is spent only on what is settled.
colors:
  canvas: '#f5f4ee'
  surface: '#fbfaf6'
  surface-raised: '#ffffff'
  surface-sunken: '#ebeae1'
  surface-panel: '#ebeae1'
  ink: '#262420'
  ink-2: '#4b4941'
  border-subtle: '#c3d1c4'
  border-panel: '#a8b5a9'
  border-strong: '#6f7d71'
  accent: '#4a2a82'
  accent-hover: '#35195f'
  accent-press: '#26113f'
  on-accent: '#ffffff'
  brand: '#4a2a82'
  brand-hover: '#35195f'
  brand-soft: '#ece4f7'
  highlighter: '#ece4f7'
  pen-neutral: '#cfcec5'
  pen-info: '#cfcec5'
  pen-brand: '#d8cfea'
  pen-positive: '#bbd7c6'
  pen-negative: '#ebc7c1'
  pen-warning: '#decdb2'
  on-brand: '#ffffff'
  positive: '#0b5136'
  positive-soft: '#dcf2e4'
  on-positive: '#ffffff'
  negative: '#8a1a0d'
  negative-soft: '#f8e3df'
  on-negative: '#ffffff'
  negative-bold: '#c31300'
  warning: '#614106'
  warning-soft: '#f7ead3'
  on-warning: '#ffffff'
  info: '#4b4941'
  info-soft: '#ebeae1'
  on-info: '#ffffff'
  focus: '#4a2a82'
  focus-gap: '#ffffff'
  hover: 'rgb(38 36 32 / 0.06)'
  press: 'rgb(38 36 32 / 0.1)'
  selection: '#e3d9f2'
  scrim: 'rgb(22 20 30 / 0.55)'
  skeleton: '#e6e5dc'
  skeleton-sheen: 'rgb(255 255 255 / 0.6)'
  chart-emphasis: 'rgb(38 36 32 / 0.06)'
  series-1: '#0d6abb'
  series-2: '#0a646a'
  series-3: '#0f7b62'
  series-4: '#436f0a'
  series-5: '#625106'
  series-6: '#b1440c'
  series-7: '#a60d47'
  series-8: '#9724b5'
typography:
  hero:
    fontFamily: 'Caveat, Caveat Fallback, Bradley Hand, Segoe Script, cursive'
    fontSize: 'clamp(3.25rem, 8vw, 5rem)'
    fontWeight: 700
    lineHeight: '5rem'
    letterSpacing: '0'
  display:
    fontFamily: 'Caveat, Caveat Fallback, Bradley Hand, Segoe Script, cursive'
    fontSize: 'clamp(2rem, 4.5vw, 3rem)'
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: '0'
  title:
    fontFamily: 'Caveat, Caveat Fallback, Bradley Hand, Segoe Script, cursive'
    fontSize: '2rem'
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: '0'
  subtitle:
    fontFamily: 'Caveat, Caveat Fallback, Bradley Hand, Segoe Script, cursive'
    fontSize: '1.25rem'
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: '0'
  body:
    fontFamily: 'Courier Prime, Courier Prime Fallback, Courier New, Courier, monospace'
    fontSize: '0.9375rem'
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: 'Courier Prime, Courier Prime Fallback, Courier New, Courier, monospace'
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: 'Courier Prime, Courier Prime Fallback, Courier New, Courier, monospace'
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.5
  micro:
    fontFamily: 'Courier Prime, Courier Prime Fallback, Courier New, Courier, monospace'
    fontSize: '0.6875rem'
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: '0.06em'
rounded:
  sm: '0.125rem'
  md: '0.125rem'
  lg: '0.1875rem'
  xl: '0.25rem'
  2xl: '0.25rem'
  full: '9999px'
spacing:
  1: '0.25rem'
  2: '0.5rem'
  3: '0.75rem'
  4: '1rem'
  5: '1.25rem'
  6: '1.5rem'
  8: '2rem'
  10: '2.5rem'
  12: '3rem'
  16: '4rem'
  20: '5rem'
  24: '6rem'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.on-accent}'
    rounded: '{rounded.md}'
    height: '2.5rem'
    padding: '0 {spacing.4}'
    typography: '{typography.label}'
  button-primary-hover:
    backgroundColor: '{colors.accent-hover}'
    textColor: '{colors.on-accent}'
  button-primary-active:
    backgroundColor: '{colors.accent-press}'
    textColor: '{colors.on-accent}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    height: '2.5rem'
    padding: '0 {spacing.4}'
    typography: '{typography.label}'
  button-secondary-hover:
    backgroundColor: '{colors.surface-sunken}'
    textColor: '{colors.ink}'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-2}'
    rounded: '{rounded.md}'
    height: '2.5rem'
    padding: '0 {spacing.4}'
    typography: '{typography.label}'
  button-ghost-hover:
    backgroundColor: '{colors.hover}'
    textColor: '{colors.ink}'
  button-brand:
    backgroundColor: '{colors.brand}'
    textColor: '{colors.on-brand}'
    rounded: '{rounded.md}'
    height: '2.5rem'
    padding: '0 {spacing.4}'
    typography: '{typography.label}'
  button-danger:
    backgroundColor: '{colors.negative}'
    textColor: '{colors.on-negative}'
    rounded: '{rounded.md}'
    height: '2.5rem'
    padding: '0 {spacing.4}'
    typography: '{typography.label}'
  field:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    height: '2.5rem'
    padding: '0 {spacing.3}'
    typography: '{typography.label}'
  card:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.xl}'
    padding: '{spacing.5}'
  card-inset:
    backgroundColor: '{colors.surface-sunken}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: '{spacing.5}'
  card-brand:
    backgroundColor: '{colors.brand-soft}'
    textColor: '{colors.ink}'
    rounded: '{rounded.xl}'
    padding: '{spacing.5}'
  # One family: every tone is the pen mark, and a tone fills the `wash` slot and nothing else - the
  # word is `ink` in all eight. `settled` takes the default `highlighter`; `neutral` and `info`
  # take `pen-neutral` / `pen-info` (one value), `brand` and `accent` take `pen-brand`, and
  # `positive`, `negative` and `warning` take their own `pen-*` (`### Badges`, ADR 0028).
  badge:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    wash: '{colors.highlighter}'
    rounded: '{rounded.sm}'
    height: '1.5rem'
    padding: '0 {spacing.2}'
    typography: '{typography.caption}'
  badge-sm:
    height: '1.25rem'
    padding: '0 0.375rem'
    typography: '{typography.micro}'
  typed-line:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    height: '2.5rem'
    padding: '0 {spacing.4}'
    typography: '{typography.label}'
  typed-line-planned:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-2}'
    height: '2.5rem'
    padding: '0 {spacing.4}'
    typography: '{typography.label}'
  table-row:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    padding: '{spacing.2} {spacing.3}'
    typography: '{typography.label}'
  table-row-selected:
    backgroundColor: '{colors.brand-soft}'
    textColor: '{colors.ink}'
  nav-link:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-2}'
    rounded: '{rounded.md}'
    padding: '{spacing.2} {spacing.3}'
    typography: '{typography.label}'
  nav-link-active:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.brand}'
    rounded: '{rounded.md}'
    padding: '{spacing.2} {spacing.3}'
    typography: '{typography.label}'
---

# Design System: money-tracker.online

## Overview

**Creative North Star: "The Kitchen-Table Passbook"**

Derived, not chosen: the direction contract's FORM is "Książeczka" (the passbook) and its OWN-WORLD
block names off-white form paper, printed green ruling, typed entries, a handwritten heading and one
violet stamp. Every line of the product is an entry and a balance stands after each one, and a
page has both ends: a balance carried in on its first line and a balance carried forward on its
last. The
paper is form paper, not a dashboard: printed rules at a 2.5rem pitch carry the structure that a
grid of cards would otherwise carry, the entries are typed in a typewriter face so that a column of
money aligns on its decimal without help, and the headings and margin notes are written by hand,
pinned to a printed rule rather than floating above the text. The book is kept by an adult; the
hand is quick, not a schoolroom script, and the typewriter is a working tool, not a prop.

There is one stamp. Violet is the colour of a commanding action and of anything the product has
settled: a primary button, a link, the current destination, the focus ring, the selected row, and
the one "settled" mark itself - a typed word with a run of highlighter in the stamp wash behind
it, beside the line that was carried in. It is never spent on what is planned: a page whose last
entry is planned closes in pencil and is not marked. A planned line is written in pencil - the second ink at
`ink-2` - and the word "Planned" beside it is the channel; the grey only agrees. Nothing is ever
struck through, because the product has no voided line. Green ink is money in hand, red ink is
money overdrawn, brown ink is a warning, and each is text-grade at 7:1 on the darkest ground it can
land on.

Nothing floats at rest. A slip laid on the paper has a one-pixel under-edge and nothing more, and
the corners of everything are the corners a guillotine leaves (2-4px). Materials are at full
strength: typed ink at 12.83:1, printed rules faint on purpose (1.44:1) so a page full of them reads
as paper rather than as a grid. Dark is the same book read on a phone at night - slate paper, bone
ink, lilac stamp - designed as a second set of values rather than inverted from the first. The
three risks the world was built to avoid are: reading as school-like or childish (so the hand is
bold, adult and never decorated), as retro or nostalgic (so there is no texture, no aged paper, no
faux stamp graphic - the metaphor lives in rules and type, and the one drawn gesture is the
highlighter pen, run behind the word of every badge), and as too little like an
application (so every control is a React Aria primitive with a 3:1 boundary, a 44px target and a
two-ring focus indicator).

**Key Characteristics:**

- Form paper (`canvas`), ruled in printed green at a 2.5rem pitch; the rules are the layout.
- Two faces, two jobs: Caveat for anything written by hand, Courier Prime for anything read as a
  record - body, controls and every figure.
- One violet stamp for every action and every "settled" mark; never on what is planned.
- State is line form before hue: planned in pencil, booked in ink, nothing struck through.
- Rules instead of cards; a heading over a body with a hairline above it is the unit of composition.
- Square corners (2-4px); `full` radius only on things that are genuinely round.
- Nothing floats at rest. The resting shadow is a one-pixel under-edge.
- Every number that can change is set in the typewriter face and tabular.
- Every colour token carries its measured contrast ratio beside its declaration.
- Light and dark are two designed sets, both declared at three sites.

## Colors

A form-paper neutral set, one violet stamp ink, and three coloured inks for state, every text pair
measured with the WCAG relative-luminance formula and recorded in `src/styles/tokens.css`. The
ratios quoted below are those annotations. Light text is measured against `surface-sunken`, the
darkest ground it can sit on; dark text against `surface-raised`, the lightest.

### Primary

- **Stamp Violet** (`accent` / `brand`): one ink, two jobs. As `accent` it is the fill of every
  commanding action (white on it at 10.80:1; `accent-hover` 14.43:1, `accent-press` 17.01:1). As
  `brand` it is the same value used as text - links, the current destination, the focus ring, the
  active tab's top rule - at 8.94:1 on sunken and 10.80:1 on raised. In dark it becomes a lilac
  `#c5aef2` (7.43:1 on raised) and the fill carries slate ink on it at 9.14:1.
- **Stamp Wash** (`brand-soft`): the tint under a selected row and a brand card. It carries
  `brand` as readable text at 8.75:1 (dark: 7.58:1), so it is a real ground rather than decoration.
- **Highlighter** (`highlighter`): the wash of the settled mark. In light it is the stamp wash
  itself (`#ece4f7`, carrying `ink` at 12.55:1); in dark it is a lilac pen (`#523e7c`, carrying
  `ink` at 7.33:1) rather than the selection tint, because a highlighter run over a line has to
  read as a pen and not as a selected row. It is spent on the `settled` badge and nowhere else.
- **Pens** (`pen-neutral`, `pen-info`, `pen-brand`, `pen-positive`, `pen-negative`,
  `pen-warning`): the wash of every other badge tone - the tone's own hue, and never text. `ink`
  on each, composited at the mark's 75% over `surface` and `surface-sunken`, clears 7:1 in both
  themes (worst 10.51:1 light, 7.18:1 dark); the pooled trailing edge carries no glyph and is held
  to 3:1 as a graphical object. `pen-neutral` and `pen-info` are one value, and `accent` has no
  pen of its own, because the palette never separated those tones (`### Badges`).

### Tertiary - the coloured inks

- **Green Ink** (`positive`): money in, on track, within budget. 7.75:1 on sunken, 9.36:1 on
  raised; on `positive-soft` 7.96:1. Dark `#7fd9a8`.
- **Red Ink** (`negative`): money out, overdrawn, destructive confirmation, validation failure.
  7.78:1 on sunken, 9.40:1 on raised; on `negative-soft` 7.63:1. Dark `#f6a898` (7.61:1 on raised,
  and 7.20:1 on the ground `--color-hover` leaves over `surface` - the one hue tuned against a
  _washed_ ground rather than a plane, because a verdict hue cannot be promoted to `ink` on hover
  the way the greys are).
- **Loud Red** (`negative-bold`): the same ink at the grade that is not held to the text floor -
  the over-budget headline in `AmountMeter` and the over-budget meter fill, and nothing else.
  5.09:1 on sunken, 6.15:1 on raised; dark `#ff5e4a` at 4.82:1 on raised and 4.56:1 on a hovered
  row, which is the binding ground in dark. The floors that apply
  are 4.5:1 (large text: bold at >= 18.66px, WCAG 1.4.6) and 3:1 (a fill, WCAG 1.4.11), so both
  values sit above the stricter of the two on all five opaque planes, and on every washed ground a
  call site produces today: `hover` over `surface` (a hovered budget row) and `hover` over
  `surface-sunken` (an archived over-budget budget card). **Not on every washed ground.** It misses
  4.5:1 under either wash over dark `surface-raised` or dark `surface-panel`, and under `press` over
  dark `surface`, dark `canvas`, light `surface-sunken` or light `surface-panel`. Those eight are
  recorded as failing in `tokens-contrast.test.ts`, not designed for: no call site produces them,
  because `rowWash` paints `hover` and never `press` - a convention, not a boundary, and nothing but
  that test and this note stops one from being written. Putting the grade on any of them is a
  palette decision, not a call-site one. Its 3:1 fill floor is clear on all eight, worst case
  3.44:1. It exists because one token cannot be
  both a caption ink and a danger colour: `negative` has to hold 7:1, and in dark that pins it to a
  pale salmon, since red is luminance-poor and no deeper red in sRGB reaches that floor. **Never
  put body-size text in it**, and never reach for it as a general "stronger red".
  **Nor for a partial fill.** A danger fill takes this grade when it is the whole track, and
  `negative` when it can stop short on one. The over-budget fill is always full - `over` means the
  ratio passed 1, which clamps it - so its neighbour is the card. `ui/Meter` takes its threshold
  from a `dangerAt` prop and reads it: at `>= 1` the danger state needs `percentage >= 100`, so
  that fill is full too and takes the loud grade; below 1 it is partial and abuts the track, where
  the loud grade measures 3.18:1 against `border-subtle` and `negative` measures 5.02:1. Both clear
  1.4.11, and the thin margin is not spent where the adjacency does not force it. Same criterion,
  two adjacencies - told apart by the threshold, so one over-limit verdict is one red across the
  product. The danger **icon** is on neither grade: it is a 14px glyph, which is neither large text
  nor a fill, so it stays on `negative`.
- **Brown Ink** (`warning`): approaching a limit, unconfirmed, overdue soon. 7.67:1 on sunken,
  9.26:1 on raised; on `warning-soft` 7.79:1. Dark `#e9c46a`.
- **Notice** (`info`): a system notice with no verdict - "Hidden", "Planned", "Auto", a scope. It
  is pencil, not a fifth hue and not the stamp: `info` shares `ink-2`'s value (7.47:1 on sunken,
  9.02:1 on raised; dark 7.11:1 on raised) and `info-soft` is the printed tint (`surface-sunken`,
  carrying `info` at 7.47:1; dark 9.15:1). A status never wears violet.

### Neutral

- **Form Paper** (`canvas`): the page. The ruling is drawn on it, not on a card.
- **Slip** (`surface`): a sheet laid on the paper - a table body, a card, a field, the current
  rail row. One step lighter than the paper so it reads as laid on, not cut out.
- **Blank Sheet** (`surface-raised`): the one pure white, kept for layers that genuinely leave the
  paper - menus, popovers, dialogs.
- **Printed Tint** (`surface-sunken` / `surface-panel`): the form's own printed shading, one step
  down (1.10:1 from canvas); the rail, the table header band, the footer, a disabled control. Both
  tokens share the value in light; in dark `panel` lifts (1.17:1) while `sunken` recesses.
- **Typed Ink** (`ink`): 12.83:1 on sunken, 15.49:1 on raised. Dark: bone `#ebe8df`, 11.88:1.
- **Pencil** (`ink-2`): 7.47:1 on sunken, 9.02:1 on raised. Metadata, column headings, and every
  planned line. It is not a 4.5:1 grey; hierarchy comes from face, weight and position, never from
  fading text.
- **Printed Rule** (`border-subtle`): the green ruling of the form. Decorative and deliberately
  faint at 1.44:1 on canvas, so a page full of it reads as paper rather than as a grid.
- **Column Rule** (`border-panel`): the heavier rule - the spine before the balance column, the
  rule under a column heading, the frame of the current rail row, the section rule between two
  paper grounds. 1.94:1 on canvas, 1.77:1 on panel.
- **Both rules are slate in dark, not green, and they are set higher there** (`border-subtle`
  `#42454c`, 1.87:1 on canvas and 1.52:1 on raised; `border-panel` `#5a5d64`, 2.72:1 on canvas and
  2.33:1 on panel). Two reasons, and neither is taste. Dark's whole canvas-to-raised tone span is
  1.231:1, because `surface-raised` is pinned by `ink-2`'s 7:1 floor - light separates a card by
  tone _and_ a rule, dark has only the rule, so the rule carries a larger share and is measured
  against dark's own floor rather than re-valued from light's. And a green line on slate grounds
  reads as an unconverted leftover rather than as printed ruling, which is what made the `info`
  badge - whose entire chrome was then a `border-panel` rule - glow at night. The floors are stated in
  `src/styles/tokens.css` and checked per theme against every ground in
  `src/styles/__tests__/tokens-contrast.test.ts`.
- **Control Boundary** (`border-strong`): the edge of anything pressable or typeable. 4.33:1 on
  raised, 3.59:1 on sunken, clearing the 3:1 floor of WCAG 1.4.11 on every ground.

### The category series palette

Eight hues (`series-1` to `series-8`) for chart fills, category dots and legends, every one at or
above 3:1 against every ground in its own theme (measured minimum 4.31:1 light, 4.68:1 dark) and
re-tuned for dark rather than reused. They are stored on categories and do not move without a
data migration. They guarantee 3:1 for a graphical object and explicitly not 7:1: a series colour
is never text.

### Named Rules

**The One Stamp Rule.** The rule governs hue, not marking. Violet is spent only on what commands and
on what is settled - the primary action, a link, the current destination, the focus ring, the
selected row, and the `settled` badge, whose run of pen is the `highlighter` wash. It is never
spent on a planned line, a decoration, a heading or a divider. Every badge is the pen mark
(`### Badges`); every other tone marks in its own hue, so a green, red, brown or grey run of pen is
not a second stamp. If a screen needs a second violet thing, one of them is not an action
(`docs/adr/0028-the-mark-is-the-badge.md`).

**The Pencil Rule.** A planned entry is written in `ink-2` with the word beside it; a booked entry
is written in `ink`. State is line form before hue, and nothing is ever struck through.

**The Colour-Is-Never-Alone Rule.** Money direction is never encoded by colour alone, and colour is not
even the first channel: every amount carries an explicit sign, inflow is set at the bold weight and
outflow at regular, a transfer carries a repeat glyph, and the product stays correct with all
colour removed. The measured dichromat separation of the green and red inks is the reason. The rule
is wider than direction. A status is named by a word, never by its hue alone (`### Badges`, the
accessibility contract). A chart series is told apart by something besides its hue: ADR 0007 requires
a marker shape, a dash pattern or a direct in-place label for each series, and a text table carrying
the data drawn (`### Charts`). A category carries its series colour as a dot beside its name, so
the colour is never the only identifier (`### Badges`, when not to use one).

**The Measured Pair Rule.** Every colour token that can meet text carries its measured contrast
ratio as a trailing comment beside its declaration in `tokens.css`, and the contrast test recomputes
every one on each run. A token added without its measurement is not finished.

**The Three-Site Rule.** Every themed colour is declared in exactly three places: bare `:root`,
`@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and
`:root[data-theme="dark"]`. Fewer than three produces a toggle that works in one direction only.

## Typography

**Display Font:** Caveat, variable 400-700, self-hosted (with a metric-compensated `Caveat
Fallback` over Bradley Hand / Segoe Script) - the hand.
**Body Font:** Courier Prime 400 and 700, self-hosted (with `Courier Prime Fallback` over Courier
New) - the typewriter. Body, controls and every figure.
**Label/Mono Font:** none distinct. The body is monospaced; `--font-mono` resolves to the same
stack.

**Character:** a quick adult hand over a working typewriter. The hand is bold at display sizes
because Caveat's x-height is small and needs a third more size than a sans to carry the same
weight; the typewriter has regular and bold only, which is all a typewriter ever had, so a
`font-weight: 500` resolves to regular and `600` to bold. There is no negative tracking anywhere: a
typewriter cannot kern and a hand does not. Both stacks name their fallback face immediately after
the web face with the web face's own `hhea` metrics as overrides, so the swap can move a line by a
few characters but never by a pixel of height. `h1`-`h3` take the display face at the base layer.

### Hierarchy

- **Hero** (700, `clamp(3.25rem, 8vw, 5rem)`, line box `5rem`): the handwritten refusal across
  the landing. Its line height is a length, not a ratio - two rules of the form per line - so it
  sits on the pitch at every width the clamp reaches. One per page.
- **Display** (700, `clamp(2rem, 4.5vw, 3rem)`, 1.05): a section heading on the marketing page; the
  largest hand inside the app.
- **Title** (700, 32px, 1.1): page titles and the margin note beside the passbook.
- **Subtitle** (700, 20px, 1.25): card titles, entry titles in a ruled list, dialog titles.
- **Body** (400, 15px, 1.55): prose and form labels. Running text is capped at `--measure` (64ch;
  `ch` follows the element's own size, so 576px under `text-body` and 461px under `text-caption`)
  with 1.6 leading (`--leading-reading`) and 1.5em paragraph spacing (`--paragraph-gap`).
- **Label** (400, 13px, 1.5): the default inside controls and the typed line of the passbook -
  button labels, field text, table cells, the rail.
- **Caption** (400, 12px, 1.5): dates, metadata, helper text, the converted amount under a figure.
  Set in `ink-2`, which still clears 7:1.
- **Micro** (700, 11px, 1.2, 0.06em, uppercase): column headings, `dt` terms in a description
  list, the small badge. It sits beside or above a figure on the same line and never above a
  heading.

### Named Rules

**The Typed Line Rule.** A line of the passbook is a 2.5rem box - one rule of the form - and its
baseline sits 3px above the printed rule, placed by a translate (`translate-y-[calc(1rem-0.22em)]`
for the typewriter at label size) so paint moves and layout does not. A cell has no vertical
padding, and the rule under it is drawn as an inset one-pixel shadow rather than a border so it
adds no height and the table never walks off the pitch.

**The Hand-On-Rules Rule.** A handwritten heading on ruled paper is placed on the rules the same
way: the hero by `translate-y-[calc(2.5rem-0.33em)]`, a title by `leading-10` plus
`translate-y-[calc(1.25rem-0.33em)]`. A hand that floats between rules reads as a sticker.

**The Two Voices Rule.** Anything read as a record is typed; anything said by the keeper is
written. A heading, a margin note or a section title is Caveat; a figure, a label, a button, a
cell or a paragraph is Courier Prime. A figure is never set in the hand and a heading is never
typed.

**The Tabular Rule.** Any number that can change carries `.tabular` on the element holding the
digits. The face is monospaced already; the utility stays so a re-rendered total still asks for
tabular figures should the face ever change under it.

**The Real Minus Rule.** A negative amount is prefixed with U+2212, not a hyphen, and a positive
inflow carries an explicit `+`. Zero is written unsigned.

**The Spoken-Sentence Rule.** A money cell carries two strings: the drawing, `aria-hidden`, and a
full sentence in an `sr-only` span that names the currency in full and the direction in words.

## Layout

The page is ruled paper. On the landing, a `repeating-linear-gradient` draws one `border-subtle`
hairline every 2.5rem (masked out over the last 4rem), and every vertical measure on the page -
the hero's line box, the typed line, the section rhythm - is a multiple of that pitch. Structure is
carried by rules, not cards: a section is a heading over a body with a hairline above it, and a
list of items is a `dl` or `ul` whose rows sit on `border-t` rules.

- **Rhythm**: a strict 4px grid. `--spacing: 0.25rem` pins Tailwind's numeric scale, so `p-6`,
  `gap-6` and `--space-6` are the same 24px. The passbook pitch is 2.5rem (`space-10`).
- **Marketing well**: 72rem (`max-w-6xl`), padded 16px, 24px from `sm`. Sections are `py-20`,
  `py-28` from `sm`, on a 12-column grid from `lg` (heading 8 or 7 columns, aside 4 or 5).
- **App shell**: a rail on `surface-sunken` from `lg` (1024px) up behind a `border-subtle` end
  edge; below that a fixed bottom bar of three tabs plus a _More_ sheet, on solid `canvas`, padded
  by `--safe-bottom`. The content column is capped at `--content-max` (80rem) via `max-w-content`.
- **Chrome geometry is composed**: `--nav-h` 64px, `--subnav-h` 48px and `--impersonation-h`
  (0 when absent) through the chrome utilities; `<html>` carries a matching scroll padding so a
  focused control is never scrolled under the bar.
- **The passbook row**: from `sm` up, one typed line per entry - date, description, amount, and
  the balance-after column on the right behind a 2px `border-panel` spine, each cell separated by a
  `border-subtle` vertical rule. Below `sm` the row becomes a two-column grid (`1fr auto`): the
  description and its date over the amount and balance, the date column hidden, the paper's own
  ruling standing in for the cell rules. Explicit ARIA table roles keep it a table when the CSS
  display changes. The page has both ends: the opening line carries last month's balance in and
  wears the settled mark; the closing line ("Carried forward to April", dated the last day of the
  month) reads its balance from the last line rather than retyping it, and sits over the heavier
  `border-panel` rule that is the foot of the form - the same rule that sits under the column
  headings. When the last entry is planned, the balance carried forward is written in pencil
  like the line that produced it, and the page is not marked.
- **The summary strip**: three typed lines in a `dl`, label at the start, figure at the end, a
  `border-t` rule under each - never three tiles.
- **Three width bands, and nothing improvised between them**. A block states which band it belongs
  to; a screen that names none inherits the shell column and spans it, which is how a row carrying
  four short facts comes to draw a rule across 1150px of nothing.
  - `--content-max` (80rem, via `max-w-content`) - the shell column, and anything that earns it: a
    grid, a ledger, a dashboard of widgets.
  - `--list-max` (56rem, via `max-w-list`) - a single column of list rows. A 1440px viewport leaves
    1156px of usable content width beside the rail, so this band leaves a 260px tail rather than a
    600px one.
  - `--measure` (64ch, via `prose-measure`) - running text of more than one paragraph. It also sets
    the reading leading and the paragraph gap, so it is **not** a width utility and is not used as
    one; a one-line subtitle that wants a cap and nothing else takes `max-w-prose`, which would
    otherwise move off the 2.5rem pitch.
  - **Capped blocks are start-aligned, never centred.** A block takes its band and nothing else, so
    it keeps the shared start edge with the page's `<h1>`; centring inside an already-centred column
    trades one void for two half-voids. The freed tail does nothing, which is the point - it is not
    spanned by a rule.
- **Reading measure**: `prose-measure` caps running text at 64ch and sets the reading leading
  (1.6) and paragraph gap (1.5em). A handful of descriptions cap themselves inline at 60-68ch
  instead (`max-w-prose` is 65ch) and keep the body leading; every cap sits under the 80-character
  ceiling of WCAG 1.4.8, and no running text is uncapped.

### Named Rules

**The Rules-Not-Cards Rule.** A section, a list item or a callout is a heading over a body with a
hairline above it. A card is a slip laid on the paper for content that genuinely needs its own
ground (a chart, a form); it is never the scaffold of a page.

**The On-Pitch Rule.** Anything drawn on ruled paper is a whole number of rules tall. A line box is
a length (2.5rem), not a ratio, and a cell adds no padding the rule did not budget for.

**The Closed-Ladder Rule.** Nothing invents a `z-index`. Eight named rungs (`base` 0, `nav` 30,
`dropdown` 40, `overlay` 50, `modal` 60, `popover` 65, `tooltip` 70, `toast` 80).

**The Focus Reserve Rule.** Nothing clips a focus ring; a scroll container that could crop one
reserves `--focus-reserve` (4px) of padding.

## Elevation & Depth

**Nothing floats at rest.** Depth is the ground ladder (canvas, surface, sunken) and the printed
rules. A slip on the page has an under-edge and nothing more: the resting shadow is a one-pixel
hairline. The four shadows above it belong to things that genuinely leave the paper - a hovered
action, a menu, a popover, a dialog. No glass, no blur, no coloured glow, no hard offset shadow.

### Shadow Vocabulary

- **`--shadow-card`** (`0 1px 0 0 rgb(38 36 32 / 0.08)`): the under-edge of a slip. The only
  shadow a resting surface may carry, and it is a line, not a blur.
- **`--shadow-elevated`** (`0 1px 2px rgb(38 36 32 / 0.08), 0 8px 20px -8px rgb(38 36 32 / 0.18)`):
  the hover step of a filled button.
- **`--shadow-dropdown`** (`0 2px 6px -1px rgb(38 36 32 / 0.1), 0 12px 32px -10px rgb(38 36 32 /
0.22)`): menus, list boxes, the floating-panel treatment.
- **`--shadow-popover`** (`0 2px 8px -2px rgb(38 36 32 / 0.12), 0 16px 44px -12px rgb(38 36 32 /
0.24)`): popovers and tooltips.
- **`--shadow-modal`** (`0 2px 8px -2px rgb(38 36 32 / 0.14), 0 32px 72px -16px rgb(38 36 32 /
0.3)`): dialogs and drawers.

Dark re-declares all five an order of magnitude more opaque (`--shadow-card` becomes `0 1px 0 0
rgb(0 0 0 / 0.5)`), because an 8% shadow is invisible against slate.

### Named Rules

**The Under-Edge Rule.** A resting surface gets a tone and a one-pixel under-edge, never a blur.
If a card needs a shadow to read as a card, its ground or its rule is wrong.

**The One-Pixel Press Rule.** A press is `translate-y-px` and one shadow step down - never a
bounce, never a scale. The control reads as pushed into the paper.

**The Tone-In-Dark Rule.** In dark the grounds separate further and the shadows are re-declared
opaque; a dark value computed from a light one is a defect.

## Shapes

The corners of a cut sheet. Every step is near-square - a slip, a control and a stamp all have the
corner a guillotine leaves - and the steps exist only so a nested inset is one notch tighter than
the sheet around it: `sm` 2px (a badge, a small control, a meter track), `md` 2px (a button, a
field, a menu item, a rail row), `lg` 3px (a floating layer, an inset panel, the table frame),
`xl` 4px (a card, a dialog), `2xl` 4px (a drawer's leading edge). `full` is for things that are
genuinely round - an avatar, a swatch, a switch thumb - and never for a chip, a badge or a panel.

Borders are rules. A one-pixel `border-subtle` rule separates rows and cells; a `border-panel`
rule marks a heavier division (the spine, a column heading, a section between two grounds, the
frame of the current rail row); a `border-strong` rule is the boundary of a control. A place is
marked by a rule or a box, never by a stripe: the current rail row is a one-pixel frame, the current
tab a one-pixel top rule, the selected table row a one-pixel inset frame.

### Named Rules

**The Guillotine Rule.** No radius above 4px on a rectangle. A rounded rectangle is a pill and a
pill is a sticker; the form has neither.

**The Rule-Not-Stripe Rule.** No coloured border wider than 1px on a card, a list item, a callout
or an alert; the spine before the balance column (2px `border-panel`) is the one heavier rule and
it is neutral. A selected or current thing is framed by a one-pixel line, never striped by a bar.

**The Boundary Honesty Rule.** If a box can be clicked or typed into, its border is
`border-strong`. If it cannot, its border is `border-subtle` or `border-panel`. A decorative
`border-strong` is a defect.

## Components

Everything under `src/components/ui` is built on React Aria Components (not Radix) in the shadcn
shape with `class-variance-authority`, and is expressed purely in tokens: no raw hex, literal px
radius or hand-written shadow. Interaction state arrives as data attributes (`data-hovered`,
`data-pressed`, `data-focus-visible`, `data-selected`, `data-disabled`, `data-invalid`). Icons are
lucide only. Every pointer target answers 44x44px through the `target-min` utility, which grows the
hit area with a pseudo-element while the visual box stays on the 32 / 40 / 48px size scale.

### Component guidelines

Every component that renders in more than one place has a section here, written in the change that
makes it shared. A section is prose, not a prop table - the props are in the source, and what the
source cannot say is why one variant and not the next. It names:

- **The shape.** Radius, height, type size and weight, in tokens.
- **The tones, and what each one means.** A tone is picked by meaning, never by colour. A reader
  must be able to answer "which one do I use here?" from the text alone, and the text says what the
  answer is when in doubt.
- **The states** that change the rendering - hover, press, focus, selected, disabled, invalid - and
  which of them the component deliberately does not have.
- **What carries the meaning when the colour does not**, and what survives forced colours.
- **The one thing it is not**: the neighbouring component it would otherwise be mistaken for, and
  the rule that keeps them apart.

**The Second Call Site Rule.** A component used twice is a decision two screens depend on. Writing
it down is part of making it shared, not a follow-up - an undocumented shared component drifts, and
the drift is then defended as deliberate.

### Buttons

Stamps. Square-cornered, typed, pressed one pixel into the page.

- **Shape:** `md` (2px); `sm` at the small size. `icon` (square) and `pill` shapes exist on the
  primitive; `pill` is not used by the shipped surfaces and the radius scale forbids it on a
  rectangle.
- **Sizes:** sm 32px / md 40px / lg 48px visual height at caption / label / body size, weight
  bold.
- **Primary:** `accent` fill, `on-accent` text, `--shadow-card`; hover `accent-hover` and
  `--shadow-elevated`; press `accent-press`, one pixel down, shadow back to card. One per decision.
- **Secondary (the default):** a `border-strong` rule on `surface`; hover darkens the rule to
  `ink-2` and the ground to `surface-sunken`.
- **Ghost:** no chrome until touched - `ink-2` text, `hover` wash. Toolbars, table rows, the
  bottom bar's _More_ tab.
- **Subtle:** a `surface-sunken` fill for an action inside a card.
- **Brand:** `brand` fill. Because `accent` and `brand` share the value, it is visually the
  primary; it exists for the marketing and onboarding call to action.
- **Danger:** `negative` fill; never the resting state of a row action.
- **Link:** `brand` text with a 40%-opacity underline at 4px offset reaching full opacity on
  hover.
- **Disabled** repaints rather than fades: a filled button drops to `surface-sunken` with `ink-2`
  text and no shadow.

**The Pending-Not-Disabled Rule.** A submit in flight uses `isPending`: focusable, `aria-disabled`,
label kept in the DOM under the spinner so the button holds its width.

### Fields

- **Style:** `surface` ground, `border-strong` rule, `md` radius (2px), 40px at the default size,
  label typography. The label is always visible; a placeholder is never a label.
- **Hover** darkens the rule to `ink-2`; **focus** moves it to `brand` and draws the ring.
- **Invalid** moves the rule to `negative`; the error renders below, wired by `aria-describedby`,
  with an icon and a message. **Disabled:** `surface-sunken`, `ink-2`, `not-allowed`.
- **How an error is shown.** A caller passes the sentence as `errorMessage` and nothing else: every
  field in `components/ui` turns a non-empty `errorMessage` into the invalid state through
  `resolveInvalid` (`field.tsx`), so the message renders and the control carries `aria-invalid`
  (WCAG 3.3.1) without a matching `isInvalid` at the call site. `FieldError` renders only on an
  invalid field, which is why a message with no invalid state is invisible. An explicit `isInvalid`
  wins either way; the function form of `errorMessage` reads native validation and does not decide
  validity. Compute the message from state (`hasTriedToSubmit && trimmedName === ''`), so it clears
  when the value is fixed: a message passed unconditionally is shown unconditionally. A notice that
  is not an error (a limit reached, a hint) is not an `errorMessage`; where one already is, pass
  `isInvalid={false}`. A new field component takes the same `errorMessage` and `isInvalid` pair and
  hands its container `isInvalid={resolveInvalid(isInvalid, errorMessage)}`.

### Select and ComboBox popover

- **The shape.** The listbox panel is at least as wide as its trigger, grows to its longest option
  (`w-max` over the base `Popover`'s `min-w-(--trigger-width)`), and is capped twice:
  at the viewport minus the 12px edge padding React Aria keeps on each side, and at an absolute
  `32rem` (`max-w-[min(calc(100vw-1.5rem),32rem)]`, the identical literal in `Select` and
  `ComboBox`). Being in `rem` it scales with text size, so the 1.4.4 / 1.4.10 behaviour does not
  change. A trigger wider than the bound keeps its own width: the floor wins over the cap, so the
  bound only limits how far the panel grows past the trigger. The bound is measured, not guessed:
  `e2e/narrow-viewport.spec.ts` fails when a fixed option (the Polish dashboard period options are
  the longest) wraps or clips, and `32rem` is raised only if it does.
- **Why not the trigger's width.** A trigger is sized for the value it shows, not for the longest
  option: pinning the panel to it ellipsised the Polish dashboard period options at 360px
  ("Poprzedni mie...", #559). Both primitives carry the identical rule, so a call site never picks
  a width.
- **A `ComboBox` panel follows its filtered list.** Its floor is the trigger's width and its start
  edge stays anchored to the trigger, so while a person types only the far edge moves and no option
  text shifts; the "no matches" state sits at the trigger's width. Holding the width stable would
  need a measuring effect the popover deliberately avoids, and pinning it to the trigger would bring
  #559 back. A browser case therefore asserts a range (never narrower than the trigger, never wider
  than `min(viewport - 24px, 32rem)`) after every keystroke and never that the width is constant.
- **A label past the bound wraps** (`break-words` on the label span in `ListBoxItem`) instead of
  ending in an ellipsis: it is the only choice every input method can read, since a `title` is not
  reachable from the keyboard (a `ComboBox` option never takes DOM focus) or by touch. Rows that
  fit keep one line; the row grows with its label (`shrink-0`, because the listbox is a column flex
  container with a max height), and the check mark and trailing meta keep their size
  (`shrink-0`) and centre against the wrapped text. A row only gets taller past the bound, and the
  target-size minimum is a minimum height, so 2.5.8 holds.
- **Known limits.** `100vw` includes a classic scrollbar on desktop, and `1.5rem` equals the 12px
  edge padding only at the default root font size. The `32rem` bound makes both moot on wide
  screens. At 360px the cap is `100vw - 1.5rem`, so a root font size below 16px (say 12px, 18px
  instead of 24px) lets the panel overrun the 12px edge padding by up to 6px, and a larger one
  makes it narrower than it could be, which only wraps sooner. They are left documented rather than
  fixed with a measuring effect.
- Keyboard navigation, selection and focus return to the trigger are React Aria's and are
  untouched.
- **The one thing it is not:** `Menu`, whose popover is not tied to a trigger width at all.

### Menu

- **The shape.** A column of 44px-minimum rows inside the base `Popover`, at least `11rem` wide
  (`min-w-44`) and not tied to a trigger width.
- **The height rule.** A menu sets no height cap of its own. The `Popover` is a column flex
  container and React Aria writes the room left in the viewport onto it as `max-height`, so a menu
  that fits is never a scroll container, and one that cannot fit (a short landscape phone) shrinks
  to that room and scrolls. The old fixed `max-h-80` (320px) hid the eighth row of an eight-item
  menu at 44px a row (`--target-min`) and made the menu a scrollable region with no focusable content while a
  submenu held focus, which axe reports as `scrollable-region-focusable` (#728). A new cap on a
  `Menu` brings both back: change the number of items, not the cap.
- **Reaching the last row.** Every item is reachable from the keyboard (arrows, `Home`, `End`,
  type-ahead) and React Aria scrolls the focused row into view, so the scrolling case stays
  keyboard-complete. `e2e/menu-height.spec.ts` asserts all of it in a browser at 360px and 1280px,
  with a submenu open, and in a viewport too short for the menu.
- **Known limit.** The axe guarantee holds while the menu fits. In a viewport too short for it
  (about 280px, a landscape phone or 400% zoom) with a submenu open, the parent menu scrolls again
  with every item at `tabindex="-1"`, and axe's `scrollable-region-focusable` can return; the
  keyboard path stays complete because `Escape` closes the submenu.
- **A long submenu grows to the viewport.** A submenu with many entries (the category tree's "Move
  to") is no longer cut at 320px; it takes the room React Aria leaves it, then scrolls.
- **Every `Popover` is a column flex container.** The rule above lives in the base `Popover`, so
  `Select`, `ComboBox`, `DatePicker` and `PopoverDialog` share it; their children stretch to the
  panel width and only a child that already scrolls (`ListBox`, `Menu`) shrinks.
- **The one thing it is not:** a `ListBox` or a `Select`, which hold values and keep their own
  `max-h-72` (`ListBox`).

### Toast

- **The shape.** One `ToastHost`, mounted once in the app shell. Every toast carries a close
  button; the copy is the caller's `closeLabel` (`action.close`, EN + PL), never a default string
  and never an icon-only control without a name.
- **The close-button rule.** The button is a real 44x44 box (WCAG 2.2 §2.5.5, `docs/ACCESSIBILITY.md`
  §3.4) pinned inside the toast's inline-end top corner, so the whole box is on screen at 360px and
  never overlaps a neighbouring toast. The 20px chip is drawn by `::before`; the glyph is
  `aria-hidden` and the button's `aria-label` is its only name, which is what keeps axe
  `role-img-alt` and `target-size` quiet. The toast's content carries `pe-8` so text never runs
  under the box.
- **Why the classes are important.** Sonner's stylesheet is unlayered and beats Tailwind utilities,
  so the toast surface, layout and text use local `!` utilities to apply the product tokens:
  `surface-raised`, `border-subtle`, `rounded-lg`, `p-3.5`, `ink` and `ink-2`. Sonner keeps its
  positioning and animation rules. The close button's size, position and transform also use `!`
  utilities. `left` and `right` read the
  opposite direction variable, which puts the box at the inline-end edge in LTR and RTL alike.
- **Focus.** The product's `focus-ring` outline is drawn around the whole 44px box; sonner's faint
  box-shadow is switched off.
- **Contrast.** The chip's edge is `border-subtle`, a decorative edge below 3:1 by design; the glyph
  (`ink-2`, forced with `!` like the rest; measured 8.6:1 in light and 8.1:1 in dark on the chip, #730) carries the 1.4.11 contrast.
- **A toast action.** No toast has an `action` or `cancel` button today. If one is added it must
  not sit in the top 44px of the inline-end corner, which the close box owns.
- **Verified by:** `src/components/ui/__tests__/toast.test.tsx` (name, hidden glyph, classes) and
  `e2e/toast-close-button.spec.ts` (measured box, axe, EN, PL and RTL, 360px and 1280px, both
  themes, keyboard).

### Focus

One treatment product-wide, drawn outside the control: a 2px `focus-gap` band (a `box-shadow`)
then the 2px `focus` ring (an `outline`, which no `overflow: hidden` can crop). The ring is the
stamp ink - the same value as `brand` - so the gap is what keeps it visible on a violet fill. It
measures 8.94:1 on sunken in light and 7.43:1 on raised in dark. `outline-solid` is load-bearing
and `outline-none` never appears beside it.

### Cards

A slip laid on the paper, for content that needs its own ground. Not the scaffold.

- **Corner:** `xl` (4px); the inset variant `lg` (3px).
- **Default:** `border-subtle` rule on `surface` with the one-pixel `--shadow-card` under-edge.
- **Inset:** `surface-sunken`, no rule - a panel nested in a card.
- **Brand:** `brand-soft` ground behind a 25%-opacity brand rule - an invitation or an upsell.
- **Dashed:** a dashed `border-strong` at 60% on transparent - "create something here".
- **Padding:** 16 / 20 / 24px.
- **Header:** a `subtitle` heading in the hand at a caller-chosen level, then a `caption`
  description, with a trailing action slot. There is no eyebrow.
- A card is not interactive; a clickable card is a `Button` or `Link` wrapping a card.

### Empty state

The designed "nothing here yet" state, and the one owner of it: `EmptyState` is the dashed card
with a message in it. Every list has one, so a person's first screen in an empty workspace is
a sentence that says what to do, not a blank.

- **Container:** the dashed card (Cards, above) at `lg` padding, 24px at the sides and 40px
  vertical, centred, with a 12px gap.
- **Medallion:** a 44px round `surface-sunken` disc with a 20px glyph in `ink-2`. The icon is
  `aria-hidden` and never carries a word the copy does not say.
- **Heading:** `subtitle` (700, 20px) at a caller-chosen level - it is a card title, not a page
  title, so on a screen whose `<h1>` is `title` the two must not share a step.
- **Description:** `body` in `ink-2`, capped at the measure.
- **Actions:** one `primary` at the default size, and at most one `secondary` beside it. There is
  no `size` prop and no second size.
- **Needs more?** A surface that wants to offer more than two actions - a choice of kind, say -
  does it in a sibling section under its own sub-heading, never inside the card. `/accounts` (three
  kind shortcuts) and `/budgets` (two) are the examples: a labelled `<section>` below the empty
  state.
- **It is not** a `brand` card (an invitation or an upsell on a page that has content) and not
  `ErrorPanel` (something went wrong). An empty list with a filter on is the same state with the
  filter's own copy.
- `src/components/ui/__tests__/empty-state-ownership.test.ts` fails when `variant="dashed"`
  appears outside `src/components/ui`.

### Error panel

What replaces a region, or the page, when something did not work. `ErrorPanel` is the frame and
`FailurePanel` chooses what goes in it: it reads the failure envelope and offers the recovery its
failure kind calls for, so a screen never invents its own way out. Both live in
`src/components/app/shell/`. `RouteError` is the same idea for a whole page.

- **The shape.** A default card (Cards, above) at `md` padding with a 12px gap, `xl` radius and the
  one-pixel `--shadow-card` under-edge, its rule repainted from `border-subtle` to the tone at 30%
  opacity (`border-negative/30`, `border-warning/30`). A 32px round disc in the tone's `-soft` wash
  holds a 16px triangle glyph in the tone's ink; the disc is round because it is a glyph, and
  nothing else about the panel is. The heading is `subtitle` at semibold in `ink`, an `h3` unless
  the caller says `h2` or `h4`; the sentence under it is `body` in `ink-2`. Actions wrap below: Retry
  and the way back to the dashboard are `secondary`, the link to billing is `primary`. `RouteError`, the page-level
  failure, is a frame of its own: a centred `rounded-xl` card on `border-subtle`, a 48px disc, an
  `h1` in `title`, a `primary` Retry, and it keeps the `warning` glyph it shipped with. That is the
  one fault that is not `negative`, recorded here and not changed.
- **The tones.** `negative` is a fault: something broke and nobody did anything wrong. `warning`
  is a limit the reader can act on: the workspace is at a quota or the feature is not in its plan.
  `negative` is the default. A call site does not pick a tone for a failure: `FailurePanel` derives
  it from the recovery, so `warning` appears only on the `quota` and `feature_locked` recoveries
  and every other one is `negative`. A reader asks "did the product fail, or did it decline?"; when
  it is hard to say, the answer is `negative`. The four recoveries are `retryable` (Retry, beside
  the form and never instead of it, so input survives), `quota` (a link to billing and the metric
  that was reached), `feature_locked` (a link to billing and nothing else) and `internal` (the
  sentence, Retry when the caller has one, a way back to the dashboard where the reader is known to
  be signed in, and a reference). `not_found` and `forbidden` share the `internal` recovery on
  purpose, so the screen never offers a different way out (the sentence still differs) for a missing row and a foreign one
  (`RECOVERY_OF`). The sentence is the envelope's own catalogue key, so two failures of one kind
  read the same, and no recovery shows a plan name or an amount.
- **The states.** It has two placements, `after-action` and `in-place` (the alert-versus-region
  rule below), and Retry has a pending state (the Pending-Not-Disabled Rule). It does not have
  hover, press, selected, disabled or invalid: a panel is not interactive, only its buttons and
  links are, and each answers with its own states and the 44px hit area. It has no dismiss and no
  timer, so it stays until the failure is gone or the reader leaves. The heading takes focus
  programmatically and is never a tab stop, so like `<main>` it draws no focus ring.
- **What carries the meaning without colour.** The heading and the sentence. The glyph is
  `aria-hidden` and the tone is reinforcement, never the signal (Colour Is Never Alone). The title
  says what did not happen and the body says whether anything was changed, which is the sentence a
  reader of a finance app needs first. Under forced colours the panel is a bordered card with
  text, so the text and the rule survive; no forced-colours capture of it has been made.
- **The one thing it is not.** An `EmptyState` (nothing here yet, which is not a failure) and a
  toast (transient, and it cannot hold a recovery). A failure that needs a way out stays on the
  screen and carries its action. A panel is not a place to show what went wrong in a developer's
  words either.

**The Alert-Versus-Region Rule.** `placement="after-action"` is the result of something the reader
just did, so it is `role="alert"`. `placement="in-place"`, and `RouteError`, are the content of a
page or a block that failed to load on arrival, so they are a region labelled by their heading:
an alert on initial render is announced before the person has any context for it. The heading is the
first element inside the alert.

**The Focus Rule.** Only an after-action panel moves focus, to its heading, so a keyboard reader
lands on the explanation and Retry is the next tab stop. An in-place panel never moves focus.
`RouteError` moves it only when it mounts after the document's first render, because on the first
render the browser has already placed focus on the document and the skip link must stay the first
tab stop. A panel that held focus when it goes away, after a successful Retry say, gives it back to
the enclosing dialog or else to `#main-content`, never to `<body>` (`useFocusHeading`).

**The Tab-Title Rule.** An error surface never writes `document.title`. The router runs `head()` for
the failed match as well, so the tab already carries the failed route's own title, and an imperative
write would compete with the rendered `<title>` and outlive a successful Retry.

**The Reference Rule.** No code renders an error's message. `ErrorPanel` and `FailurePanel` have no
`detail` prop and no `<details>` (#718 removed both), `title` and `body` are catalogue copy, and
`failure-message-guard.test.ts` fails on a file that reads a thrown error's text back in. The only
free-form string the panel is given is a `reference`, which is an event id or a request id and
nothing else: the panel drops anything that is not 8 to 64 letters, digits, `_` or `-`, but the
shape narrows a string and does not prove it is not an amount, so the producer passes an id and
never a value of its own.

The guideline states no conformance level and widens none: the claim is `docs/ACCESSIBILITY.md` §1.

### Badges

A word with a run of pen behind it. Every badge, in every tone, is the pen mark (`mark-pen` in
`app.css`); there is no boxed badge (`docs/adr/0028-the-mark-is-the-badge.md`).

- **Anatomy.** Text, always, typed in `ink` in every tone - the hue lives only in the wash. Behind
  the word a run of the tone's pen at 75% opacity: past both ends of the word (`0.25ch` before it,
  `0.75ch` after it) and further where the pen lifted, pooled darker at its trailing edge, and a
  small blob where the pen paused a further `0.25em` out. It sits on the baseline of the line it
  belongs to, because a highlighter is run over a line, not placed above one. The bleed is part of
  the element, so a badge needs room **beside** it, never padding inside it: every badge carries
  `1.25ch` of trailing room (`me-[1.25ch]`) - its own `0.75ch` trailing bleed, the next badge's
  `0.25ch` leading bleed and `0.25ch` of paper between them. That is the minimum inline gap, owned
  by the badge rather than by each call site, and it is also what keeps a cell's end edge from
  shearing the run. A container that clips it gets room, never a smaller bleed.
- **Flat and rough.** The pen's outline is roughened by `#mark-pen-rough`, the one SVG
  displacement filter in the product (mounted once in `__root.tsx`). That filter costs a whole
  60 Hz frame of raster on a screenful of marks, so every tone that repeats down a table or a tree
  wears `mark-pen-flat`: the wash, the bleed, the pooled edge and the blob stay, and only the
  roughness goes. `settled` alone keeps the rough outline, because it stands alone: once, on the
  landing. Which marks are flat is decided by the tone, not by the size - `sm` is not a synonym for
  "repeats", and the landing's stamp is `sm`.
- **Tones**, picked by meaning, never by colour. `neutral` when there is no verdict and no status
  either - a classification, a kind, a name. `info` for a status with no verdict ("Hidden",
  "Planned", "Auto"). `positive`, `negative` and `warning` for a verdict, each in its own pen.
  `brand` for the rare badge in the product's own voice, which would follow a rebrand. `settled`
  for what is settled, and only that - the `highlighter` wash, the one badge that spends the stamp
  violet, never on a planned line. **When in doubt the answer is `info`.** Two pairs render
  identically, and that is recorded rather than hidden: `neutral` and `info` share one pen, because
  `info` is `ink-2`'s value and the difference was only ever the weight of a rule; `accent` is an
  alias of `brand` and shares its pen, because `accent` is `brand`'s value. The names stay, because
  the call sites mean different things by them.
- **Sizes.** Two, and no more, with the box metrics the stamp always had. `sm` - 20px, `micro`,
  uppercase, `tracking-label` - inside a dense row or a table cell. `md` - 24px, `caption` - beside
  a heading or in a card. Both at the bold weight, at `sm` radius (2px).
- **States.** None. A badge is not interactive: it takes no hover, press, focus or selected
  rendering, and a row's hover wash does not reach it because it has a ground of its own. A badge
  that can be clicked is a `Button` with `shape="pill"`, which is how it gets a focus ring and a
  44px hit area.
- **Accessibility contract.** The word is the meaning and colour is never alone
  (`docs/ACCESSIBILITY.md` §2.1) - structurally, since the word is `ink` in every tone. `ink` clears
  7:1 on every wash composited over `surface` and `surface-sunken`, in both themes; the pooled
  trailing edge carries no glyph (measured at both sizes) and is a graphical object held to 3:1.
  Both are asserted on the composite, not the token, in `tokens-contrast.test.ts`. Under
  `forced-colors: active` the wash is dropped and every tone, `settled` included, draws a
  one-pixel `CanvasText` rule instead, so the badge stays an element beside a table's other text
  rather than a bare word. The rule is the badge's own border, transparent until then, so forced
  colours cost no layout shift. The mark is static; `prefers-reduced-motion` has nothing to reduce.
- **When not to use one.** For a count (a number in type), for an amount (`formatMoney` with a
  sign), for anything clickable (a `Button`), or to repeat a word the row already says. A category
  carries its series colour as a dot beside its name, not as a badge; the colour is never the only
  identifier.

On the landing the `settled` stamp stands once, beside the passbook's opening line, on the baseline
of the word it follows, the wash crossing the printed rule the way a pen does; on the narrow page it
is the second line of the opening entry.

### Tables

The passbook inside the app. A `border-subtle` frame at `lg` radius on `surface`; a sticky header
band on `surface-sunken` in micro uppercase `ink-2`; cells separated by `border-subtle` vertical
rules and rows by `border-subtle` horizontal ones, cell padding 12 / 10px. Hover paints the `hover`
wash. **Selection** paints `brand-soft` plus a one-pixel inset frame in `brand`
(`inset 0 0 0 1px`): a box, not a bar. Amounts are end-aligned and tabular.

### Reorderable tree

A two-level list of rows that a person can put in order, by dragging **and** by keyboard. Two
screens draw one: the category tree (`CategoryTree`) and the account group tree (`GroupTree`).
They share the arithmetic in `#/components/app/tree` and nothing else; each builds its own menu,
because what a row can do differs (a category archives, a group deletes).

- **Shape:** one flat `GridList` in reading order, never nested lists, so arrow keys travel
  linearly. A child row is indented one step (`ms-6`) and carries a corner arrow; a row an
  account sits on (group tree only) is indented one more. Row, radius and padding are the
  `GridListItem`'s. The drag handle and the menu trigger are `ghost` icon buttons on the 44px hit
  area (`target-min`), also on an indented row at 360px.
- **Both paths ship together.** Every gesture the pointer can make is a menu item built from the
  same pure move functions: _Move up_, _Move down_, _Move to top_, _Move to bottom_, _Move to…_
  (which re-parents). Neither path is the fallback for the other, and a keyboard drag and the
  matching menu item must produce the same move; a component test holds that.
- **Names say where a row is.** A child row's accessible name carries its parent ("Trips, inside
  Joint") because the indent says nothing aloud; the drag handle and the menu trigger are named
  after their row, and their parent for a child.
- **Account membership is menu-only.** An account row in the group tree offers _Move to…_ and
  _Remove from this group_, acting only on that row's membership. Destinations include their parent
  and the current group stays disabled. Focus follows the account into the target group, or the
  next surviving row after removal (previous when last, then the create button). Success is
  announced politely; account rows never gain a drag handle.
- **Disabled, never hidden, and the reason is written.** An item that would change nothing, or
  that the one-level rule forbids, stays in the menu disabled. The group tree also writes the
  reason as the item's description ("Already first", "A sub-group cannot have its own
  sub-groups"), painted under the item at full contrast (only the label dims) and wired as its
  description, so the reason does not depend on a tooltip. Arrow keys skip a disabled item, so it
  is reached by a virtual cursor and by sight; the category tree disables the item without a description yet.
- **Drop and focus rules.** A drop lands _beside_ a row, never on it, and the dropped row takes
  that row's parent: one rule, no nesting-by-hovering. Rows that are not part of the order
  (accounts inside a group) are not drop targets - the target is cancelled, so no indicator is
  drawn and a keyboard drag skips it - and cannot start a drag. The group tree offers each
  boundary between two rows of a run once, as _before_ the later one (the target is also cancelled
  for a dragged group that has children when the target is a sub-group, which the one-level rule would
  refuse); _after_ exists for the last
  row of a run only, and its indicator is drawn directly under that row. For the last top-level group, which
  has its accounts beneath it, that reads as "inside" - a known limit of a row-based indicator and
  the reason the menu is not optional. After a move, a rename or a create, focus stays on (or goes
  to) the row; after a delete it goes to the next row, then the previous, then the screen's create
  button.
- **In the group tree a menu move is said aloud, politely:** "Business moved to position 2 of 3", qualified by the
  parent for a child. A drag has React Aria's own announcements.
- **A refusal is a sentence in an always-mounted `role="alert"` region** above the tree, and a
  toast is for what succeeded. The group tree chooses its sentence from the catalogue by the kind
  of failure and never prints the server's message.
- **Non-colour meaning:** the row's kind or count is a word or a number beside the name, never a
  hue alone.
- **It is not** a data table (no columns, no sort) and not a `ListBox` (a menu of values to
  choose from): its rows are things with an order, and the order is the data.

### Forecast panel

Spent this year, rest of this year, next twelve months — three amounts for a recurring series, or
the same three rolled up per currency on `/recurring`. The second call site is the series detail.

- **The shape:** a `Card` (`lg` padding) with a subtitle heading, a caption in `text-caption` /
  `ink-2`, then a `dl` whose columns follow the card's own width
  (`grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]`, never a viewport breakpoint: the panel sits
  in a ~490px column at 1280px and a full-width card at 360px, and three six-digit amounts touched
  under `sm:grid-cols-3`). Each metric is a `dt` in caption `ink-2` and a `dd` in subtitle,
  semibold, tabular, `break-words`. One currency per block; a second currency is a second block,
  never a converted total.
- **What it counts:** expense series and expense links only. `amount_minor` is never negative, so
  an income series (or a refund linked by hand) is a direction, not a negative spend; an income
  series shows no panel. `/recurring` rolls up every series whatever its list filter, because a
  paused series' spend still counts.
- **The tones:** none. These are plan figures, not alerts. Overdue copy lives on the series card
  and _Due soon_, not here.
- **The states:** resting only. There is no empty colour wash; an empty rollup is a sentence
  (`recurring.forecast.empty`).
- **What carries the meaning when the colour does not:** the three labels, and a visually-hidden
  table of the same three cells so a screen reader gets tabular data rather than three adjacent
  paragraphs. The clip (`sr-only`) sits on a wrapper `div`, never on the `<table>`: a table lays
  out by its content and ignores `width: 1px`, so it widens the page at 360px. Amounts are formatted by `formatMoney`; they never become a float in the panel.
- **It is not** a chart (no SVG, no second encoding) and not _Due soon_ (that list is periods you
  act on). This panel is a year view of integer sums.

### Period actions

The buttons on one row of a recurring period, drawn by one component wherever a period is listed:
the series detail grid and _Due soon_ on `/recurring`.

- **The shape:** the `sm` button, end-aligned in its cell with a 4px gap. _Mark paid_ is `subtle`
  (the one action a row is for); _Skip_ and _Undo_ are `ghost`.
- **Which buttons:** a function of the period, never of the surface. An unsettled period gets _Mark
  paid_ and _Skip_; a paid or skipped one gets _Undo_ alone. A surface fed only unsettled periods
  passes no `onRevert`, and a settled period handed to it draws nothing.
- **A cell with no room to spare:** from `sm` up `compact` stacks the buttons and lets a long label wrap
  onto a second line rather than widening the column (below `sm` see _Reflow_). _Due soon_ uses it so the 30rem rail never scrolls sideways
  (`e2e/desktop-density.spec.ts`); the series grid keeps the buttons on one line.
- **The states:** the ordinary button states. There is no hover-only affordance - every action is a
  `<button>` reachable by Tab in reading order.
- **What carries the meaning when the colour does not:** the label is a word, and the accessible
  name starts with it and then carries the row's due date (_"Mark paid, period due 1 March"_,
  _"Skip, period due 1 March"_, _"Undo, period due 1 March"_), so voice control's "click Mark paid"
  finds the button (WCAG 2.5.3) and a column of identical labels is still not three identical
  announcements. A surface that mixes series (_Due soon_) also passes the series name
  (_"Skip, period due 1 March, Rent"_), since two bills can fall due on the same day. The Polish
  names follow the same order (_"Pomiń, termin 1 mar 2026, Czynsz"_).
- **Where focus goes when the row changes (2.4.3):** the pressed button is replaced or its row is
  gone, and focus would fall to `<body>`. It moves only after the dialog has closed and only while
  focus is lost, so a cancelled dialog's own restore-to-trigger is left alone.
  - _Due soon_, after Skip or after a save from the dialog, once the refreshed list has rendered:
    the _Mark paid_ of the row now at the removed row's position, the new last row's when the last
    one went, or the _Due soon_ heading (`tabIndex={-1}`) when the list is empty.
  - The series grid, after Skip, a save or Undo: the replacement button in the same row (_Undo_
    after Skip or a save, _Mark paid_ after Undo).
  - The `?markPaid=` reopen path has no trigger, so closing the picker without a save focuses that
    period's _Mark paid_ if the row is still listed, otherwise the heading; with a save the rules
    above apply.
- **The mark-paid dialog says what it is doing (4.1.3):** one visually hidden `role="status"`
  region, mounted on the dialog's first render, announces loading, then the candidate count
  (plural machinery) or the empty copy, and nothing on a failure because the error panel is an
  alert. The visible loading line is hidden from assistive technology.
- **The series link in _Due soon_** carries the claimed target size on both axes (`target-min-h`,
  `target-min-w`, vertically centred `inline-flex`); the `sm` button keeps its size.
- **Reflow:** from `sm` up both tables are tables and scroll sideways in their own region. Below
  `sm` each row stacks into a block, so Mark paid, Skip and Undo are reachable at 360px without
  scrolling (#543): the due date opens the block, every other cell is a line with its column
  label on the start side and its value on the end side (a long value, such as a series name,
  wraps), and the actions are the last line, end aligned and always on one row (`compact` only
  stacks the buttons from `sm` up). Every layout change is scoped below `sm`, so nothing changes
  at `sm` and above. The shared classes and the self-labelling
  cell are `stacked-table.tsx`.
  The liability schedule (`/loans/$loanId`) is a second call site of both: the same classes, its
  scroller a focusable named region, and `useRowFocusRecovery` returning focus to the schedule
  (the heading when the saved row has no button left) after a mark-paid save.
  - _Semantics survive the `display` change:_ the table, both row groups, rows, column headers,
    the due-date row header and cells carry their `role` explicitly, with `<caption>` and `scope`
    kept, because a non-table `display` can drop a native role in some browser and screen reader
    pairs.
  - _The header row is `sr-only`, not `display: none`,_ and the label printed in each cell is
    `aria-hidden` and comes from the column header's own catalogue key, so the column header is
    announced once. A cell with nothing to say on a row (the difference of an unsettled period)
    prints no label and stays in the row.
  - _Not done:_ a row menu, a sticky actions column, another component in place of the tables.
- **The one thing it is not:** a row menu. The actions are visible buttons on purpose; burying
  _Mark paid_ behind a menu adds a click to the only thing the table is for.

### Mode switch

The control that moves between two addresses of one screen: _Recorded_ and _Planned_ on the
transactions screen. It is the `SegmentedFilter`, so it takes that component's shape: a radio group
on a `border-subtle` rule, 44px segments, the current one marked by a one-pixel `brand` rule along
its top edge and `brand` text at the heavier weight.

- **The tones:** one. There is no emphasis between the two modes; the current one is marked by
  position and weight, not by a fill.
- **The states:** hover washes the text to `ink`; focus is the product ring; there is no disabled
  state, because both modes are always reachable.
- **What carries the meaning when the colour does not:** `aria-checked`, the weight and the rule.
  The group is one tab stop and the arrow keys move and select.
- **The one thing it is not:** a navigation entry or a tab bar. A mode is not an area, so it adds
  nothing to the navigation table; and there is no panel under it to switch, only a list whose
  address changes with the filters carried across.

### Meter

An 8px track at `sm` radius in `border-subtle` (so the fill's stop is readable against it), the
fill in `positive` on track, `warning-bold` near the limit, and red over it; past 100% the fill runs
hatched as well as red. _Which_ red follows the adjacency, and every meter works it out the same
way. `over` means the ratio passed 1, which clamps the fill to the whole track, so `AmountMeter`
and `BudgetMeter` take `negative-bold` against the card. `ui/Meter` takes its threshold from a
`dangerAt` prop and reads it: at `>= 1` its danger fill is full too and takes the same grade, which
is the case both callers that exist are in, so one over-limit verdict reads in one red. Below 1 the
fill can stop on the track and keeps `negative`, the grade with the margin against `border-subtle`.
The danger icon is a 14px glyph and stays on `negative` either way. The headline beside it is the
remainder, and `negative-bold` too
when it is an over-by, because bold at 20px or 32px is large text and is not held to the 7:1 floor.
The state is carried by a word and a lucide icon before colour.

The caution fill has no adjacency to work out, because `warning-bold` clears 3:1 against the track
and against the card alike. The fill usually stops short on the track, but `ui/Meter`'s warning band
can run the whole width when `dangerAt` is above 1, since danger is then unreachable. Either way
`BudgetMeter`'s `approaching`, `ui/Meter`'s warning band and `GoalMeter`'s `overdue` take
`warning-bold` unconditionally, and one caution verdict reads in one amber. That grade is a fill
and nothing else — no headline is ever a caution tone, the verdict word and the 14px triangle keep
`warning` at 7:1, and a caller that wants loud caution TEXT has to re-measure the token at 4.5:1
first. What the 3:1 floor bought differs by theme and is measured rather than assumed: dark gets
full chroma at nearly the old weight, light has to lighten to get any (`src/styles/tokens.css`).

### Liability meter

The share of a borrowing's imported schedule that is already linked to a transaction, drawn with
the `AmountMeter` shell on the list card and again as the detail hero (`md` / `lg`). The
**headline is remaining**, not paid: that is the number somebody acts on. Paid-of-total sits in the
caption. Overdue changes four channels before colour: the word _Overdue_, the warning triangle, a
hatched fill, then `warning-bold`. Settled uses a check and a hatched positive fill. Remaining of zero is
_Schedule paid_, never `0,00`. `aria-valuetext` names paid, remaining and the percentage, never a
bare percent. The list and the detail share this component; inventing a second bar on the detail
would be two opinions about the same money.

### Charts

The forms drawn by the primitives in `src/components/charts` wherever a trend or a breakdown is
shown: line and area, bar (stacked and grouped), donut and sparkline. They are hand-rolled SVG, not a
chart library (`docs/adr/0007-hand-rolled-accessible-charts-over-a-chart-library.md`). The ADR
states what a chart owes and the primitives carry it out, so this section does not restate either;
it says which form to pick and what carries the meaning when the colour does not. A chart takes its
data, locale and copy as props, never fetches, and uses the series hues of _The category series
palette_.

- **The shape.** One `ChartFrame` around every form: an `<svg>` authored at the container's measured
  pixel width, so an axis label keeps its size at every breakpoint instead of scaling down with the
  drawing. Gridlines and axis rules are `border-strong`, tick labels are `ink-2` text, and the zero
  rule is drawn heavier than the gridlines.
- **The forms, picked by meaning.** The sparkline is a trend at a glance, with no axes and no
  legend. The line (or area) chart is readings over time. The bar chart compares periods; stacked
  takes non-negative parts of a whole only, and a net figure that goes both ways belongs in the
  grouped layout or the line chart. The donut is the parts of one total; slices that are a
  negligible share fold into one _Other_ slice whose contents stay reachable behind a button.
- **What a chart owes.** ADR 0007 requires a text table, keyboard-reachable points, a non-colour
  encoding per series and a reduced-motion path, and the primitives provide them. The text table is
  the one enforced at the type level: `ChartFrame` takes `dataTable` as a required prop, so a chart
  without one does not compile. The other three are provided, not type-enforced:
  keyboard-reachable points (one `Tab` stop per series, arrows along it, `Home` and `End` to the
  ends, each point named with its full unabbreviated amount); a non-colour encoding per series; and
  a reduced-motion path, where the only animation is an entrance fade behind `motion-safe:`.
- **The tones.** There is no tone to pick. A series takes its hue, marker shape, dash pattern and
  fill pattern from its position in the array, so the same data drawn twice is encoded the same way
  both times. The sparkline is one series with no legend and relies on the in-place labels on its
  lowest and highest readings.
- **The states.** Empty is a designed state: the axes stay on screen and the message sits over them,
  so the layout does not jump when the first reading arrives. A missing reading is a gap, drawn as a
  break and written in the table as a word, never as zero. A focused point is described as text
  under the plot rather than in a floating tooltip, because a tooltip that follows focus can cover
  the focus indicator.
- **What carries the meaning when the colour does not.** The series name in words, in the legend, in
  the table and in each point's accessible name, plus the marker, dash and fill patterns. The hue is
  an additional channel on a chart, never the only one, and a series colour is never text. See _The
  Colour-Is-Never-Alone Rule_.
- **The one thing it is not:** `Meter`, which shows one figure against a limit and says its state in
  a word and an icon. A chart is a set of readings, and every amount it draws or names is an integer
  in minor units formatted through `chartAmount` (`docs/MONEY.md`).

### Navigation

- **Rail (from `lg`):** rows of label size with a lucide glyph, `ink-2` at medium weight, `hover`
  wash on hover. The current row is `surface` inside a one-pixel `border-panel` frame with its
  glyph and label in `brand` at the bold weight, plus `aria-current="page"`. The frame is a
  transparent border on every row so nothing moves by a pixel on navigation.
- **Bottom bar (below `lg`):** four 64px cells - three destinations and _More_ - glyph over a
  caption label. The current tab carries a one-pixel `brand` rule along its top edge and its
  glyph and label in `brand` at the bold weight. Solid `canvas` ground, `border-subtle` top rule,
  never a blur.
- The _More_ sheet is the product's `Drawer`; there is no swipe.

### Dialogs and drawers

`surface-raised` (the one pure white) with `--shadow-modal`; a centred dialog at `xl` (4px), a
bottom drawer at `2xl` on its top corners, a side drawer at `2xl` on its leading edge. Header and
footer are separated by `border-subtle` rules with 20 / 16px padding. Entrances are transform and
opacity only.

### Signature: the typed line

The unit the whole world is built from (`TYPED_LINE` in `src/routes/-ui/ledger-preview.tsx`). A
2.5rem line box in the typewriter at label size, baseline 3px above the printed rule by a translate,
no vertical padding, the rule drawn as an inset one-pixel shadow on the cell's last pixel row. On
the wide page every entry is one such line: date in caption `ink-2`, description in `ink` with its
category after a middle dot in `ink-2`, amount end-aligned in its tone, and the balance-after column
behind the 2px `border-panel` spine. The opening balance is a line with no amount, and it wears
the settled mark. The closing line carries the last balance forward under the heavier
`border-panel` rule that is the foot of the form; it reads that balance, it does not retype it,
and when the last entry is planned the carried-forward figure is pencil too. A planned line is
the same line in `ink-2` with the word beside it.

### Signature: the four amount tones

Money direction is written by four tones, none of them a dedicated colour token: **income** is
`positive` at the bold weight with a `+`; **expense** is `negative` at regular weight with U+2212;
**transfer** is `ink-2` with a lucide repeat glyph, the one glyph an amount ever carries; **planned**
is `ink-2` with no glyph, the word beside the row doing the work. The converted amount sits under
the native figure in caption `ink-2`, only when the currencies differ, and is never recomputed.

### Signature: the mark

A 28px square at 2px radius filled `accent`, carrying an `M` and a struck-through bar in
`on-accent`, drawn from tokens so it inverts in dark. Always `aria-hidden`, always beside the
product name in body bold, never a link inside the rail.

### Motion

Four durations (90 / 150 / 220 / 320ms) and four easings (`ease-out-quint` for entrances and
every hover or press, `ease-in-quint` for exits, `ease-standard` for looping animation,
`ease-drawer` for the drawer). Only `transform`, `translate`, `scale`, `opacity` and paint-only
colour properties are animated. `prefers-reduced-motion: reduce` collapses the four duration
tokens to 0.01ms rather than killing animations, so React Aria's `animationend`-driven unmounts
still fire.

## Do's and Don'ts

### Do:

- **Do** set every heading, margin note and section title in Caveat, and every figure, label,
  control and paragraph in Courier Prime.
- **Do** put a line of the passbook in a 2.5rem box with its baseline 3px above the rule by a
  translate, and draw the rule under a cell as an inset one-pixel shadow.
- **Do** build a section, a list or a summary as headings over bodies on `border-t` rules; reach
  for a card only when the content needs its own ground.
- **Do** spend violet on actions and on what is settled - the primary button, links, the current
  destination, the focus ring, the selected row - and nowhere else.
- **Do** write a planned line in `ink-2` with the word beside it, and a booked line in `ink`.
- **Do** mark what is settled with the `settled` badge - a typed word with a run of `highlighter`
  wash behind it - and give a page both ends: a balance carried in on the first line and a
  balance carried forward, read not retyped, on the last, over the heavier `border-panel` rule.
- **Do** give every amount an explicit sign (U+2212 for out, `+` for in), set inflow bold and
  outflow regular, and mark a transfer with the repeat glyph.
- **Do** mark a current or selected thing with a one-pixel frame or a one-pixel rule in `brand`.
- **Do** keep every radius at 2-4px on a rectangle and reserve `full` for things that are round.
- **Do** record every colour token's measured contrast beside its declaration and declare every
  themed colour at all three sites.
- **Do** grow hit areas to 44px inside the primitive with `target-min`, write `outline-solid`
  explicitly, and keep a pending button's label in the DOM.
- **Do** use lucide icons only, and use the same glyph for the same meaning everywhere.
- **Do** hold WCAG 2.2 AA as the CI gate (axe on every route) and the named AAA criteria the
  product claims: 2.5.5 target size, 2.4.11 and 2.4.12 focus not obscured, 1.4.8 visual
  presentation, 2.2.6 timeouts, 3.3.9 accessible authentication, and the 7:1 text floor.

### Don't:

- **Don't** place an eyebrow, kicker or uppercase label above a heading. Micro uppercase is for a
  column heading or a `dt` on the same line as its figure, never a line above a title.
- **Don't** use cards as the scaffold of a page, or a grid of equal icon cards as a section.
- **Don't** build a hero-metric tile - a big number over a small label. A figure is a typed line
  with its label at the start and the figure at the end.
- **Don't** set a figure in the hand or a heading in the typewriter.
- **Don't** use gradient text, glass, blur, a translucent bar, or a hard offset shadow anywhere.
- **Don't** put a coloured border wider than 1px on a card, list item, callout or alert, or mark
  selection with a bar; the 2px spine is neutral and belongs to the balance column only.
- **Don't** put a radius above 4px on a rectangle; no pills on chips, badges or panels.
- **Don't** use emoji, a glyph icon set, or a system display face; icons are lucide and the faces
  are the two self-hosted ones.
- **Don't** spend violet on a planned line, a decoration, a heading or a divider; never put the
  `settled` mark on a planned line or mark a page that closes in pencil; and don't strike
  anything through - there is no voided line.
- **Don't** add texture, aged paper, a faux stamp graphic, or a decorative flourish; the metaphor
  lives in rules and type, the highlighter pen run behind a badge's word is the one drawn gesture,
  and the world must not read as retro or as a schoolbook.
- **Don't** draw a badge as a box or a fill, pad it to make room for its bleed, or put its hue in
  the word; the word is `ink`, the hue is the pen, and the room is beside it.
- **Don't** paint text in a series colour, encode direction or status by colour alone, abbreviate
  money outside a chart axis, or render an amount from a float.
- **Don't** use negative tracking on either face.
- **Don't** invent a `z-index`, hard-code a dimension off the 4px grid, animate a layout property,
  or ship an animation without the reduced-motion path.
- **Don't** fabricate evidence on any surface: no users, testimonials, ratings, prices, uptime or
  security claims, no bank-sourced implication, and never the reference product's name.
- **Don't** claim blanket WCAG AAA conformance; `docs/ACCESSIBILITY.md` states exactly what is
  claimed and this document never contradicts it.
- **Don't** add a dependency to express any of the above; the stack is frozen (`docs/SPEC.md` §3).
