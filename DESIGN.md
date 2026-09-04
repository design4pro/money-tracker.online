---
name: money-tracker.online
description: A warm-paper ledger in which every claim carries its measurement, and every place a guarantee is impossible says so and adds a second channel instead.
colors:
  canvas: '#fbf9f5'
  surface: '#ffffff'
  surface-raised: '#ffffff'
  surface-sunken: '#f1eee9'
  surface-panel: '#f1eee9'
  ink: '#23201a'
  ink-2: '#524e46'
  border-subtle: '#e3dfd8'
  border-strong: '#838078'
  border-panel: '#c5c0b7'
  accent: '#23201a'
  accent-hover: '#36322b'
  accent-press: '#16140f'
  on-accent: '#ffffff'
  brand: '#064f89'
  brand-hover: '#033c6a'
  brand-soft: '#e6f2fe'
  on-brand: '#ffffff'
  positive: '#085b44'
  positive-soft: '#dbf8ec'
  on-positive: '#ffffff'
  negative: '#7d0a03'
  negative-soft: '#feebe8'
  on-negative: '#ffffff'
  warning: '#6c4806'
  warning-soft: '#feedd7'
  on-warning: '#ffffff'
  info: '#064f89'
  info-soft: '#e6f2fe'
  on-info: '#ffffff'
  focus: '#064f89'
  focus-gap: '#ffffff'
  hover: 'rgb(35 32 26 / 0.055)'
  press: 'rgb(35 32 26 / 0.1)'
  selection: '#cfe3f7'
  scrim: 'rgb(28 25 20 / 0.55)'
  skeleton: '#ece8e2'
  skeleton-sheen: 'rgb(255 255 255 / 0.75)'
  chart-emphasis: 'rgb(35 32 26 / 0.06)'
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
    fontFamily: 'Bricolage Grotesque, Bricolage Grotesque Fallback, Avenir Next, ui-sans-serif, system-ui, sans-serif'
    fontSize: 'clamp(2.5rem, 6.8vw, 4.5rem)'
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: '-0.032em'
  display:
    fontFamily: 'Bricolage Grotesque, Bricolage Grotesque Fallback, Avenir Next, ui-sans-serif, system-ui, sans-serif'
    fontSize: 'clamp(1.875rem, 4.4vw, 2.5rem)'
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: '-0.028em'
  title:
    fontFamily: 'Bricolage Grotesque, Bricolage Grotesque Fallback, Avenir Next, ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 700
    lineHeight: 1.18
    letterSpacing: '-0.02em'
  subtitle:
    fontFamily: 'Inter, Inter Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, ui-sans-serif, system-ui, sans-serif'
    fontSize: '1.125rem'
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: '-0.012em'
  body:
    fontFamily: 'Inter, Inter Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: 'Inter, Inter Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: 'Inter, Inter Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.35
  micro:
    fontFamily: 'Inter, Inter Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, ui-sans-serif, system-ui, sans-serif'
    fontSize: '0.6875rem'
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: '0.08em'
rounded:
  sm: '0.5rem'
  md: '0.75rem'
  lg: '1rem'
  xl: '1.25rem'
  2xl: '1.75rem'
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
  button-ghost-hover:
    backgroundColor: '{colors.hover}'
    textColor: '{colors.ink}'
  button-brand:
    backgroundColor: '{colors.brand}'
    textColor: '{colors.on-brand}'
    rounded: '{rounded.md}'
    height: '2.5rem'
    padding: '0 {spacing.4}'
  button-danger:
    backgroundColor: '{colors.negative}'
    textColor: '{colors.on-negative}'
    rounded: '{rounded.md}'
    height: '2.5rem'
    padding: '0 {spacing.4}'
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
  field:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    height: '2.5rem'
    padding: '0 {spacing.3}'
    typography: '{typography.label}'
  badge-neutral:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.full}'
    height: '1.5rem'
    padding: '0 {spacing.2}'
    typography: '{typography.caption}'
  badge-positive:
    backgroundColor: '{colors.positive-soft}'
    textColor: '{colors.positive}'
    rounded: '{rounded.full}'
    height: '1.5rem'
    padding: '0 {spacing.2}'
  badge-negative:
    backgroundColor: '{colors.negative-soft}'
    textColor: '{colors.negative}'
    rounded: '{rounded.full}'
    height: '1.5rem'
    padding: '0 {spacing.2}'
  ledger-row:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    height: '3.25rem'
    typography: '{typography.label}'
  ledger-row-selected:
    backgroundColor: '{colors.brand-soft}'
    textColor: '{colors.ink}'
---

# Design System: money-tracker.online

## Overview

**Creative North Star: "The Audited Ledger."**

A ledger whose every claim carries its receipt. This is a product about money being right, so the
visual system is built the way a set of accounts is built: every value is measured before it is
used, the measurement is written down beside it, and where a guarantee turns out to be impossible
the system says so out loud and adds another channel rather than quietly hoping. `src/styles/
tokens.css` states the contrast ratio of every colour against every ground it can land on, names
the dichromat separation of the positive/negative pair as low as 1.14:1, and then makes colour the
_third_ channel of money direction rather than the first. That refusal to overclaim is the design.

The paper is warm, not clinical. `canvas` is a bone white with yellow in it and dark is a warm
charcoal, never pure black; a finance product spends its life next to a column of figures and a
blue-white screen makes that column feel like a spreadsheet cell rather than a page. Against that
paper there are exactly two saturated voices: a near-black `accent` that commands, and one working
blue `brand` that points. `info` deliberately reuses the brand hue, because a notice with no verdict
speaks in the product's own voice and a fifth hue would have put a second blue beside the first for
no informational gain.

Density is high and quiet. A screen carries at most one loud thing - one primary button, one
oversized numeral - and the signature composition is an 11px uppercase `micro` label sitting
directly above a 40px `display` figure with nothing in between. The scale jump is deliberate and
softening it with an intermediate step is what makes a dashboard read as generic. Everything else
is set at `label` or `caption`, flat, on a strict 4px grid, so that the one loud thing is heard.

**Key Characteristics:**

- Warm paper (`#fbf9f5`), never clinical white; warm charcoal in dark, never pure black.
- Two voices only: a near-black accent that commands and one blue that points.
- Five grounds, and `surface-panel` is the one whose direction flips between themes.
- Flat at rest. Shadow means a genuine second layer, plus one step of hover lift.
- Every number that can change is tabular, without exception.
- Colour is never the only channel, and the reason is measured rather than assumed.
- Light and dark are two designed systems; a dark value computed from a light one is a defect.
- The 44px hit area is a separate dimension from the visual box, and the primitive owns it.
- Every token carries its measured contrast ratio as a trailing comment. One without is unfinished.

## Colors

A warm, low-chroma paper system carrying a near-black that commands and a single blue that points.
Ramps were built in OKLCH and every pair measured with the WCAG relative-luminance formula; chroma
sits at 96% of the sRGB gamut boundary for its lightness and hue, which is why the chromatic values
look saturated without clipping a channel. Ratios below are the light theme measured against
`surface-sunken`, the darkest ground light text lands on; the dark theme is measured against
`surface-raised`, its lightest.

### Primary

- **Ink Black** (`accent` / `ink`): the same value serves as the darkest text and the loudest fill,
  deliberately. Primary buttons, body copy, headings. White on the accent fill measures 16.24:1;
  the text role measures 14.03:1 on sunken and 15.99:1 on surface. Dark theme lifts it to a warm
  bone `#e9e6df` (12.15:1 on raised) and the accent inverts with it.

### Secondary

- **Working Blue** (`brand`): links, active navigation, the focus ring, selection, the primary
  chart series, and the single monetisation call to action. 7.30:1 on sunken, 8.44:1 on surface.
  Dark is a lifted `#75b8fc` at 7.22:1 on raised - lifted, not flipped.
- **Blue Wash** (`brand-soft`): the tinted ground for upsells, empty-state invitations and the
  selected ledger row. It carries `brand` as readable text at 7.44:1, so it is a real surface
  rather than decoration. Dark is `#152433`, carrying its own brand at 7.52:1.

### Tertiary - the four verdicts

Hues were chosen for dichromatic separation rather than convention: the positive/negative pair is
bluish-green (168 degrees) against vermillion (30 degrees), the Okabe-Ito axis that best survives
protanopia and deuteranopia, instead of the textbook green-versus-red pair that collapses entirely.
Each carries an `-on` foreground for its solid fill and a `-soft` tint that carries its own hue as
text above 7:1.

- **Ledger Green** (`positive`) - money in, settled, within budget. 7.01:1 on sunken; on
  `positive-soft`, 7.20:1. Dark `#21cb9c`.
- **Oxblood** (`negative`) - money out, destructive confirmation, validation failure, overspend.
  9.47:1 on sunken; on `negative-soft`, 9.53:1. Dark `#fdaa9c`.
- **Tobacco** (`warning`) - approaching a limit, over quota, unconfirmed, overdue soon. 7.07:1 on
  sunken; on `warning-soft`, 7.13:1. Dark `#efa51e`.
- **Notice Blue** (`info`) - system notices with no verdict, and planned future-dated rows. Shares
  the brand value exactly.

### Neutral

- **Warm Paper** (`canvas`): the page ground.
- **Sheet** (`surface`) and **Raised** (`surface-raised`): in light these share white, because
  white is the top of the range and elevation there is carried by shadow. In dark they separate
  (`#1d1b18` against `#272622`), because a shadow against charcoal reads as nothing and tone is
  the only honest elevation channel. That asymmetry is the reason both tokens exist.
- **Well** (`surface-sunken`): recessed panels, meter tracks, table header bands, the left rail.
- **Panel** (`surface-panel`): the fifth ground, for a plane filling a whole region of the
  composition - the auth rail, a half-screen split. It is the only ground whose _direction_ flips:
  light recesses it (1.10:1 against canvas), dark lifts it (1.16:1). The steps are deliberately
  unequal, forced by the contrast contract rather than chosen: in light this is the darkest ground
  text lands on and `positive` already sits at 7.01:1 on it, so 1.10 is the entire budget.
- **The ink ladder is two tiers, and both are AAA.** `ink` (14.03:1) and `ink-2` (7.15:1). `ink-2`
  is not a 4.5:1 grey; hierarchy in this product comes from weight, size and position, never from
  fading text toward the background. There is no third tier.
- **Hairline** (`border-subtle`): decorative separation only, and it carries no contrast claim.
- **Control Boundary** (`border-strong`): the edge of anything interactive. 3.41:1 on sunken,
  above the 3:1 WCAG 1.4.11 asks of a control boundary without the weight of a full-contrast
  border. This token is what separates a drawn box from a pressable one.
- **Panel Edge** (`border-panel`): the one rule that draws the `surface-panel` split. Decorative,
  so no 3:1 claim, but held to a floor of 1.5:1 against _both_ grounds it divides in both themes.
  `border-subtle` cannot do this job: at 1.32:1 against the dark panel it disappears exactly where
  the tonal step is weakest.

### The category series palette

Eight hues at 252, 202, 172, 132, 95, 42, 8 and 318 degrees, for charts, category chips and
legends. **Read the guarantee precisely, because it is narrower than a palette usually claims.**

Eight hues that are simultaneously mutually distinguishable, at 7:1 against both a near-white and a
near-black ground, and stable under dichromacy do not exist inside sRGB. That is the size of the
gamut, not a failure of the ramp. What it actually guarantees: every value clears **3:1 against
every ground in its own theme** (measured minimum 4.50:1 light, 4.87:1 dark), which is the WCAG
1.4.11 floor for a graphical object and is enough for a fill, a stroke or a swatch. It does **not**
guarantee 7:1, so **a series colour is never used as text.** The worst-case pair separates by only
1.03:1 in luminance, and under simulated deuteranopia the worst pair falls to 1.02:1.

### Named Rules

**The Two Voices Rule.** `accent` and `brand` are the only saturated voices in the chrome. A screen
gets one primary button. If a layout needs a third colour to make its hierarchy legible, the
hierarchy is wrong and the palette is not.

**The Colour-Is-Third Rule.** Money direction is never encoded by colour alone, and colour is not
even the first channel. Measured separation between `positive` and `negative` after
Viénot-Brettel-Mollon simulation falls to 1.14:1 in light and 1.12:1 in dark - invisible. So every
amount carries an explicit sign, inflow is set at a heavier weight than outflow, every intent
surface carries an icon, and the product stays correct with all colour removed.

**The Series-Is-Secondary Rule.** Anything painted from the series ramp also carries a text label, a
value, or a pattern. A chart whose only channel is series colour is a defect, and the primitives in
`src/components/charts` are built so it cannot be expressed.

**The Measured Pair Rule.** Every colour token that can meet text carries its measured contrast
ratio as a trailing comment beside its declaration, stated against every ground it can actually
land on rather than a convenient one. A token added without its measurement is not finished.

**The Two Systems Rule.** Dark is designed, not derived. Its neutrals are warm charcoal, its
chromatic values are lifted rather than flipped, and its shadows are re-declared opaque rather than
reused. A dark value computed from a light one is a defect.

**The Three-Site Rule.** Every themed colour is declared in exactly three places: bare `:root`,
then `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, then
`:root[data-theme="dark"]`. Fewer than three produces a toggle that works in one direction only.

## Typography

**Display Font:** Bricolage Grotesque (with a metric-compensated `Bricolage Grotesque Fallback`,
then Avenir Next) - a geometric face for the few large things.
**Body Font:** Inter (with `Inter Fallback`, then the system stack) - a neutral face for the many
small ones.
**Mono Font:** the system mono stack (`ui-monospace`, SF Mono, JetBrains Mono, Cascadia, Menlo).

**Character:** geometric warmth over neutral clarity. Both stacks name their metric-compensated
local fallback _immediately_ after the web face, so a heading does not resize when the web font
lands. There is deliberately **no third face for numbers**: a figure keeps the face it inherits and
changes only its numeral set.

### Hierarchy

- **Hero** (700, `clamp(2.5rem, 6.8vw, 4.5rem)`, 0.98, -0.032em): the marketing headline. One per
  page.
- **Display** (700, `clamp(1.875rem, 4.4vw, 2.5rem)`, 1.04, -0.028em): the one number a screen is
  about - net worth, a budget's remainder, an account balance. Set in the display face.
- **Title** (700, 24px, 1.18): page and dialog titles.
- **Subtitle** (600, 18px, 1.4): card titles and section headings.
- **Body** (400, 15px, 1.55): prose and form labels. Running text is capped at `--measure` (68ch).
- **Label** (500, 13px, 1.4): the default inside controls - button labels, field text, list rows,
  the ledger row's payee.
- **Caption** (400, 12px, 1.35): metadata, axis labels, helper text, the converted amount under a
  figure. Set in `ink-2`, which still clears 7:1, so a caption here is genuinely readable rather
  than decoratively grey.
- **Micro** (600, 11px, 0.08em, uppercase): the whisper label above a figure, and collection
  headers. It is the smallest type in the system and it is what makes the numeral beneath it loud.

### Named Rules

**The Tabular Rule.** Any number that can change carries the `.tabular` utility
(`font-variant-numeric: tabular-nums`). No exceptions: every amount, rate, percentage, count, date
figure and axis tick, in every locale. The rule is checked on the rendered element that holds the
digits, never on an ancestor. This is what stops a re-rendered total shifting the row it sits in
and what makes a column of money align on the decimal separator.

**The Two-Step Rule.** An 11px uppercase `micro` label sits directly above a 40px `display` numeral
with nothing in between. The contrast is the signature composition; an intermediate size softens
the pairing and the pairing is the point.

**The Real Minus Rule.** A negative amount is prefixed with U+2212, not a hyphen. At the size a
ledger column is set in, a hyphen is a third of the width of the plus beside it and the column
stops reading as a column.

**The Aligned Column Rule.** Amounts are end-aligned in every table, list and form field, with the
currency symbol outside the alignment so digits line up across a workspace holding `PLN`, `EUR` and
`JPY` in one view.

**The Spoken-Sentence Rule.** A money cell carries two strings: the drawing, marked `aria-hidden`,
and a full sentence in an `sr-only` span built with `currencyDisplay: 'name'` - _"Expense of 20.00
Polish zlotys"_. A narrow currency symbol is announced inconsistently and a minus sign is not the
same sentence as "an expense".

**The Never-Abbreviate-Money Rule.** An amount is never rendered as `1.2k` or `1,2 tys.` in a
ledger, form, table cell, tooltip or export. Abbreviation is permitted only on a chart axis tick,
where the full value is in the chart's data table and the point's accessible name.

## Layout

A strict 4px rhythm. `--spacing: 0.25rem` pins Tailwind's own numeric scale to the same grid, so
`p-6`, `gap-6` and `--space-6` are always the same 24px. A one-off value in a component is a defect,
not a judgement call.

- **App shell**: a fixed 220px rail from `lg` (1024px) up, on `surface-sunken` behind a
  `border-subtle` end-edge; below that breakpoint the rail is `display: none` and a bottom bar takes
  over. The content column is capped at 1280px by `--content-max`, reached as `max-w-content`,
  and centred. The marketing surface is a deliberately narrower well at 1152px and does not use
  that token.
- **Content padding**: 16px at 360px, 24px from `sm`, 32px from `lg`. Bottom padding is 112px below
  `lg` to clear the bottom bar and 48px above it.
- **Chrome geometry is composed, never hand-calculated**: `--nav-h` (64px), `--subnav-h` (48px) and
  `--impersonation-h` combine through the `h-chrome` / `top-chrome` / `pt-chrome` utilities, plus
  the `--safe-*` inset tokens. `--impersonation-h` is added unconditionally and resolves to 0 when
  no impersonation bar is present.
- **Ledger row**: a single stacked block below `lg`, and a three-column baseline-aligned grid
  (`1.5fr / 1fr / 1fr`) from `lg` up.
- **Reading measure**: `--measure` caps running text at 68ch with 1.6 line height and 1.5em
  paragraph spacing (WCAG 2.2 §1.4.8 AAA), applied by the `prose-measure` utility.

### Named Rules

**The 4px Rule.** Every dimension is a multiple of 4px and comes from a `--space-*` token. A
hard-coded `padding: 13px` is a review rejection.

**The Composed-Chrome Rule.** No consumer re-derives the height of the chrome above it. Sticky
regions and scroll margins compose the same named tokens, because two elements each claiming to
clear the same edge is how a focused input ends up under a phone keyboard.

**The Closed-Ladder Rule.** Nothing in the product invents a `z-index`. There are eight named rungs
(`base` 0, `nav` 30, `dropdown` 40, `overlay` 50, `modal` 60, `popover` 65, `tooltip` 70, `toast` 80) and `src/lib/cn.ts` registers them with tailwind-merge so an override genuinely wins instead of
leaving two classes and letting stylesheet order decide.

**The Focus Reserve Rule.** Nothing may clip a focus ring. Any scroll container that could crop one
reserves `--focus-reserve` of padding.

## Elevation & Depth

**Flat at rest.** Depth comes from the ground ladder (canvas -> surface -> sunken) and a hairline.
Shadow is reserved for things genuinely on another layer, plus a single step of hover lift. No
glassmorphism, no blur panels, no coloured glow.

### Shadow Vocabulary

- **`--shadow-card`** (`0 1px 2px rgb(35 32 26 / 0.04), 0 1px 3px -1px rgb(35 32 26 / 0.05)`): 4-5%
  alpha, and it exists only to keep a white sheet from dissolving into the warm canvas behind it.
- **`--shadow-elevated`**: the hover step for a filled button, and any surface briefly lifted.
- **`--shadow-dropdown`**: menus, list boxes, the floating-panel treatment.
- **`--shadow-popover`**: popovers and tooltips.
- **`--shadow-modal`** (`0 2px 8px -2px rgb(35 32 26 / 0.1), 0 32px 72px -16px rgb(35 32 26 /
0.28)`): dialogs and drawers.

Dark re-declares all five opaquely (`--shadow-card` becomes `0 1px 2px rgb(0 0 0 / 0.5), 0 1px 1px
rgb(0 0 0 / 0.3)`), because a light shadow's low-alpha warm black is invisible against charcoal.

### Named Rules

**The Flat-At-Rest Rule.** A resting surface gets a hairline and a tone, never a shadow step. If a
card needs a shadow to read as a card, its border or its ground is wrong.

**The One-Pixel Rule.** The press is `translate-y-px` and one shadow step down - never a bounce and
never a scale. The control reads as pushed into the page rather than as shrinking.

**The Tone-In-Dark Rule.** In light, `surface` and `surface-raised` share white and elevation is
carried by shadow. In dark they separate and tone carries it, because a shadow against charcoal
reads as nothing.

## Shapes

Radius is a category signal, not decoration:

`sm` 8px (a nested inset, a small control) - `md` 12px (a control: button, field, menu item) -
`lg` 16px (a floating layer: menu, popover, inset panel) - `xl` 20px (a sheet: the card) -
`2xl` 28px (the largest sheets) - `full` (a chip, badge, avatar, meter).

### Named Rules

**The Pill Means Pickable Rule.** `full` radius on a rectangle declares it a token you can pick up -
a chip, a badge, an avatar. Never on a panel.

**The Hairline Honesty Rule.** If a box can be clicked, its border is `border-strong`. If it cannot,
its border is `border-subtle`. There is no third case, and a decorative `border-strong` is a defect.

## Components

Everything under `src/components/ui` is built on **React Aria Components**, not Radix, and is
expressed purely in tokens: there is no raw hex, literal px radius or hand-written shadow anywhere
in that directory. Interaction state arrives as data attributes (`data-hovered`, `data-pressed`,
`data-focus-visible`, `data-selected`, `data-disabled`, `data-invalid`), and the shared fragments in
`ui/shared.ts` spell those selectors out rather than relying on plugin variant names.

### Buttons

- **Shape:** `md` radius (12px), `sm` at the small size. `pill` and `icon` shapes available.
- **Sizes:** sm 32px / md 40px / lg 48px visual height, all below 44px on purpose - the hit area is
  grown separately.
- **Primary:** `accent` fill with `on-accent` text and `--shadow-card`; hover moves to
  `accent-hover` and `--shadow-elevated`; press to `accent-press`, one pixel down, shadow back to
  card.
- **Secondary (the default variant):** a `border-strong` hairline on `surface`. Hover darkens the
  border to `ink-2` and the ground to `surface-sunken`.
- **Ghost:** no chrome until touched - `ink-2` text, `hover` wash on hover. Toolbars, table rows.
- **Subtle:** a quiet `surface-sunken` fill that sits inside a card without competing with it.
- **Brand:** `brand` fill, for marketing and onboarding calls to action.
- **Danger:** `negative` fill. Never the resting state of a row action.
- **Link:** `brand` text with a 40%-opacity underline that reaches full opacity on hover; no height,
  no padding, no shadow.
- **Disabled** repaints rather than fades: a filled button drops to `surface-sunken` with `ink-2`
  text. Dropping a filled control to 45% opacity dims its label with its fill and lands the pair
  near 2.9:1, which reads as broken rather than waiting. Opacity is reserved for controls with no
  label of their own.

**The Pending-Not-Disabled Rule.** A submit button in flight uses React Aria's `isPending`: it stays
focusable, gets `aria-disabled` rather than `disabled`, and announces politely. A `disabled` element
loses focus the moment it is disabled, dumping a keyboard user at the top of the document with no
announcement of why. The label stays in the DOM under the spinner marked `invisible`, so the button
holds its measured width and a pending action never reflows its row.

### Fields

- **Style:** `surface` ground, `border-strong` hairline, `md` radius, 40px at the default size.
- **Hover** darkens the border to `ink-2`; **focus** moves it to `brand` _and_ draws the ring.
- **Invalid** moves it to `negative`; errors render below the field, are wired by
  `aria-describedby`, and combine colour with an icon and a text message.
- **Disabled:** `surface-sunken` ground, `ink-2` text, `not-allowed` cursor.
- **The label is always visible.** A placeholder is never a label.

**The amount field** is the most-used control in the product and the one place a decimal is allowed
to exist on the way in. It crosses the decimal-to-minor-units boundary _through a string_ rather
than through a float, takes its digit count from the currency rather than a constant, is end-aligned
and tabular, and shows the value it will store before submit rather than silently rounding.

### Focus

One treatment, product-wide, drawn **outside** the control: a 2px `focus-gap` band separating the
indicator from whatever fill sits underneath, then the 2px `focus` ring itself. The band is what
makes the indicator survive on a brand-filled button, where `--color-brand` and `--color-focus` are
the same value. The indicator measures 7.30:1 against the page in light and 7.22:1 in dark, far past
the 3:1 the criterion asks for.

The two rings are drawn by two different properties on purpose: the ring is an `outline`, which no
ancestor's `overflow: hidden` can crop, and the band is a `box-shadow`, which one can. Under a
clipping ancestor the indicator degrades to the outline alone - still conformant, only weaker. It
never degrades to nothing, which is what a shadow-only indicator would do. `focus-ring-inset`
mirrors both rings inward for a control flush against an edge.

**The Outline-Solid Rule.** `outline-solid` is load-bearing and `outline-none` must never appear
beside it. In Tailwind v4 the outline utilities share one `--tw-outline-style` custom property:
`outline-none` sets it to `none`, and `outline-2` then resolves against that, producing a ring two
pixels wide and styled `none`. Every control built on that pair reports a focus colour and draws
nothing.

### Cards

- **Corner:** `xl` (20px); the inset variant drops to `lg`.
- **Default:** `border-subtle` hairline on `surface` with `--shadow-card`.
- **Inset:** `surface-sunken`, no border - for a panel nested inside another card.
- **Brand:** `brand-soft` ground behind a 25%-opacity brand border - an upsell or an empty-state
  invitation.
- **Dashed:** a dashed `border-strong` at 60% on transparent - the "create something here"
  affordance.
- **Padding:** 16 / 20 / 24px.
- **Header** composes a `micro` uppercase eyebrow, a `subtitle` heading at a caller-chosen level,
  and a `caption` description, with a trailing action slot.

A card is **not** interactive and there is deliberately no `isInteractive` prop. A clickable card is
a `Button` or `Link` wrapping a card, so the thing that takes the press is the thing that takes
focus, is announced with a role, and answers Enter.

### Badges and chips

`full` radius, 20px (sm) or 24px (md) visual height. Tones are `neutral` (the only bordered one),
`accent`, `brand`, `positive`, `negative`, `warning` and `info`; every tinted tone pairs a `-soft`
ground with its own hue as text at 7:1 or better. A category chip carries its colour as a dot beside
the category **name**; the colour is never the only identifier.

### Navigation

A 220px rail on `surface-sunken` from `lg` up, a bottom bar below it. The current destination is
marked by `aria-current="page"` plus a second visual channel, never by colour alone.

### Charts

Hand-rolled accessible SVG on `d3-scale` / `d3-shape` / `d3-time`; there is no chart library
(`docs/adr/0007`). `ChartFrame` makes the guarantees structural rather than advisory:

- **`dataTable` is a required prop**, so a chart built without a text equivalent is a compile error
  rather than a review finding.
- The `<svg>` is authored at the container's **actual pixel width**, so one user unit is one CSS
  pixel at every breakpoint. A fixed viewBox scaled by CSS would shrink the 11px axis labels to 6px
  at 360px.
- **Empty is a designed state**: the axes stay on screen and the message sits over them, so the
  layout does not jump when the first transaction arrives.
- The focused point's description is a **readout under the plot, not a floating tooltip** - a
  tooltip that follows focus is the classic way to obscure the focus indicator, and this product
  claims WCAG 2.2 §2.4.12 Enhanced. The readout is `aria-hidden` because the point already carries
  the same string as its accessible name.
- `overflow-visible` on the `<svg>` is load-bearing: the focus ring on an edge data point sits
  outside the viewBox and the default would clip it away.
- The entrance fade is gated behind `motion-safe:`. There is no other animation in the directory.

### Signature: the Budget Meter

The one component this product is judged on. Its headline is **the remainder**, at the display step,
because "how much is left" is what somebody standing in a shop needs - not how much is spent and not
what percentage is gone, which are the two figures every budgeting product leads with. The
percentage is a caption beneath it.

It does not use the plain `Meter` primitive, because it needs two marks on the track that are a
`Meter` internal: a **tick at 100%** so the reader sees the line before it is crossed, and a **2px
notch per configured alert**, so a workspace that asked to be told at 50% and 80% can see where
those are. The track comes from the shared `AmountMeter`, so the `role="meter"` contract and the
accessible value live in one place rather than two that can drift.

An overspend is unmistakable through four channels, with colour last: the **word** changes (_On
track_ / _Close to the limit_ / _Over budget_), an **icon** changes with it, the remainder **flips to
an over-by figure** with a real minus sign, and past 100% the fill runs **hatched** as well as
negative-coloured - so the state survives greyscale, a forced-colours theme and deuteranopia. The
fill stops at the track's end because a bar overflowing its own track says nothing a full bar does
not; the sentence does not stop, and 116% reads as 116%.

### Signature: the ledger row

A real `<tr>` inside a `role="grid"` table. Below `lg` it is a stacked block; from `lg` up it is a
three-column baseline-aligned grid at 52px minimum height. Payee is `label` weight-medium on
`surface`; date, account and category sit in `caption` at `ink-2`; the amount is end-aligned and
tabular. Hover paints the `hover` wash; selection paints `brand-soft` with a 3px inset brand bar on
the leading edge - tone plus a rule, never tone alone.

Money direction is written by four tones, and none of them is a dedicated colour token: **income**
is `positive` at semibold, **expense** is `negative` at normal weight, **transfer** is `ink-2` with
a repeat glyph, **planned** is `info`. Inflow is heavier as well as differently coloured because the
measured dichromat separation makes colour unreliable on its own. The transfer glyph exists and the
income/expense arrows deliberately do not: the sign already states direction at the same glance, and
a glyph in front of a right-aligned number gives the column two left edges so nothing in it lines
up. A transfer has no sign of its own, so its glyph is the channel that keeps it from being "an
expense in a different grey".

### Motion

Four durations (90 / 150 / 220 / 320ms) and four easings (`ease-out-quint`, `ease-in-quint`,
`ease-standard`, `ease-drawer`). Only `transform` and `opacity` plus paint-only colour properties
are ever animated; height, width, `top` and margin are reflows and cannot be animated honestly at
60fps. Because Tailwind v4 compiles `-translate-y-px` and `scale-95` to standalone `translate` and
`scale` properties rather than to `transform`, the shared transition names all three - listing only
`transform` leaves every press in the directory snapping instantly while the class looks animated.

**The Collapse-The-Tokens Rule.** `prefers-reduced-motion: reduce` sets the four duration tokens to
0.01ms rather than blanket-killing animations. A `!important` `animation: none` breaks components
that wait on `animationend` - React Aria's overlays do exactly that to unmount an exiting popover -
leaving a dialog that never closes. Collapsing durations removes all perceptible motion while every
completion event still fires, and because they are tokens the collapse reaches animations written
after the stylesheet was, including third-party CSS.

### Target size

**The 44px Rule.** Every pointer target answers 44x44 CSS px (WCAG 2.2 §2.5.5 AAA). The `target-min`
utility grows the _hit area_ with a pseudo-element while the visual box stays on the size scale, so
a 32px icon button keeps its 32px drawing and still answers a 44px tap. The hit area and the visual
box are separate dimensions; conflating them produces a toolbar of 44px-tall ghost buttons with dead
space between their labels. The expansion lives in the primitive, so a caller cannot forget it.

## Do's and Don'ts

### Do:

- **Do** record every colour token's measured contrast beside its declaration, against every ground
  it can land on. A token without its measurement is not finished.
- **Do** declare every themed colour in all three sites (`:root`, the guarded media query, and
  `[data-theme="dark"]`), or the toggle will work in one direction only.
- **Do** set every changeable number with the `.tabular` utility on the element holding the digits.
- **Do** give every amount an explicit sign and set inflow heavier than outflow.
- **Do** pair every series colour with a label, a value, or a pattern.
- **Do** grow hit areas inside the primitive with `target-min`, never with padding on the caller.
- **Do** write `outline-solid` explicitly and never place `outline-none` beside an outline width.
- **Do** repaint disabled controls that carry their own label; reserve opacity for controls that
  do not.
- **Do** use `isPending` rather than `disabled` for an in-flight action, and keep the label in the
  DOM so the control holds its width.
- **Do** compose chrome geometry from the named tokens instead of re-deriving a height.
- **Do** re-declare dark shadows opaquely and lift dark chromatic values rather than flipping them.

### Don't:

- **Don't** paint text in a series colour. The ramp guarantees 3:1 for graphical objects and
  explicitly does not guarantee 7:1.
- **Don't** encode money direction, a chart series, a status or a category by colour alone.
- **Don't** abbreviate money anywhere except a chart axis tick.
- **Don't** render an amount from a float at any layer, including a tooltip.
- **Don't** use a hyphen where a negative amount needs U+2212.
- **Don't** put a shadow on a resting surface, or add a second shadow step to a card.
- **Don't** fade text below 7:1 to create hierarchy - change weight, size or position instead.
- **Don't** invent a `z-index`; take a rung from the closed ladder.
- **Don't** hard-code a dimension off the 4px grid.
- **Don't** animate a layout property, and don't ship an animation without a reduced-motion path.
- **Don't** make a card interactive; wrap it in a `Button` or `Link` instead.
- **Don't** let a tooltip or sticky region cover a focused control.
- **Don't** claim blanket WCAG AAA conformance. `docs/ACCESSIBILITY.md` states exactly what is
  claimed, and this document must never contradict it.
