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
  on-brand: '#ffffff'
  positive: '#0b5136'
  positive-soft: '#dcf2e4'
  on-positive: '#ffffff'
  negative: '#8a1a0d'
  negative-soft: '#f8e3df'
  on-negative: '#ffffff'
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
  badge-neutral:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.sm}'
    height: '1.5rem'
    padding: '0 {spacing.2}'
    typography: '{typography.caption}'
  badge-positive:
    backgroundColor: '{colors.positive-soft}'
    textColor: '{colors.positive}'
    rounded: '{rounded.sm}'
    height: '1.5rem'
    padding: '0 {spacing.2}'
    typography: '{typography.caption}'
  badge-negative:
    backgroundColor: '{colors.negative-soft}'
    textColor: '{colors.negative}'
    rounded: '{rounded.sm}'
    height: '1.5rem'
    padding: '0 {spacing.2}'
    typography: '{typography.caption}'
  badge-brand:
    backgroundColor: '{colors.brand-soft}'
    textColor: '{colors.brand}'
    rounded: '{rounded.sm}'
    height: '1.5rem'
    padding: '0 {spacing.2}'
    typography: '{typography.caption}'
  badge-settled:
    backgroundColor: '{colors.highlighter}'
    textColor: '{colors.ink}'
    rounded: '{rounded.sm}'
    height: '1.25rem'
    padding: '0 {spacing.1}'
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
highlighter run over a settled line), and as too little like an
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

### Tertiary - the coloured inks

- **Green Ink** (`positive`): money in, on track, within budget. 7.75:1 on sunken, 9.36:1 on
  raised; on `positive-soft` 7.96:1. Dark `#7fd9a8`.
- **Red Ink** (`negative`): money out, overdrawn, destructive confirmation, validation failure.
  7.78:1 on sunken, 9.40:1 on raised; on `negative-soft` 7.63:1. Dark `#f5a08f`.
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
- **Control Boundary** (`border-strong`): the edge of anything pressable or typeable. 4.33:1 on
  raised, 3.59:1 on sunken, clearing the 3:1 floor of WCAG 1.4.11 on every ground.

### The category series palette

Eight hues (`series-1` to `series-8`) for chart fills, category dots and legends, every one at or
above 3:1 against every ground in its own theme (measured minimum 4.31:1 light, 4.68:1 dark) and
re-tuned for dark rather than reused. They are stored on categories and do not move without a
data migration. They guarantee 3:1 for a graphical object and explicitly not 7:1: a series colour
is never text.

### Named Rules

**The One Stamp Rule.** Violet is spent on what commands and on what is settled - the primary
action, a link, the current destination, the focus ring, the selected row. It is never spent on a
planned line, a decoration, a heading or a divider. "Settled" has its own mark - the `settled`
badge tone, a typed word in `ink` with a run of `highlighter` wash behind it - and it is the
only status that may spend the stamp ink. If a screen needs a second violet thing, one of them is
not an action.

**The Pencil Rule.** A planned entry is written in `ink-2` with the word beside it; a booked entry
is written in `ink`. State is line form before hue, and nothing is ever struck through.

**The Colour-Is-Third Rule.** Money direction is never encoded by colour alone, and colour is not
even the first channel: every amount carries an explicit sign, inflow is set at the bold weight and
outflow at regular, a transfer carries a repeat glyph, and the product stays correct with all
colour removed. The measured dichromat separation of the green and red inks is the reason.

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

### Badges

`sm` radius (2px), 20px (sm, micro uppercase) or 24px (md, caption) height, bold. Tones: `neutral`
(ruled, `border-strong` on `surface`), `accent`, `brand`, `positive`, `negative`, `warning`,
`info`, and `settled`; every tinted tone pairs a `-soft` ground with its own ink at 7:1 or better.
**`info`** is the typed status - "Hidden", "Planned", "Auto" - in `ink-2` inside a one-pixel
`border-panel` rule on whatever ground it lands on, no wash: a ruled label, so it can never be
mistaken for the mark. **`settled`** is the highlighter (`mark-pen` in `app.css`): the word typed
in `ink` at the small size (micro, uppercase, 0.06em, 20px high) with a run of `highlighter` drawn
behind it at 75%, past both ends of the word and further where the pen lifted, pooled darker at
its trailing edge, its outline roughened by the one SVG displacement filter in the product
(mounted once in `__root.tsx`), and a small blob where the pen paused. Every colour in it is a
token, so it inverts for dark; in forced colours the wash drops and the typed word remains. It is
the only status that spends the stamp ink and the only "settled" mark in the product; it is never
placed on a planned line. On the landing it stands once, beside the passbook's opening line, on
the baseline of the word it follows, the wash crossing the printed rule the way a pen does; on the
narrow page it is the second line of the opening entry. A category carries its series
colour as a dot beside its name; the colour is never the only identifier.

### Tables

The passbook inside the app. A `border-subtle` frame at `lg` radius on `surface`; a sticky header
band on `surface-sunken` in micro uppercase `ink-2`; cells separated by `border-subtle` vertical
rules and rows by `border-subtle` horizontal ones, cell padding 12 / 10px. Hover paints the `hover`
wash. **Selection** paints `brand-soft` plus a one-pixel inset frame in `brand`
(`inset 0 0 0 1px`): a box, not a bar. Amounts are end-aligned and tabular.

### Meter

An 8px track at `sm` radius in `border-subtle` (so the fill's stop is readable against it), the
fill in `positive` on track, `warning` near the limit, `negative` over it; past 100% the fill runs
hatched as well as red. The headline beside it is the remainder, and the state is carried by a
word and a lucide icon before colour.

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
  lives in rules and type, the highlighter run over a settled line is the one drawn gesture, and
  the world must not read as retro or as a schoolbook.
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
