# Accessibility conformance statement — money-tracker.online

**Status:** authoritative. This document wins over `docs/SPEC.md`, `DESIGN.md`, `PRODUCT.md` and
over every line of user-facing copy on any point of accessibility conformance.

**Last reviewed:** 2026-09-01 · **Standard:** WCAG 2.2 · **Scope:** the whole product — the
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
text token clears it against every ground in both themes. But the product is a reporting tool, and
its categorical series palette must carry eight simultaneously-visible series. Measured on our own
tokens: `series-2` (`#1539a8`) and `series-7` (`#7f1a55`) each clear **7.69:1** against `surface` —
and against **each other** they measure **1.00:1**. Contrast against the ground is silent about
whether two foreground hues are distinguishable. Chasing 7:1 across eight hues would not fix the
real problem and would collapse the palette's hue separation while doing it. Our answer is the
Colour-Is-Never-Alone Rule (`DESIGN.md`): every series carries a shape, a pattern or a direct label,
and every chart carries a text equivalent. That is a stronger outcome than a 1.4.6 tick, and it is
still not a 1.4.6 tick.

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
- Body text blocks are capped at **80 characters** (`max-width: 68ch` on reading surfaces).
- Text is **not justified**; every text block is start-aligned.
- Line spacing is at least **1.5** within paragraphs (`body` is 1.6) and paragraph spacing is at
  least 1.5× the line spacing.
- Text resizes to **200%** without horizontal scrolling on a full-screen window; verified at 320px
  CSS width at 200% zoom, which is the 1280px viewport reflowed.

_Verified by:_ the `visual-presentation` e2e case, which sets 200% zoom at 1280px and asserts no
horizontal document scroll on every route in the visual spec, plus a lint rule forbidding
`text-align: justify`.

### 3.2 — 2.2.6 Timeouts

The only timeout in the product is the authenticated session. The person is told its duration during
authentication and in Settings → Security; inactivity does not silently discard work; and unsaved
form state in the transaction, budget and rule editors survives a re-authentication because it is
held in the form state and restored after the sign-in round trip.

No in-app flow expires a person's data without warning. The import preview, the export job and the
backup artefact each state their own expiry on the screen that creates them.

_Verified by:_ the `session-timeout` e2e case, which expires a session mid-form and asserts the form
values are still present after re-authentication.

### 3.3 — 2.4.11 Focus Not Obscured (Minimum) and 2.4.12 Focus Not Obscured (Enhanced)

**No part** of a focused component is hidden by author-created content. The product has a sticky
header, a sticky table header band, a bottom bar on mobile and a floating entry button — every one of
which is a candidate obscurer. Each sticky region declares `scroll-margin` on its scroll container
sized to its own height, and the floating button yields (moves out of the way) when focus enters the
region beneath it.

_Verified by:_ the `focus-visibility` e2e case, which tabs through every route in the visual spec at
360px, 1280px and 2560px in both themes, and for each focused element asserts its bounding rect is
fully inside the viewport and that `document.elementFromPoint` at each of its corners resolves to the
element itself or a descendant.

### 3.4 — 2.5.5 Target Size (Enhanced)

Every interactive target is at least **44×44 CSS px**, including inside dense ledger rows, including
inline category chips, including table sort controls, including the calendar day cells in the date
picker. Where the visual element is smaller, the hit area is expanded inside the primitive — with
padding or a pseudo-element — so a caller cannot forget to do it.

Dense mode reduces row height and body size; it never reduces a hit area below 44px.

_Verified by:_ an axe rule plus a dedicated e2e case that enumerates every element matching the
interactive-role selector on every route in the visual spec and asserts
`rect.width >= 44 && rect.height >= 44`, including the pseudo-element expansion.

### 3.5 — 3.3.9 Accessible Authentication (Enhanced)

No cognitive function test is required at any step of authentication or account recovery:

- **Passkeys** (WebAuthn) are a first-class sign-in method, not an add-on.
- Password fields **permit paste** and permit password managers; nothing blocks autofill.
- The two-factor code field permits paste of the whole code and does not split it into six inputs
  that swallow a paste.
- **There is no CAPTCHA anywhere.** Rate limiting is done server-side per path.
- Email verification and password reset are link-based; no code must be transcribed from one device
  to another. Where a code is offered as an alternative, it is copy-pasteable and the link is the
  default.
- No puzzle, no image identification, no "type the characters", no memory test beyond the person's
  own credential.

_Verified by:_ the `auth-accessibility` e2e case, which asserts paste succeeds in every credential
field and that no `data-captcha` or third-party challenge frame is present on any auth route.

---

## 4. Level AAA criteria that are NOT met, with reasons

Every Level AAA success criterion in WCAG 2.2 that is not in §3, with an honest reason. "Not
applicable" is stated where a criterion's trigger content does not exist in the product; that is a
reason not to claim it, not a claim.

| SC         | Name                                     | Why it is not claimed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1.2.6**  | Sign Language (Prerecorded)              | Any prerecorded video we publish (a product tour, a feature explainer) would require a sign-language interpretation we do not produce. Rather than promise it and then break the promise the first time marketing ships a clip, we exclude it. Today the product ships no prerecorded audio-visual content; captions and transcripts are provided when it does (1.2.2 / 1.2.3 at A/AA).                                                                                                                |
| **1.2.7**  | Extended Audio Description (Prerecorded) | Same content class as 1.2.6, same reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **1.2.8**  | Media Alternative (Prerecorded)          | Same content class. A full text alternative for future video is an intention, not a conformance claim.                                                                                                                                                                                                                                                                                                                                                                                                 |
| **1.2.9**  | Audio-only (Live)                        | Not applicable: there is no live audio anywhere in the product.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **1.3.6**  | Identify Purpose                         | Requires programmatically identifying the purpose of icons, regions and controls with a vocabulary (ARIA 1.3 / personalisation semantics) that has no meaningful user-agent or assistive-technology support today. We use landmark roles and accessible names throughout, but marking up purpose against an unsupported vocabulary would be a claim nobody can verify.                                                                                                                                 |
| **1.4.6**  | Contrast (Enhanced)                      | **Met for body and UI text** — every text token clears 7:1 against every ground in both themes — but **not claimed product-wide**, because the eight-hue categorical series palette cannot hold 7:1 across eight simultaneously distinguishable hues in both themes, and, as §2.1 measures, 7:1 against the ground would not make two series distinguishable from each other anyway. Mitigation: the Colour-Is-Never-Alone Rule, a text equivalent on every chart, and keyboard-reachable data points. |
| **1.4.7**  | Low or No Background Audio               | Not applicable: the product plays no audio.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **1.4.9**  | Images of Text (No Exception)            | The product uses no images of text except a logotype, which is the criterion's own exception — but marketing OG images and social cards render text into a bitmap by construction. Those are generated images of text, so a no-exception claim would be false for the public surface even though the application itself is clean.                                                                                                                                                                      |
| **2.1.3**  | Keyboard (No Exception)                  | Every function is keyboard operable and every drag-and-drop surface ships a non-drag control, which is the substance of the criterion. It is not claimed because "no exception" requires a whole-product guarantee across every future third-party embed (payment provider redirects, OAuth consent screens) whose keyboard behaviour we do not control.                                                                                                                                               |
| **2.2.3**  | No Timing                                | Not met, and cannot be: authenticated sessions expire. That expiry is a security requirement for a product holding financial data, and the criterion admits no such exception. 2.2.6 (claimed, §3.2) is the criterion that actually protects the person here.                                                                                                                                                                                                                                          |
| **2.2.4**  | Interruptions                            | Not met. Toast notifications, background sync results and budget-threshold alerts can appear without being requested. Notification preferences let a person turn categories of them off, but there is no single "postpone all except emergencies" control, which is what the criterion asks for.                                                                                                                                                                                                       |
| **2.2.5**  | Re-authenticating                        | Partially met — unsaved form data survives a re-authentication in the transaction, budget and rule editors (§3.2) — but not across every flow: a long import mapping session that outlives the session is restarted rather than resumed. Not claimed until it holds everywhere.                                                                                                                                                                                                                        |
| **2.3.2**  | Three Flashes                            | Vacuously satisfied: nothing in the product flashes. Not claimed because a conformance claim implies ongoing verification and we do not automate a flash check; if a future chart animation or a marketing asset introduced flashing, nothing would catch it.                                                                                                                                                                                                                                          |
| **2.3.3**  | Animation from Interactions              | **Effectively met** — `prefers-reduced-motion: reduce` removes every non-essential animation without exception, which is the criterion. Not claimed only because we cannot make the guarantee for third-party redirect screens (payment provider, OAuth consent) that form part of some journeys. Everything we render honours it.                                                                                                                                                                     |
| **2.4.8**  | Location                                 | Partially met: breadcrumbs exist on nested application surfaces and the navigation marks the current destination three ways. Not claimed because the marketing and legal surfaces have no breadcrumb trail and the platform console's deep views do not always state their position in a hierarchy.                                                                                                                                                                                                    |
| **2.4.9**  | Link Purpose (Link Only)                 | Not met, deliberately. A ledger table has thousands of rows whose row-level actions are honestly labelled "Edit" and "Delete"; the purpose comes from the row, which is the programmatically-determined context 2.4.4 (AA, met) permits. Making every one of those links self-describing would produce screen-reader output that is dramatically worse to navigate, not better.                                                                                                                        |
| **2.4.10** | Section Headings                         | Partially met — every screen and every long-form document uses a correct heading hierarchy — but not claimed, because the criterion covers organising _content_ by headings generally and some dense settings surfaces are organised by fieldsets and lists rather than by headings.                                                                                                                                                                                                                   |
| **2.4.13** | Focus Appearance                         | Our focus indicator is a 2px ring at 2px offset in the `ring` token, which meets the criterion's area and contrast thresholds by construction on every control we render. Not claimed because native browser-rendered UI within our forms — a `<select>` dropdown list, the file-picker dialog, an OS date picker on some mobile browsers — renders a user-agent indicator we cannot measure or control.                                                                                               |
| **2.5.6**  | Concurrent Input Mechanisms              | Believed met — nothing in the product restricts input modality, and touch, mouse and keyboard work simultaneously on the same surfaces — but it is not verified on the device matrix a claim would need, so it is not claimed.                                                                                                                                                                                                                                                                         |
| **2.5.7**  | Dragging Movements                       | This is a **AA** criterion in WCAG 2.2 and is met as part of the AA claim: every drag-and-drop surface (dashboard grid, category tree, rule ordering, account ordering) ships a non-drag control in a menu, shipped in the same change as the drag. Listed here because it is frequently mistaken for AAA.                                                                                                                                                                                             |
| **3.1.3**  | Unusual Words                            | Not met. The product uses terms with specific meanings — _minor units_, _reference amount_, _rollover_, _balance adjustment_, _recurring series_ — and while `CONTEXT.md` defines them for contributors, the product does not ship an in-context glossary mechanism for every occurrence of every such term.                                                                                                                                                                                           |
| **3.1.4**  | Abbreviations                            | Not met. ISO 4217 currency codes (`PLN`, `KWD`) are abbreviations that appear thousands of times per screen; expanding each first occurrence programmatically would be noise, not help. Currency codes are given an expanded accessible name in the currency picker, where the expansion is actually useful.                                                                                                                                                                                           |
| **3.1.5**  | Reading Level                            | Not met, and not achievable without lying to the reader. Financial vocabulary that cannot be lowered below upper-secondary reading level without losing precision is unavoidable in this product — _exchange rate_, _credit limit_, _amortisation_, _reconciliation_, _minor unit_. We do write plainly, define terms where they first matter, and never use jargon where a plain word exists; that is a quality practice, not a 3.1.5 claim.                                                          |
| **3.1.6**  | Pronunciation                            | Not met. Neither English nor Polish content in this product contains homographs whose meaning depends on pronunciation, so the criterion has no bite here — but there is no pronunciation mechanism, so it is not claimed.                                                                                                                                                                                                                                                                             |
| **3.2.5**  | Change on Request                        | Not met. Some surfaces update without an explicit request: the notification bell count, a background-refreshed exchange rate on the currencies screen, and an import batch's live status. Each announces itself politely and none moves focus or reflows content under the reader, which is what 3.2.2 (A, met) requires — but they are not on request.                                                                                                                                                |
| **3.3.6**  | Error Prevention (All)                   | Not met. Financial, legal and destructive submissions are reversible or confirmed and checked (3.3.4, AA, met) — deleting a transaction, closing a budget, running an import, changing a plan, deleting an account. Ordinary form submissions like renaming a tag are not put behind a review step, because doing so would make routine work slower for no safety gain.                                                                                                                                |

**Criteria not listed above** are either Level A or Level AA (and are therefore covered by the AA
conformance claim in §1) or are one of the five claimed in §3.

---

## 5. How conformance is verified

### 5.1 Automated, on every change

`@axe-core/playwright` runs on **every route in the visual spec**, in both themes, at 360px, 1280px
and 2560px, in both locales. The gate:

- Any violation at **`serious` or `critical` fails the build.** There is no waiver list for these.
- A `moderate` violation must be named and justified in the stage's Verification block, or it fails.
- The tolerance list for console messages is fixed and **no stage may append to it to green its own
  run**. React hydration mismatches are never tolerated.

Axe covers roughly a third of WCAG by criterion count. It is a floor, not a claim, and this document
says so out loud because "axe is clean" has been mistaken for "the product is accessible" in every
project that has ever run it.

### 5.2 Automated, criterion-specific

Four e2e cases exist solely to hold the claimed AAA criteria, named in §3: `visual-presentation`,
`session-timeout`, `focus-visibility`, `target-size` and `auth-accessibility`. They run in CI with
the rest of the e2e suite. A change that breaks one of them breaks a published claim, so they are
treated as contract tests, not as UI tests.

### 5.3 Manual, per stage

Every stage's Verification block owes, and an auditor checks:

- Keyboard traversal of the surface end to end with a sensible focus order.
- A non-drag path exercised for every drag affordance.
- The chart text equivalent read, not assumed.
- Light and dark parity at three widths.
- `prefers-reduced-motion: reduce` set, and the surface still usable and still legible.
- Zero console errors or warnings; zero layout shift after paint.

### 5.4 Not yet done, and stated as such

- **No assistive-technology test pass** with NVDA, JAWS or VoiceOver has been performed. Automated
  tooling and manual keyboard testing are not a substitute for it, and no claim in this document
  rests on screen-reader testing that has not happened.
- **No third-party accessibility audit** has been commissioned.
- **No usability testing with disabled users** has been run.

These three gaps are the honest limit of what §1 claims, and they are listed here rather than
omitted. When any of them is done, this section is updated first and the claim second.

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
