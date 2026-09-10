# Accessibility conformance statement — money-tracker.online

**Status:** authoritative. This document wins over `docs/SPEC.md`, `DESIGN.md`, `PRODUCT.md` and
over every line of user-facing copy on any point of accessibility conformance.

**Last reviewed:** 2026-09-06 · **Standard:** WCAG 2.2 · **Scope:** the whole product — the
marketing site, the authentication screens, the application, the settings surfaces and the platform
console — in both supported locales (English, Polish) and both themes.

---

## 1. The claim, exactly

> money-tracker.online conforms to **WCAG 2.2 Level AA**. In addition, the following **Level AAA**
> success criteria are met: **1.4.8 Visual Presentation**, **2.2.6 Timeouts**, **2.4.12 Focus Not
> Obscured (Enhanced)**, **2.5.5 Target Size (Enhanced)** and **3.3.9 Accessible Authentication
> (Enhanced)**. Level AA criterion **2.4.11 Focus Not Obscured (Minimum)** is met as part of the AA
> conformance and is named here because its Enhanced sibling is claimed.
>
> **This product does not claim Level AAA conformance.** Section 4 lists every Level AAA success
> criterion that is not met, with the reason.

That paragraph is the only conformance wording permitted on a public surface. It may be translated;
it may not be shortened, strengthened, or summarised as "WCAG 2.2 AAA", "AAA compliant",
"fully accessible" or "accessible to everyone".

---

## 2. Why the claim is scoped rather than blanket

Three reasons, in order of weight.

### 2.1 A blanket AAA claim would be false

WCAG itself says a AAA conformance claim is not recommended as a general policy for entire sites,
because it is not possible to satisfy every AAA criterion for all content. That is not a technicality
here — it is the concrete situation, and §4 names each case.

The sharpest example is **1.4.6 Contrast (Enhanced)**. Our palette _is_ designed to 7:1 and every
body and UI text token clears it against every ground in both themes. But the product is a
reporting tool, and its categorical series palette must carry eight simultaneously-visible series.
Measured on our own tokens: `series-2` (`#1539a8`) and `series-7` (`#7f1a55`) each clear **7.69:1**
against `surface` — and against **each other** they measure **1.00:1**. Contrast against the ground
is silent about whether two foreground hues are distinguishable. Chasing 7:1 across eight hues would
not fix the real problem and would collapse the palette's hue separation while doing it. Our answer
is the Colour-Is-Never-Alone Rule (`DESIGN.md`): every series carries a shape, a pattern or a direct
label, and every chart carries a text equivalent. That is a stronger outcome than a 1.4.6 tick, and
it is still not a 1.4.6 tick.

One token sits on 1.4.6's own **large-text** threshold rather than its body one, and that is worth
stating plainly, because at a glance it looks like a lapse. `negative-bold` paints exactly two kinds
of thing: the over-budget headline in `AmountMeter`, which is bold at 20px or 32px and is therefore
large text by the criterion's own definition and scored at **4.5:1**; and an over-limit meter fill
that covers its whole track, which is a graphical object under **1.4.11** at 3:1. One value serves
both, held to the stricter of the two floors. It exists because the body-grade `negative` cannot
also be a danger colour — pinned
at 7:1 as a caption ink, its dark value can only be a pale salmon, since red is luminance-poor and no
deeper red in sRGB reaches that floor. "Whole track" is the load-bearing half of the second job: a
full fill's neighbour is the card, a partial one's is `border-subtle`, and there the loud grade
measures 3.18:1 in dark against `negative`'s 5.02:1. `AmountMeter` and `BudgetMeter` are full by
construction; `ui/Meter` decides from its own `dangerAt` prop, taking the loud grade at `>= 1` —
where the danger state needs `percentage >= 100` — and `negative` below it (#180). The measured
ratio for each value against every ground it can
land on is recorded beside the declaration in `src/styles/tokens.css`, and
`src/styles/__tests__/tokens-contrast.test.ts` recomputes on every run the five opaque planes plus
the hover wash over `surface` — the composited ground a hovered row actually has — each at the
threshold that applies to that grade, and both grades against the track a partial fill would stop
on. The remaining composited grounds in those comments, `press`
and either wash over `surface-raised`, are hand-measured; #178 is where what `negative-bold` is
worth on them gets decided. No body-size text moved: everything that was at 7:1 is still at 7:1.

### 2.2 A published statement is a representation, and an overstated one is a liability

This product serves EU residents and stores their financial data. An accessibility statement is a
public representation about the product. Overstating it is a false statement about an accessibility
feature and is a real legal exposure under the European Accessibility Act and the national
implementations of it, quite apart from being dishonest to the people it would mislead.

### 2.3 A scoped claim is more useful than a broad one

"AA everywhere, plus these five AAA criteria, and here is every AAA criterion we do not meet and
why" tells a reader something they can act on before signing up. "AAA" tells them nothing they can
check.

---

## 3. Level AAA criteria that are met and claimed

Five, each with what makes it true and how it is verified.

### 3.1 — 1.4.8 Visual Presentation

- Foreground and background colours are user-selectable via the theme control (light, dark, system)
  and the product honours the OS setting when no explicit choice is made.
- Body text blocks are capped at **80 characters**: `--measure` is 64ch, applied by the
  `prose-measure` utility in `src/styles/app.css`, and the few descriptions that cap themselves
  inline stop at 60-68ch (`max-w-prose` is 65ch).
- Text is **not justified**; every text block is start-aligned.
- Line spacing is at least **1.5** within paragraphs (`body` is 1.55; `label` and `caption`, which
  also carry helper text and descriptions, are 1.5) and paragraph spacing is at least 1.5× the
  line spacing.
- Text resizes to **200%** without horizontal scrolling on a full-screen window; that is a 1280px
  viewport reflowed to 320px CSS width.

_Verified by:_ the 1.4.8 probe in `.github/a11y/axe-scan.mjs`. On every route in
`.github/a11y/routes.json`, at 393px in the light theme, it reads the computed style of every
paragraph, list item, definition and quotation longer than 60 characters and reports a line height
under 1.5×, justified text, a paragraph gap under 1.5× the line height, and an estimated line
longer than 80 characters. The probe is advisory (§5.2): it reports, and does not fail the build.
Nothing automated exercises 200% zoom and no lint rule forbids justification; the reflow is the
manual check in §5.3.

### 3.2 — 2.2.6 Timeouts

The only timeout in the product is the authenticated session, and it is long: **30 days**, moved
forward a day at a time while the person keeps using the product (`SESSION_EXPIRES_IN` and
`SESSION_UPDATE_AGE` in `src/server/auth/config.ts`). No period of inactivity shorter than that
signs anybody out or discards anything, which is the criterion's own exception - data preserved
for more than 20 hours of inactivity needs no warning - and it is the whole of why 2.2.6 holds.
There is no idle warning, and there is no draft that survives a re-authentication: a form open
when the 30 days run out is lost, and a person is told so only by the sign-in screen.

The other things that expire are links and invitations, not the person's data. A reset or
verification link works for an hour and the screen that sends it says so; a pending invitation
shows its expiry date in Settings → People.

_Verified by:_ nothing automated. `.github/a11y/axe-scan.mjs` records 2.2.6 as a manual item on
every run because a session lifetime can only be judged against what the product tells the person,
and that is prose. The two constants above are the evidence; changing either is a change to this
section.

### 3.3 — 2.4.11 Focus Not Obscured (Minimum) and 2.4.12 Focus Not Obscured (Enhanced)

**No part** of a focused component is hidden by author-created content. The product has a sticky
header, a sticky table header band and a bottom bar on mobile — every one of which is a candidate
obscurer. The document reserves their heights once, for every route: `<html>` carries
`scroll-padding` for the 64px header and, below `lg`, for the bottom bar (`src/routes/__root.tsx`),
and the ledger's rows add their own `scroll-margin` for the table header band above them. Anything
the browser scrolls into view — a focused control, a fragment target — comes to rest inside those
edges rather than under them.

_Verified by:_ the 2.4.11 / 2.4.12 probe in `.github/a11y/axe-scan.mjs`. On every route in
`.github/a11y/routes.json`, at 393px in the light theme, signed in where the route needs it, it
focuses up to the first 80 focusable elements in DOM order and asks `document.elementFromPoint` at
the four inset corners of each one's bounding rect whether the answer is the element, a descendant
or an ancestor. A corner off-screen or answered by something else is reported as 2.4.12; all four
as 2.4.11. The probe is advisory (§5.2). Nothing automated covers the dark theme, other widths or
a real Tab traversal: `e2e/keyboard.spec.ts` tabs through the ledger and the entry form at the
three project viewports, but it asserts reachability and focus order, not obscuring.

### 3.4 — 2.5.5 Target Size (Enhanced)

Every interactive target is at least **44×44 CSS px**, including inside dense ledger rows, including
inline category chips, including table sort controls, including the calendar day cells in the date
picker. Where the visual element is smaller, the hit area is expanded inside the primitive — with
padding or a pseudo-element — so a caller cannot forget to do it.

Dense mode reduces row height and body size; it never reduces a hit area below 44px.

Rows inside a floating collection - a menu item, a select option, a combobox suggestion - are held
at 44px by a real `min-height` on the shared item base (`collectionItemBase` in
`src/components/ui/shared.ts`) rather than by the pseudo-element: stacked rows with overlapping hit
areas would each take the other's edge pixels, and a real height is what a finger actually lands on.

_Verified by:_ `.github/a11y/axe-scan.mjs`, which on every route in `.github/a11y/routes.json`
enumerates every element matching the interactive-role selector and reports any whose bounding rect
is under 44 CSS px on its smaller edge, honouring the in-sentence exception and
`data-a11y-target-exempt`. That scan measures what is on the page when the route loads, so the rows
of a closed menu or select are outside it; those are covered by the primitive above, and
`src/components/ui/__tests__/menu.test.tsx` pins the class that provides the height.

### 3.5 — 3.3.9 Accessible Authentication (Enhanced)

No cognitive function test is required at any step of authentication or account recovery:

- Sign-in is email and password. Every credential field carries the `autocomplete` token a
  password manager needs (`email`, `current-password`, `new-password`), **permits paste** and
  blocks nothing a browser would fill in.
- **There is no CAPTCHA anywhere.** Abuse is held off server-side, per path, by the rate limits in
  `src/server/auth/config.ts`.
- Email verification and password reset are link-based; no code must be transcribed from one device
  to another.
- No puzzle, no image identification, no "type the characters", no memory test beyond the person's
  own credential.
- Two-step verification is configured on the server but has no screen yet, and passkeys are
  catalogue strings without a sign-in path. Neither is a step a person can reach today, so neither
  is claimed here; when either ships, its code field is held to the same rules.

_Verified by:_ the 3.3.9 probe in `.github/a11y/axe-scan.mjs`, on the four routes
`.github/a11y/routes.json` marks `access: form` (`/login`, `/register`, `/forgot-password`,
`/reset-password`). It asserts every visible password field carries a `current-password` or
`new-password` token and installs no `onpaste` handler, every identifier field carries a
`username` or `email` token, and no element or frame that looks like a reCAPTCHA, hCaptcha or
Turnstile challenge is visible. The probe is advisory (§5.2). That a paste actually lands in the
field is not asserted anywhere; it is a manual item in §5.3.

---

## 4. Level AAA criteria that are NOT met, with reasons

Every Level AAA success criterion in WCAG 2.2 that is not in §3, with an honest reason. "Not
applicable" is stated where a criterion's trigger content does not exist in the product; that is a
reason not to claim it, not a claim.

| SC         | Name                                     | Why it is not claimed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.2.6**  | Sign Language (Prerecorded)              | Any prerecorded video we publish (a product tour, a feature explainer) would require a sign-language interpretation we do not produce. Rather than promise it and then break the promise the first time marketing ships a clip, we exclude it. Today the product ships no prerecorded audio-visual content; captions and transcripts are provided when it does (1.2.2 / 1.2.3 at A/AA).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **1.2.7**  | Extended Audio Description (Prerecorded) | Same content class as 1.2.6, same reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **1.2.8**  | Media Alternative (Prerecorded)          | Same content class. A full text alternative for future video is an intention, not a conformance claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **1.2.9**  | Audio-only (Live)                        | Not applicable: there is no live audio anywhere in the product.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **1.3.6**  | Identify Purpose                         | Requires programmatically identifying the purpose of icons, regions and controls with a vocabulary (ARIA 1.3 / personalisation semantics) that has no meaningful user-agent or assistive-technology support today. We use landmark roles and accessible names throughout, but marking up purpose against an unsupported vocabulary would be a claim nobody can verify.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **1.4.6**  | Contrast (Enhanced)                      | **Met for body and UI text** — every text token on that grade clears 7:1 against every ground in both themes. The one token that is not on it, `negative-bold`, is on the criterion's own **large-text** grade and clears the 4.5:1 that grade is scored at, again against every ground in both themes (light 5.09:1, dark 4.57:1 on the binding ground, which is a hovered row rather than a plane). Large text there is WCAG's definition, not ours — bold at ≥ 18.66px — and the only text it covers is the over-budget headline in `AmountMeter` (§2.1). Still **not claimed product-wide**, because the eight-hue categorical series palette cannot hold 7:1 across eight simultaneously distinguishable hues in both themes, and, as §2.1 measures, 7:1 against the ground would not make two series distinguishable from each other anyway. Mitigation: the Colour-Is-Never-Alone Rule, a text equivalent on every chart, and keyboard-reachable data points. |
| **1.4.7**  | Low or No Background Audio               | Not applicable: the product plays no audio.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **1.4.9**  | Images of Text (No Exception)            | The product uses no images of text except a logotype, which is the criterion's own exception — but marketing OG images and social cards render text into a bitmap by construction. Those are generated images of text, so a no-exception claim would be false for the public surface even though the application itself is clean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **2.1.3**  | Keyboard (No Exception)                  | Every function is keyboard operable and every drag-and-drop surface ships a non-drag control, which is the substance of the criterion. It is not claimed because "no exception" requires a whole-product guarantee across every future third-party embed (payment provider redirects, OAuth consent screens) whose keyboard behaviour we do not control.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **2.2.3**  | No Timing                                | Not met, and cannot be: authenticated sessions expire. That expiry is a security requirement for a product holding financial data, and the criterion admits no such exception. 2.2.6 (claimed, §3.2) is the criterion that actually protects the person here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **2.2.4**  | Interruptions                            | Not met. Toast notifications, background sync results and budget-threshold alerts can appear without being requested. Notification preferences let a person turn categories of them off, but there is no single "postpone all except emergencies" control, which is what the criterion asks for.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **2.2.5**  | Re-authenticating                        | Partially met — unsaved form data survives a re-authentication in the transaction, budget and rule editors (§3.2) — but not across every flow: a long import mapping session that outlives the session is restarted rather than resumed. Not claimed until it holds everywhere.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **2.3.2**  | Three Flashes                            | Vacuously satisfied: nothing in the product flashes. Not claimed because a conformance claim implies ongoing verification and we do not automate a flash check; if a future chart animation or a marketing asset introduced flashing, nothing would catch it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **2.3.3**  | Animation from Interactions              | **Effectively met** — `prefers-reduced-motion: reduce` removes every non-essential animation without exception, which is the criterion. Not claimed only because we cannot make the guarantee for third-party redirect screens (payment provider, OAuth consent) that form part of some journeys. Everything we render honours it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **2.4.8**  | Location                                 | Partially met: breadcrumbs exist on nested application surfaces and the navigation marks the current destination three ways. Not claimed because the marketing and legal surfaces have no breadcrumb trail and the platform console's deep views do not always state their position in a hierarchy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **2.4.9**  | Link Purpose (Link Only)                 | Not met, deliberately. A ledger table has thousands of rows whose row-level actions are honestly labelled "Edit" and "Delete"; the purpose comes from the row, which is the programmatically-determined context 2.4.4 (AA, met) permits. Making every one of those links self-describing would produce screen-reader output that is dramatically worse to navigate, not better.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **2.4.10** | Section Headings                         | Partially met — every screen and every long-form document uses a correct heading hierarchy — but not claimed, because the criterion covers organising _content_ by headings generally and some dense settings surfaces are organised by fieldsets and lists rather than by headings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **2.4.13** | Focus Appearance                         | Our focus indicator is a 2px ring at 2px offset in the `ring` token, which meets the criterion's area and contrast thresholds by construction on every control we render. Not claimed because native browser-rendered UI within our forms — a `<select>` dropdown list, the file-picker dialog, an OS date picker on some mobile browsers — renders a user-agent indicator we cannot measure or control.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **2.5.6**  | Concurrent Input Mechanisms              | Believed met — nothing in the product restricts input modality, and touch, mouse and keyboard work simultaneously on the same surfaces — but it is not verified on the device matrix a claim would need, so it is not claimed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **2.5.7**  | Dragging Movements                       | This is a **AA** criterion in WCAG 2.2 and is met as part of the AA claim: every drag-and-drop surface (dashboard grid, category tree, rule ordering, account ordering) ships a non-drag control in a menu, shipped in the same change as the drag. Listed here because it is frequently mistaken for AAA.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **3.1.3**  | Unusual Words                            | Not met. The product uses terms with specific meanings — _minor units_, _reference amount_, _rollover_, _balance adjustment_, _recurring series_ — and while `CONTEXT.md` defines them for contributors, the product does not ship an in-context glossary mechanism for every occurrence of every such term.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **3.1.4**  | Abbreviations                            | Not met. ISO 4217 currency codes (`PLN`, `KWD`) are abbreviations that appear thousands of times per screen; expanding each first occurrence programmatically would be noise, not help. Currency codes are given an expanded accessible name in the currency picker, where the expansion is actually useful.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **3.1.5**  | Reading Level                            | Not met, and not achievable without lying to the reader. Financial vocabulary that cannot be lowered below upper-secondary reading level without losing precision is unavoidable in this product — _exchange rate_, _credit limit_, _amortisation_, _reconciliation_, _minor unit_. We do write plainly, define terms where they first matter, and never use jargon where a plain word exists; that is a quality practice, not a 3.1.5 claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **3.1.6**  | Pronunciation                            | Not met. Neither English nor Polish content in this product contains homographs whose meaning depends on pronunciation, so the criterion has no bite here — but there is no pronunciation mechanism, so it is not claimed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **3.2.5**  | Change on Request                        | Not met. Some surfaces update without an explicit request: the notification bell count, a background-refreshed exchange rate on the currencies screen, and an import batch's live status. Each announces itself politely and none moves focus or reflows content under the reader, which is what 3.2.2 (A, met) requires — but they are not on request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **3.3.6**  | Error Prevention (All)                   | Not met. Financial, legal and destructive submissions are reversible or confirmed and checked (3.3.4, AA, met) — deleting a transaction, closing a budget, running an import, changing a plan, deleting an account. Ordinary form submissions like renaming a tag are not put behind a review step, because doing so would make routine work slower for no safety gain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Criteria not listed above** are either Level A or Level AA (and are therefore covered by the AA
conformance claim in §1) or are one of the five claimed in §3.

---

## 5. How conformance is verified

### 5.1 Automated, on every change

`@axe-core/playwright` runs on **every route in the visual spec**, in both themes, at 360px, 1280px
and 2560px, in both locales. The gate:

- Any violation at **`serious` or `critical` fails the build.** There is no waiver list for these.
  §5.5 is not one: it records the single case where axe reports a defect **in itself**, and it
  substitutes a stronger assertion rather than lowering the bar.
- A `moderate` violation must be named and justified in the stage's Verification block, or it fails.
- The tolerance list for console messages is fixed and **no stage may append to it to green its own
  run**. React hydration mismatches are never tolerated.

Axe covers roughly a third of WCAG by criterion count. It is a floor, not a claim, and this document
says so out loud because "axe is clean" has been mistaken for "the product is accessible" in every
project that has ever run it.

### 5.2 Automated, criterion-specific

There is no e2e case per AAA criterion. What holds the criteria in §3 is the second pass of
`.github/a11y/axe-scan.mjs`, which the `a11y` workflow runs on every pull request after the A/AA
gate: every route in `.github/a11y/routes.json`, at 393px in the light theme, probed for 2.5.5,
2.4.11 / 2.4.12, 1.4.8 and (on the four auth routes) 3.3.9, then scanned with axe's own
AAA-tagged rules, which is where 1.4.6 enhanced contrast is measured. Every finding from that pass
is **advisory**: it lands in the run's summary and its artifact and does not fail the build. Only
the A/AA pass can. The named probes are heuristics over the rendered DOM, each described under its
criterion above; 2.2.6 has no automated form and the run records it as a manual item on every run.
2.5.5 is the one criterion with a second, failing hold: `src/components/ui/__tests__/menu.test.tsx`
pins the row height of the menu and list-box primitives.

2.4.2 Page Titled, which is Level A, is held by a failing assertion rather than an advisory one:
`e2e/accessibility.spec.ts` asserts on every scanned surface, in both locales, that the document
title is the screen's own `<h1>` followed by the product name, as `src/routes/-lib/page-title.ts`
composes it.

### 5.3 Manual, per stage

Every stage's Verification block owes, and an auditor checks:

- Keyboard traversal of the surface end to end with a sensible focus order.
- A non-drag path exercised for every drag affordance.
- The chart text equivalent read, not assumed.
- Light and dark parity at three widths.
- `prefers-reduced-motion: reduce` set, and the surface still usable and still legible.
- Text at 200% zoom in a 1280px window, with no horizontal scroll (§3.1).
- A generated password pasted into each credential field on the auth routes, and accepted (§3.5).
- Zero console errors or warnings; zero layout shift after paint.

### 5.4 Not yet done, and stated as such

- **No assistive-technology test pass** with NVDA, JAWS or VoiceOver has been performed. Automated
  tooling and manual keyboard testing are not a substitute for it, and no claim in this document
  rests on screen-reader testing that has not happened.
- **No third-party accessibility audit** has been commissioned.
- **No usability testing with disabled users** has been run.

These three gaps are the honest limit of what §1 claims, and they are listed here rather than
omitted. When any of them is done, this section is updated first and the claim second.

### 5.5 Corrections applied to the tool, and the one on record

A testing tool can be wrong. When it is, the answer is neither to believe it and damage the product
nor to switch the rule off — it is to establish what a reader actually gets, correct the tool by the
narrowest possible amount, and assert the behaviour the correction claims. This section is the whole
list. It has one entry.

#### axe-core 4.13.0 · `aria-allowed-attr` · the credit meter on `/accounts`

|                 |                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reported**    | `critical` · `aria-allowed-attr` — "ARIA attributes are not allowed: `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-valuetext`", on the credit-utilisation meter, in both themes and both locales (four scans). |
| **Element**     | `src/components/ui/meter.tsx`, used by `src/components/app/accounts/credit-utilisation.tsx`.                                                                                                                              |
| **Verdict**     | **False positive. A defect in axe-core, not in the product.**                                                                                                                                                             |
| **Decided**     | 2026-09-02                                                                                                                                                                                                                |
| **Re-check by** | **2027-03-01**, or the next axe-core upgrade, whichever comes first.                                                                                                                                                      |

**What the markup does.** React Aria's `Meter` renders `role="meter progressbar"`. ARIA 1.2 reads
`role` as a space-separated _list_ of role tokens and requires the agent to use the first one it
supports, which makes the list the standard way to ship a newer role with an older one behind it.
`@react-aria/meter` emits it deliberately; its own comment names Chromium bug 944542 and Firefox bug
1460378 as the reason. Both are long closed — Firefox shipped the ARIA `meter` role in **Firefox 93,
October 2021** — so the second token is now vestigial for every engine this product is tested in.
All four attributes axe names are allowed on `meter`.

**What axe does wrong.** In `axe-core@4.13.0`, `ariaAllowedAttrEvaluate` calls `getRole(vNode)`
**without** `{ fallback: true }`, and `getExplicitRole` then evaluates
`const roleList = fallback ? tokenList(roleAttr) : [roleAttr]` — so `"meter progressbar"` is looked
up as though it were one role name, nothing matches, and the element resolves to _no role at all_.
A role-less element is allowed only the global attributes, so every value attribute on it is
flagged. axe owns the token-list splitter; this one check does not ask for it. Reproduced on a
minimal fixture: 4.13.0 flags `role="meter progressbar"` **and** `role="progressbar meter"`, and
does not flag `role="meter"` — token order makes no difference, which is the signature of a
resolution failure rather than a judgement about `meter`.

**What a reader actually gets.** Chrome's own accessibility tree, dumped over CDP on this page,
computes the node as `role: "meter"`, `name: "zł 1,692.11 of zł 10,000.00 used, 17%"`,
`value: 0.169…`, `valuemin: 0`, `valuemax: 1` — byte for byte the tree it computes for a
hand-written `role="meter"` carrying the same attributes. WebKit resolves the list to `meter` as
well. The role is right, the name is the whole sentence rather than a bare percentage, and the
value is exposed.

**The two routes considered.**

1. _Force a single `role="meter"` onto the node with a ref after mount._ Rejected — but not
   dismissed, and the case for it is real: the second token buys nothing in any engine we test in,
   and Adobe's own newer system, Spectrum Web Components 2nd generation, is replacing
   `role="meter progressbar"` with `role="meter"` for exactly that reason. What is rejected is doing
   it _here, at runtime_. It writes to the DOM behind React's back on a server-rendered document, so
   the streamed markup and the hydrated markup disagree for the length of the hydration; it has to
   be re-applied whenever React rewrites the attribute; and it changes correct, working markup in a
   vendored component to please a tool that admits it is wrong about it. The right place for that
   change is upstream in `@react-aria/meter`, whose stated reason for the fallback (no `meter` in
   Firefox) expired in 2021 — **raise it there** rather than patching the symptom in this
   repository. Forking `Meter` onto our own `useMeter()` call would also work and is the fallback
   plan if this correction ever has to be removed before axe is fixed.
2. _Correct the tool, narrowly, in the spec that runs it._ **Chosen.** Cheapest to reverse, changes
   nothing a reader receives, and leaves the product markup matching what the library ships.

**How narrow, exactly.** `e2e/accessibility.spec.ts` drops an `aria-allowed-attr` node only when all
three of these hold:

- the rule is `aria-allowed-attr` — every other rule is untouched;
- the **live** element's `role` attribute is exactly `meter progressbar` — read from the DOM, not
  from axe's truncated HTML snippet;
- **every** attribute axe flagged is one of `aria-valuenow`, `aria-valuemin`, `aria-valuemax`,
  `aria-valuetext`.

The rule stays enabled, on this page and on every node of it. Nothing is excluded from the scan and
no rule is disabled. Verified by injecting faults: adding a fifth attribute (`aria-checked`) to that
same meter fails the build, and an unrelated role-less element carrying `aria-valuenow` fails the
build, both reported in full.

**What replaces the dropped finding.** `the credit meter on accounts announces as a meter, with its
whole sentence as the name` in the same spec asserts, positively, that the fallback list is present,
that every one of them resolves to `meter` and none to `progressbar`, that the accessible name is
the sentence, and — on Chromium, over CDP — that the browser's own accessibility tree agrees. That
is a stronger claim than the rule it stands in for, which only ever checked an attribute list.
`src/components/ui/__tests__/meter.test.tsx` pins the role string the correction is scoped to, so a
React Aria upgrade that changes it fails in unit tests rather than silently un-scoping the
correction.

**How this entry is removed.** When `aria-allowed-attr` passes `{ fallback: true }` to `getRole`,
delete `isMeterFallbackRoleArtefact` and `withoutKnownAxeDefects` from the spec and delete this
subsection. Tracking: <https://github.com/dequelabs/axe-core/issues/3768> — "Support fallback roles",
open, milestoned for axe-core **5.0**, no date, and reported there against this exact component
("We noticed this on the Adobe React Spectrum meter component", December 2024). Note that axe-core
4.11 taught **only** `aria-prohibited-attr` to split the list
(<https://github.com/dequelabs/axe-core/pull/4325>, whose author says plainly "At this time, I do not
plan to add fallback roles support for other checks"), so a patch-level upgrade will not clear this
and the re-check must actually re-read the check rather than assume.

Adding a **second** entry to this section requires the same evidence this one carries — the
browser's own accessibility tree, the mechanism inside the tool, both routes weighed, and a re-check
date — and an ADR, because a list of tool corrections that grows without one is a waiver list
wearing a different hat.

---

## 6. Known limitations for a person using the product today

- **Charts are read through their data table.** A screen-reader user gets a full, correct table for
  every chart, and keyboard-reachable points on the chart itself — but the visual gestalt of a trend
  is not conveyed by the table. Summary sentences ("net worth rose 4,2% over the period") are
  provided on the analytics surfaces and are not yet on every dashboard widget.
- **Third-party screens are outside our control.** The payment provider's checkout and the OAuth
  consent screens of Google and Apple are rendered by those vendors. We link to their own
  accessibility statements from Settings → Billing and Settings → Security.
- **Imported data can contain inaccessible content.** A payee name that is a string of emoji, or a
  note in a language other than the interface language, is passed through as the person entered it.
  We set `lang` on user content where we know it and do not otherwise alter it.
- **Dense mode reduces text size** to 14px body. It never reduces a hit area or a contrast ratio,
  but it is a person's own choice to make and the default is the larger setting.

---

## 7. Feedback and escalation

If any part of this product is not usable for you, tell us and we will treat it as a defect with the
same weight as a wrong number:

- In-product: Settings → Help → _Report an accessibility problem_.
- By email: the address published on the Security page.

We aim to acknowledge within two business days and to give a fix or a workaround date within ten. If
a report shows a statement in this document to be wrong, **this document is corrected first**, before
the fix ships, because a wrong conformance claim is the more serious defect.

---

## 8. Change control

This document is amended by a pull request like any other file, and:

- **Adding a criterion to §3 requires a passing automated case that holds it**, named in the section.
- **Removing a criterion from §4 requires evidence, not an opinion.**
- **Weakening §1's wording requires an ADR.** `docs/adr/0009-scoped-wcag-conformance-claim.md` is the
  current record of why the claim is shaped this way.
- No copy anywhere in the product, the marketing site, a commit message, a README or a plan may state
  a conformance level broader than §1. That prohibition is repeated in `CLAUDE.md`, `CONTRIBUTING.md`,
  `PRODUCT.md`, `DESIGN.md` and `docs/SPEC.md` §10 on purpose.
