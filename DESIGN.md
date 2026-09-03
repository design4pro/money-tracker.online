---
name: money-tracker.online
description: A ledger that reads like a well-set table of figures - cool paper, one deep teal voice, near-black ink, and colour that only ever carries data with a second signal beside it.
colors:
  ink: '#111310'
  ink-2: '#33372f'
  ink-3: '#454a41'
  canvas: '#f7f7f5'
  surface: '#ffffff'
  surface-2: '#eeeeeb'
  surface-inset: '#e6e6e2'
  edge: '#dcdcd7'
  edge-strong: '#6f7468'
  accent: '#111310'
  accent-hover: '#2a2e27'
  accent-on: '#ffffff'
  accent-subtle: '#e6e6e2'
  brand: '#0a4a42'
  brand-hover: '#073630'
  brand-on: '#ffffff'
  brand-subtle: '#e2efec'
  success: '#0f5236'
  success-on: '#ffffff'
  success-subtle: '#e3f1ea'
  warning: '#6a4004'
  warning-on: '#ffffff'
  warning-subtle: '#f7ecdc'
  danger: '#8f1e16'
  danger-on: '#ffffff'
  danger-subtle: '#fbe8e6'
  info: '#1539a8'
  info-on: '#ffffff'
  info-subtle: '#e6ecfb'
  amount-income: '#0f5236'
  amount-expense: '#8f1e16'
  amount-transfer: '#454a41'
  amount-planned: '#1539a8'
  series-1: '#0a4a42'
  series-2: '#1539a8'
  series-3: '#8f1e16'
  series-4: '#6a4004'
  series-5: '#62288a'
  series-6: '#084e5e'
  series-7: '#7f1a55'
  series-8: '#34490e'
  ring: '#0a4a42'
  selection: '#cfe6e0'
  track: '#eeeeeb'
  track-fill: '#0a4a42'
  inverse: '#111310'
  inverse-on: '#f4f5f2'
typography:
  hero:
    fontFamily: 'Inter Tight, Inter, -apple-system, Segoe UI, sans-serif'
    fontSize: 'clamp(2.5rem, 6.8vw, 5rem)'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '-0.032em'
  headline:
    fontFamily: 'Inter Tight, Inter, -apple-system, Segoe UI, sans-serif'
    fontSize: 'clamp(2rem, 4.8vw, 3.25rem)'
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: '-0.028em'
  figure:
    fontFamily: 'Inter Tight, Inter, -apple-system, Segoe UI, sans-serif'
    fontSize: 'clamp(1.875rem, 4vw, 2.75rem)'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '-0.02em'
    fontFeature: 'tabular-nums'
  title:
    fontFamily: 'Inter Tight, Inter, -apple-system, Segoe UI, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: '-0.018em'
  subtitle:
    fontFamily: 'Inter, -apple-system, Segoe UI, sans-serif'
    fontSize: '1.0625rem'
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: 'Inter, -apple-system, Segoe UI, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 400
    lineHeight: 1.6
  amount:
    fontFamily: 'Inter, -apple-system, Segoe UI, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 550
    lineHeight: 1.5
    fontFeature: 'tabular-nums'
  caption:
    fontFamily: 'Inter, -apple-system, Segoe UI, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 400
    lineHeight: 1.55
  micro:
    fontFamily: 'Inter, -apple-system, Segoe UI, sans-serif'
    fontSize: '0.6875rem'
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: '0.07em'
    textTransform: 'uppercase'
rounded:
  none: '0'
  sm: '4px'
  md: '8px'
  lg: '12px'
  xl: '18px'
  full: '9999px'
spacing:
  0: '0'
  1: '4px'
  2: '8px'
  3: '12px'
  4: '16px'
  5: '20px'
  6: '24px'
  8: '32px'
  10: '40px'
  12: '48px'
  16: '64px'
  24: '96px'
components:
  button-primary:
    background: '{colors.accent}'
    color: '{colors.accent-on}'
    radius: '{rounded.md}'
    minHeight: '44px'
    padding: '{spacing.3} {spacing.5}'
  button-brand:
    background: '{colors.brand}'
    color: '{colors.brand-on}'
    radius: '{rounded.md}'
    minHeight: '44px'
  button-quiet:
    background: '{colors.surface-2}'
    color: '{colors.ink}'
    border: '1px solid {colors.edge-strong}'
    radius: '{rounded.md}'
    minHeight: '44px'
  field:
    background: '{colors.surface}'
    border: '1px solid {colors.edge-strong}'
    radius: '{rounded.md}'
    minHeight: '44px'
    focusRing: '2px solid {colors.ring}'
  amount-field:
    extends: 'field'
    fontFeature: 'tabular-nums'
    textAlign: 'end'
  card:
    background: '{colors.surface}'
    border: '1px solid {colors.edge}'
    radius: '{rounded.lg}'
    padding: '{spacing.5}'
  stat-tile:
    extends: 'card'
    figure: '{typography.figure}'
    label: '{typography.micro}'
  ledger-row:
    minHeight: '52px'
    borderBottom: '1px solid {colors.edge}'
    amount: '{typography.amount}'
  chip:
    radius: '{rounded.full}'
    minHeight: '32px'
    hitArea: '44px'
    border: '1px solid {colors.edge-strong}'
  budget-meter:
    track: '{colors.track}'
    fill: '{colors.track-fill}'
    radius: '{rounded.full}'
    height: '8px'
  chart-surface:
    background: '{colors.surface}'
    gridline: '{colors.edge}'
    axisLabel: '{typography.caption}'
  toast:
    background: '{colors.inverse}'
    color: '{colors.inverse-on}'
    radius: '{rounded.md}'
  dialog:
    background: '{colors.surface}'
    radius: '{rounded.xl}'
    scrim: 'rgba(17, 19, 16, 0.44)'
  focus-ring:
    width: '2px'
    offset: '2px'
    color: '{colors.ring}'
---

# Design System: money-tracker.online

> **Every colour value in this document is historical. `src/styles/tokens.css` is the source of
> truth, and where the two disagree, the stylesheet wins.**
>
> The divergence is not small and not confined to the front matter above. This document describes a
> deep-teal brand on cool grey paper (`brand: #0a4a42`, `canvas: #f7f7f5`, `ink: #111310`, Inter
> Tight); what ships is a blue brand on warm paper (`#064f89`, `#fbf9f5`, `#23201a`, Bricolage
> Grotesque over Inter).
>
> Worse than the values is the vocabulary. **Thirteen names, forty-four mentions, resolve to no
> `--color-*` token at all**, and they are not scattered typos - they are a coherent naming scheme
> that happens to be the wrong one. Three shapes, measured against `src/styles/tokens.css`:
>
> - **A different word for the same idea, applied consistently.** This document says `edge` and
>   `edge-strong`; the stylesheet says `border-subtle` and `border-strong` (17 mentions). It says
>   `accent-on`, `brand-on`, `info-on`, `warning-on`; the stylesheet inverts them to `on-accent`,
>   `on-brand`, `on-info`, `on-warning` (6). It says `brand-subtle`, `info-subtle`,
>   `warning-subtle`, `accent-subtle`; the stylesheet says `-soft`, and has no `accent-soft` at
>   all (7). An author who learns the convention here learns it wrongly and applies it wrongly
>   everywhere, which is the opposite of what a naming convention is for.
> - **A rung that was never built.** `ink-3` appears 5 times, including a ladder described as
>   "three tiers" with contrast ratios quoted for all three. The shipped ladder is `ink` and
>   `ink-2`. There is no third tier and the ratios given for it measure nothing.
> - **Planes that do not map one-to-one.** `surface-2` (5) and `surface-inset` (4) against a
>   stylesheet whose planes are `surface-panel`, `surface-raised` and `surface-sunken`. The count
>   of grounds differs too: this document names four, the stylesheet declares five.
>
> That is the reason this notice exists rather than a footnote. `docs/SPEC.md` §4 makes this
> document the owner of the visual language, so an author reaching for `bg-surface-2` or
> `border-edge-strong` was reading the owning document correctly and still shipping a class that
> resolves to nothing. Two of them did, and the classes sat in five components until
> `src/styles/__tests__/token-classes.test.ts` was written to catch them. That gate catches the
> symptom after the fact; this notice is aimed at the cause.
>
> **What remains authoritative here is structure, not value.** The composition of the ledger row,
> the budget meter's reading order, the chip and chart vocabulary, the motion rules - those are
> what the source files citing this document actually rely on, and they still hold. Read it for
> what a component is made of; never for what colour it is.
>
> Reconciling the two documents is a task of its own and has not been done.

## Overview

**Creative North Star: "The Set Table."**

This is a ledger. The whole design exists to make a column of numbers readable, comparable and
trustworthy at a glance, and everything that does not serve that gets out of the way. Cool paper,
near-black ink, one deep teal that points, and figures set in tabular numerals so that a column of
amounts lines up on the decimal separator whether it holds `9,90` or `12 480,00`.

The product's authority comes from exactness, not from volume. A screen has at most one loud
element: one inverse slab, one primary button, one oversized figure. Everything else is set quietly
enough that the loud thing is heard.

Two constraints shape this system more than taste does, and both are stated as measurements rather
than as preferences:

1. **The palette is designed to a 7:1 floor on text.** Every text token clears 7:1 against every
   one of the four grounds it can land on, in both themes. That floor was chosen before any hue
   was, which is why the ink ladder has three tiers rather than the four a looser floor would have
   allowed.
2. **7:1 against the ground does not make two colours distinguishable from each other.** Measured:
   `series-2` (`#1539a8`) and `series-7` (`#7f1a55`) both clear 7.69:1 against `surface`, and
   against **each other** they measure **1.00:1**. Two chart series can therefore be perfectly
   contrasty and perfectly indistinguishable at the same time. That single measurement is why
   colour never carries information alone anywhere in this product, and why the accessibility
   position in `docs/ACCESSIBILITY.md` is what it is.

**Key characteristics:**

- Cool paper canvas (`#f7f7f5`), never clinical white; in dark, a near-neutral charcoal, never
  pure black.
- One near-black accent and one deep teal brand. No third voice.
- Flat at rest. Shadow answers interaction; it is not a resting property.
- Tabular numerals on every number that can change, without exception.
- Strict 4px grid with no eyeballed exceptions.
- A 44×44 CSS px minimum hit area on every interactive element, everywhere, including inside dense
  ledger rows.
- Light and dark are two designed systems, not one system and its inversion.

## Colors

A cool, low-chroma paper system carrying two saturated voices: a near-black that commands and a
deep teal that points. Every value below is stated with its measured contrast ratio; ratios were
computed against all four grounds (`canvas`, `surface`, `surface-2`, `surface-inset`) and the
**minimum** is the one quoted, because the minimum is the one that has to hold.

### Primary

- **Ink** (`#111310` light / `#f4f5f2` dark): the accent and the body text at once — the darkest
  ink and the loudest fill are deliberately the same value. Primary buttons, inverse slabs, body
  copy. Min contrast **14.92:1** light, **13.31:1** dark.

### Secondary

- **Deep Teal** (`brand`, `#0a4a42` light / `#5fd3bd` dark): links, active navigation, the focus
  ring, selection, the budget meter fill, the primary chart series. It points; it does not command.
  Min **8.10:1** light, **8.00:1** dark. White on the light fill measures 10.14:1.
- **Teal Wash** (`brand-subtle`, `#e2efec` light / `#0e2b26` dark): the tinted ground for upsells,
  empty-state invitations and selected chips. It carries `brand` as readable text at **8.59:1**
  light and **8.29:1** dark, so it is a real surface rather than a decorative tint.

### Tertiary — the four semantic hues

Each has an `-on` foreground measured against its solid fill and a `-subtle` tint that carries its
own hue as text above 7:1:

- **Ledger Green** (`success`, `#0f5236` / `#59d69a`) — settled, paid, reached, within budget.
  Min 7.36:1 / 7.98:1; on `success-subtle`, 7.91:1.
- **Amber** (`warning`, `#6a4004` / `#f0b64a`) — approaching a limit, over quota, unconfirmed,
  overdue soon. Min 7.15:1 / 7.97:1; on `warning-subtle`, 7.66:1.
- **Signal Red** (`danger`, `#8f1e16` / `#ff9b8f`) — destructive confirmation, validation failure,
  exceeded. Never the resting state of a row action. Min 7.10:1 / 7.17:1; on `danger-subtle`, 7.52:1.
- **Reference Blue** (`info`, `#1539a8` / `#9db8ff`) — system notices with no verdict, and planned
  (future-dated) rows. Min 7.69:1 / 7.45:1; on `info-subtle`, 8.14:1.

### The amount hues

Four reserved tokens, and they are the reason `success` and `danger` may never be used
decoratively anywhere near a figure:

| Token             | Light     | Dark      | Means                                      |
| ----------------- | --------- | --------- | ------------------------------------------ |
| `amount-income`   | `#0f5236` | `#59d69a` | money in                                   |
| `amount-expense`  | `#8f1e16` | `#ff9b8f` | money out                                  |
| `amount-transfer` | `#454a41` | `#b3b7ad` | moved between own accounts — no net effect |
| `amount-planned`  | `#1539a8` | `#9db8ff` | future-dated, not yet real                 |

### Neutral

- **Cool Paper** (`canvas`, `#f7f7f5` / `#0e0f0e`): the page ground.
- **Sheet** (`surface`, `#ffffff` / `#171917`): every card face.
- **Recessed Sheet** (`surface-2`, `#eeeeeb` / `#1f221f`) and **Inset** (`surface-inset`,
  `#e6e6e2` / `#262a26`): nested panels, quiet filled buttons, meter tracks, table header bands.
  Depth by tone, not by shadow.
- **The ink ladder** — `ink` (14.92:1 min), `ink-2` (9.71:1 min), `ink-3` (7.27:1 min) light;
  `ink` (13.31:1), `ink-2` (9.62:1), `ink-3` (7.14:1) dark. **Three tiers, and all three clear
  7:1 on all four grounds.** Hierarchy therefore comes from weight and scale, not from fading text
  towards the background.
- **Hairline** (`edge`, `#dcdcd7` / `#2c302c`): decorative separation only.
- **Control Boundary** (`edge-strong`, `#6f7468` / `#7e8479`): the edge of anything interactive.
  Min 3.84:1 light and 3.79:1 dark — above the 3:1 that WCAG 2.2 1.4.11 requires of a control
  boundary, without the heaviness of a full-contrast border. This token is what separates a _drawn_
  box from a _pressable_ one.

### The categorical series palette

Eight hues for charts, pivot rows and category swatches. Measured minimum against the four grounds:
`series-1` 8.10, `series-2` 7.69, `series-3` 7.10, `series-4` 7.15, `series-5` 7.66, `series-6`
7.42, `series-7` 7.69, `series-8` 7.97 (light); 8.00, 7.45, 7.17, 7.97, 7.07, 7.56, 7.63, 8.14
(dark).

They are ordered so that adjacent indices are maximally separated in hue **and** in lightness, and
they are still not sufficient on their own — see the next section.

### Named Rules

**The One Voice Rule.** Ink and Deep Teal are the only two saturated voices in the chrome. A screen
gets at most one inverse slab and one primary button. If a layout needs a third colour to make its
hierarchy legible, the hierarchy is wrong and the palette is not.

**The Semantic Amount Rule.** `amount-income`, `amount-expense`, `amount-transfer` and
`amount-planned` are **reserved**. They may not be used for decoration, for a brand accent, for an
icon that is not about an amount, or for a chart series. Conversely, a figure that represents money
in or out is painted in them and in nothing else. The reason is that a reader learns the mapping in
the first minute of use and then trusts it everywhere; one decorative red total destroys it.

**The Colour-Is-Never-Alone Rule.** Colour is never the sole channel of information anywhere in
this product. Every chart series carries at least one of: a direct in-place label, a distinct marker
shape, or a fill pattern. Every income/expense figure carries a sign or an explicit `+`/`−`. Every
status carries a word or an icon with an accessible name. The justification is measured, not
theoretical: `series-2` and `series-7` differ by **1.00:1** from each other while both clear 7.69:1
against the surface. Contrast against the ground says nothing about distinguishability between two
foreground hues, and a colour-blind reader, a greyscale print and a low-quality projector all
collapse that pair to the same grey.

**The 7:1 Rule.** Every text token clears 7:1 against every ground it can land on, in both themes,
and the measured minimum is recorded as a trailing comment beside the token in
`src/styles/tokens.css`. A token added without its measurement is not finished. **Two named
exceptions, and only two:** (1) disabled control text, which is exempt from contrast requirements
by WCAG and is set at `ink-3` on `surface-inset` with a non-colour disabled affordance beside it;
(2) chart gridlines and axis rules, which are non-text and are held to 3:1. Everything else clears
7:1 or it does not ship.

**The 44px Rule.** Every interactive element has a hit area of at least 44×44 CSS px, including
inside a dense ledger row, including the row's inline category chip, including the sort control in
a table header. Where the _visual_ element is smaller — a 32px chip, a 20px checkbox — the hit
area is expanded with padding or a pseudo-element, and the expansion is part of the primitive, not
something a caller remembers. This is WCAG 2.2 2.5.5 (Enhanced) and it is one of the criteria this
product actually claims, so it is verified rather than assumed: the axe suite checks it on every
route in the visual spec.

**The Measured Pair Rule.** Every colour token that can meet text carries its measured contrast
ratio as a trailing comment beside its declaration, stated against every ground the value can
actually land on rather than against a convenient one.

**The Two Systems Rule.** Dark is designed, not derived. Its surfaces are near-neutral charcoal
rather than inverted paper, its shadows are re-declared darker and tighter rather than reused, and
its semantic hues are lifted rather than flipped. A dark value computed from a light one is a defect.

## Typography

**Display / figure face:** Inter Tight (650/700), with a metric-compatible local fallback.
**Body face:** Inter (400/500/550/600), with a metric-compatible local fallback.

Both faces ship the tabular figure set this product depends on and both cover Polish diacritics
(ą ć ę ł ń ó ś ź ż) at every weight in use. A locale is always named in its own language: _English_,
_Polski_.

### Hierarchy

- **Hero** (700, `clamp(2.5rem, 6.8vw, 5rem)`, 1.0, `-0.032em`): the marketing headline. One per page.
- **Headline** (700, `clamp(2rem, 4.8vw, 3.25rem)`): marketing section openers.
- **Figure** (700, `clamp(1.875rem, 4vw, 2.75rem)`, tabular): the one number a screen is about —
  net worth, a budget's remaining amount, an account balance. One per card, at most two per screen.
- **Title** (650, 24px): page and dialog titles.
- **Subtitle** (600, 17px): card titles and section headings.
- **Body** (400, 15px, 1.6): prose and form labels.
- **Amount** (550, 15px, tabular): every monetary figure inside a list, a table or a form.
- **Caption** (400, 13px): metadata, axis labels, helper text — set in `ink-3`, which still clears
  7:1, so a caption in this product is genuinely readable rather than decoratively grey.
- **Micro** (600, 11px, uppercase, `0.07em`): the whisper label above a Figure. It is the smallest
  type in the system and it is used the most: it is what makes the numeral beneath it loud.

### Named Rules

**The Tabular Rule.** Any number that can change is set in `font-variant-numeric: tabular-nums`.
No exceptions. Every amount, rate, percentage, count, date figure and axis tick, on every surface,
in every locale. "It is inside a `StatTile` already" is not an exemption — the rule is checked on
the rendered element that holds the digits, not on an ancestor. A column of amounts that does not
align on the decimal separator is a bug report waiting to be filed.

**The Aligned Column Rule.** Amounts are right-aligned (`text-align: end`) in every table, list and
form field. The currency symbol or code sits on the _outside_ of the alignment, so the digits align
even when a workspace holds `PLN`, `€` and `¥` in the same view. A left-aligned amount column is a
defect.

**The Two-Step Rule.** Scale contrast is extreme and deliberate: an 11px Micro label sits directly
above a 44px Figure with nothing in between. Intermediate steps soften the pairing and the pairing
is the point.

**The Own-Script Rule.** A language is always named in its own language and its own script, in a
frozen table. `Intl.DisplayNames` is never used for this: it resolves against the _reader's_ locale,
so a Polish reader sees "angielski" where the switcher must say "English".

**The Never-Abbreviate-Money Rule.** An amount is never rendered as `1.2k`, `1,2 tys.` or `€1.2M`
in a ledger, a form, a table cell, a tooltip or an export. Abbreviation is permitted in exactly one
place: a chart **axis tick**, where the full value is available in the chart's visually-hidden data
table and in the point's accessible name. A reader checking their own balance must see the digits.

## Layout

A 4px grid, a 12-column content well capped at 1280px for app surfaces and 1140px for reading
surfaces, and a fixed left rail at ≥1024px that becomes a bottom bar below it.

- **App shell**: header 56px, left rail 248px (collapsed 64px), bottom bar 64px + safe-area inset.
- **Content well**: `padding-inline` 16px at 360px, 24px at 768px, 32px at 1280px and above.
- **Ledger row**: 52px minimum height on desktop, 64px on touch, three columns at 360px
  (payee + category / date / amount) and five at 1280px.
- **Dense mode**: a user preference that reduces row height to 44px and body to 14px. It never
  reduces a hit area below 44px, and it never reduces contrast.

### Named Rules

**The 4px Rule.** Every dimension is a multiple of 4px and comes from a `--space-*` token. There
are no eyeballed one-off margins, and a hard-coded `padding: 13px` is a review rejection.

**The Reserved Edge Rule.** Exactly one thing clears each fixed edge. The content well pads for the
header at the top and for the bottom bar (plus `env(safe-area-inset-bottom)`) at the bottom; a
sticky sub-header composes those values rather than re-deriving them. Two elements both claiming to
clear the same edge is how a focused input ends up under the keyboard on a phone.

**The Focus Reachability Rule.** No sticky, fixed or floating element may cover a focused control —
this is WCAG 2.2 2.4.11 and 2.4.12, and 2.4.12 (Enhanced, _no part_ obscured) is one of the criteria
this product claims. Every sticky region therefore declares `scroll-margin` on its scroll container
sized to its own height, and the e2e suite tabs through every route asserting the focused element's
rect is fully inside the viewport and unoccluded.

## Elevation & Depth

### Shadow vocabulary

- `--shadow-0` — none. The resting state of every surface.
- `--shadow-1` — hover: `0 1px 2px rgba(17,19,16,.06), 0 2px 6px rgba(17,19,16,.06)`.
- `--shadow-2` — popovers, menus, the FAB: `0 2px 4px rgba(17,19,16,.07), 0 8px 20px rgba(17,19,16,.10)`.
- `--shadow-3` — dialogs and drawers: `0 4px 8px rgba(17,19,16,.09), 0 24px 48px rgba(17,19,16,.16)`.

### Named Rules

**The Flat-At-Rest Rule.** A resting surface gets a hairline and a tone, never a shadow step. If a
card needs a shadow to read as a card, its border or its ground is wrong.

**The One-Pixel Rule.** The hover lift is 1px of `translateY` plus one shadow step; the press is
1px back down and one step off. Nothing in this product moves further than a pixel at rest scale.

**The Re-declared Dark Rule.** Dark shadows are written out again — darker, tighter, and with a
1px top hairline of `rgba(255,255,255,.05)` in place of the ambient bounce that does not exist in
dark. A dark shadow that reuses a light shadow's rgba is a defect.

## Shapes

`sm` 4px (chips inside a row, badges) · `md` 8px (buttons, fields, menu items) · `lg` 12px (cards,
panels) · `xl` 18px (dialogs, sheets, the mobile entry drawer) · `full` (chips, avatars, meters,
toggles).

### Named Rules

**The Pill Means Pickable Rule.** `border-radius: full` on a rectangle-shaped element declares it
selectable: a filter chip, a tag, a period toggle. A pill that does nothing when clicked is a lie
the reader only has to be told once.

**The Hairline Honesty Rule.** If a box can be clicked, its border is `edge-strong`. If it cannot,
its border is `edge`. There is no third case, and a decorative `edge-strong` border is a defect.

## Components

### Buttons

Four variants — `primary` (accent fill), `brand` (teal fill, used for the single monetisation CTA
and nothing else), `quiet` (`surface-2` fill with an `edge-strong` border) and `ghost`. All are
44px minimum height with 12px/20px padding, `md` radius, a 2px `ring` focus ring at 2px offset, a
1px hover lift, and a loading state that swaps the label for a spinner **while preserving the
button's width**, because a button that changes size on click moves the thing under the reader's
finger.

### Fields

44px minimum height, `surface` ground, `edge-strong` border, `md` radius. The label is always
visible — a placeholder is never a label. Errors render below the field, are referenced by
`aria-describedby`, use `danger` **and** an icon **and** a text message, and are announced through
a polite live region on blur rather than on every keystroke.

**The amount field** is the most-used control in the product and gets its own treatment: tabular
figures, end-aligned, a currency affix outside the alignment, `inputmode="decimal"`, a locale-aware
parser that accepts both `1 234,56` and `1,234.56` from either locale, and a numeric keypad on
mobile. It never silently rounds what was typed: an input with more decimal places than the
currency's `digits` shows the value it will store before submit.

### Cards and stat tiles

`surface` ground, `edge` hairline, `lg` radius, 20px padding, flat at rest. A stat tile is a Micro
label, a Figure and at most one delta line; the delta carries a sign and an arrow glyph, never
colour alone.

### The ledger row

The signature component. Left: payee (or note) on line one, category chip and account on line two.
Right: the amount in `amount-*`, with the base-currency equivalent beneath it in `caption` when the
transaction's currency is not the workspace base. Whole row is a link; the category chip and the
overflow menu are nested interactive elements with their own 44px hit areas and their own accessible
names. A planned row is set in `amount-planned` **and** carries a "planned" badge — never colour
alone.

### Chips

`full` radius, 32px visual height, 44px hit area, `edge-strong` border. A category chip carries its
category's colour as a 8px dot plus the category **name**; the colour is never the only identifier.

### Charts

Hand-rolled accessible SVG on `d3-scale` / `d3-shape` / `d3-time` — there is no chart library, and
`docs/adr/0007-hand-rolled-accessible-charts-over-a-chart-library.md` records why. Every chart in
this product ships, without exception:

1. A visually-hidden `<table>` carrying exactly the data the chart draws, with a caption.
2. Keyboard-reachable data points (arrow keys move along a series, Home/End jump to the ends), each
   with an accessible name that includes the full unabbreviated amount.
3. A non-colour encoding per series: a marker shape, a dash pattern, or a direct in-place label.
4. Gridlines and axes at 3:1 minimum, axis labels in `caption` at 7:1.
5. A `prefers-reduced-motion` path in which the draw-in animation does not run and the chart is
   simply present.

### Navigation

Left rail at ≥1024px with a collapse control; bottom bar below it with five destinations and a
centred entry FAB. The current destination is marked with `aria-current="page"` **and** a filled
icon **and** a 3px inline start bar — three channels, one meaning.

### Signature: the Budget Meter

A `full`-radius 8px track with a teal fill, a tick at the 100% mark, and — this is the part that
matters — a threshold marker for each configured alert (50 / 80 / 100 by default) drawn as a 2px
notch. Over 100% the fill continues in `danger` past the tick and the meter's accessible name says
"116% of 1 200,00 zł spent", so a screen-reader user gets the overspend as a sentence and not as a
red rectangle.

## Motion

150–260ms, `--ease-out-quint` or a sibling token, transform and opacity only. Layout-affecting
properties are never animated. `prefers-reduced-motion: reduce` removes every non-essential
animation — the chart draw-in, the number roll-up, the row-enter stagger, the drawer slide — and
leaves crossfades under 100ms where a state change would otherwise be invisible.

## Do's and Don'ts

### Do

- Set every changeable number in tabular figures and right-align its column.
- Give every drag surface a keyboard equivalent in a menu ("Move up", "Move down", "Move to…"),
  and ship the menu in the same change as the drag.
- Give every chart a visually-hidden data table in the same component that draws it.
- Expand a small control's hit area inside the primitive, so callers cannot forget.
- Re-declare dark shadows and dark semantic hues.
- Record every colour token's measured contrast beside its declaration.
- Say the full amount in an accessible name, even where the visual is abbreviated.

### Don't

- Don't use `success` or `danger` decoratively anywhere near a figure.
- Don't encode a chart series, a status or a category by colour alone.
- Don't abbreviate money outside a chart axis tick.
- Don't render an amount from a float, at any layer, for any reason, including a tooltip.
- Don't put a shadow on a resting surface.
- Don't fade text below 7:1 to create hierarchy — change weight or scale instead.
- Don't animate a layout property, and don't ship an animation without a reduced-motion path.
- Don't claim AAA conformance in any copy. `docs/ACCESSIBILITY.md` states exactly what is claimed;
  the reason a blanket claim is refused is on the next line.

## The accessibility position, and why the claim is scoped

**WCAG 2.2 Level AA is the hard gate**, product-wide, enforced in CI: `@axe-core/playwright` runs
on every route in the visual spec and any `serious` or `critical` violation fails the build.

**Five AAA criteria are additionally held to AAA** and are verified rather than aspired to:
2.5.5 Target Size (Enhanced) — the 44px Rule; 2.4.11 and 2.4.12 Focus Not Obscured — the Focus
Reachability Rule; 1.4.8 Visual Presentation; 2.2.6 Timeouts; and 3.3.9 Accessible Authentication
(Enhanced). The palette is designed to a 7:1 text floor, which is 1.4.6's threshold.

**A blanket "WCAG 2.2 AAA" claim is not made, and no user-facing or marketing copy may make one.**
Three reasons, in order of weight:

1. **It would be false.** Several AAA criteria are unachievable or actively product-hostile here.
   1.4.6 cannot hold across the categorical series palette — and, as the measurement at the top of
   this document shows, holding it there would not even help, because 7:1 against the ground says
   nothing about two series being distinguishable from each other. 3.1.5 (lower-secondary reading
   level) conflicts with vocabulary a finance product cannot avoid. 2.4.9 (link purpose from link
   text alone) is hostile to a dense ledger table where "Edit" is the honest label and the row is
   the context.
2. **It would be a legal exposure.** A published accessibility statement is a representation. In
   the EU, an overstated one is a false statement about an accessibility feature, and this product
   is squarely inside the European Accessibility Act's scope.
3. **A scoped claim is more useful than a broad one.** "AA everywhere, plus these five AAA criteria,
   and here is every AAA criterion we do not meet and why" tells a reader something they can act on.
   "AAA" tells them nothing they can check.

`docs/ACCESSIBILITY.md` is the authoritative statement and lists every AAA criterion, claimed or
excluded, with its reason. This document must never contradict it.
