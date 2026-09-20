/**
 * The frame every email in this product is drawn in, and the only place its chrome is decided.
 *
 * It takes **strings, never keys**: the caller has already resolved the recipient's locale and
 * bound a translator, so this component holds no copy and needs no catalogue. That is what lets an
 * auth email, a notification and the digest share one frame while each owns its own wording, and it
 * is what makes the layout testable without a locale.
 *
 * ## It is the same product, drawn with what a mail client has
 *
 * The values below are `DESIGN.md`'s, not a second palette invented for email: the paper grounds,
 * the violet stamp, the 2 px corners the Guillotine Rule allows, and the type ramp's own sizes. A
 * mail client reads no stylesheet, no cascade worth relying on and no custom property, and roughly
 * half of them strip `<style>` entirely — so a token cannot survive the trip and the literal value
 * it resolves to is what travels. Where the two disagree, `DESIGN.md` is the source and this file
 * is the transcription; `__tests__/layout.test.tsx` pins that.
 *
 * The font stack is the one exception worth naming. `DESIGN.md` sets body text in Courier Prime, a
 * webfont, and no mail client will fetch one. The stack is therefore the documented fallback chain
 * unchanged — `Courier New, Courier, monospace` — which every client already has, so the message
 * reads in the product's own voice without a network request. The spec asked for "the system font
 * stack" and this is that stack, for this product.
 *
 * ## The rest is email's arithmetic
 *
 * - **One column, 600 px.** Wider than that and Outlook's reading pane crops it.
 * - **A text wordmark, never an image.** Images are blocked by default in enough clients that a
 *   logo-as-image is, for those readers, an email that opens with a broken rectangle.
 * - **`color-scheme: light dark` plus a `prefers-color-scheme` block.** Dark rendering is the
 *   regression `docs/plans/21-notifications.md` names, and a client left to invert an unprepared
 *   light template produces grey text on grey. The dark values are `src/styles/tokens.css`'s dark
 *   theme, whose contrast ratios are computed and re-checked by `tokens-contrast.test.ts`.
 * - **The call to action is at least 44 px tall** and reads as a sentence on its own, because
 *   "click here" next to a blocked image is nothing at all.
 *
 * ## The footer is not optional
 *
 * Every message says why it arrived. A notification or digest also carries the way to stop it — the
 * link is the caller's, because only Phase 3 of `21-S2` can sign a token. Auth mail passes no
 * unsubscribe at all and that is deliberate (spec A4): nobody can opt out of a password reset, and
 * a link that pretends otherwise is a lie the reader discovers by clicking it.
 */

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

import type { Direction, Locale } from '#/lib/i18n'
import type { CSSProperties, ReactElement, ReactNode } from 'react'

/** The way out of a mailing list, when the message is one somebody may leave. */
export interface EmailUnsubscribe {
  readonly href: string
  /** Reads as an action on its own, because a bare "here" is not a link text. */
  readonly label: string
}

export interface EmailLayoutProps {
  readonly locale: Locale
  readonly dir: Direction
  /** The wordmark, and the `<title>`. Resolved from `app.name`. */
  readonly appName: string
  /** The inbox preview line. What a reader sees before opening. */
  readonly preview: string
  /** Why this message arrived, in one sentence. Never absent. */
  readonly footerReason: string
  readonly unsubscribe?: EmailUnsubscribe
  readonly children: ReactNode
}

/**
 * `DESIGN.md` → `colors`, transcribed. The binding ground for the light theme's contrast contract
 * is `surface-sunken`; nothing here paints text on anything darker than `canvas`.
 */
const LIGHT = {
  canvas: '#f5f4ee',
  surface: '#fbfaf6',
  ink: '#262420',
  ink2: '#4b4941',
  borderSubtle: '#c3d1c4',
  accent: '#4a2a82',
  onAccent: '#ffffff',
} as const

/** `src/styles/tokens.css` → the `prefers-color-scheme: dark` block, transcribed. */
const DARK = {
  canvas: '#16171a',
  surface: '#1d1f23',
  ink: '#ebe8df',
  ink2: '#b9b5aa',
  borderSubtle: '#42454c',
  accent: '#c5aef2',
  onAccent: '#16171a',
} as const

/**
 * The documented body stack with its webfont head removed.
 *
 * Keeping `'Courier Prime'` in front costs nothing — a client that happens to have it installed
 * uses it, and every other one falls through to Courier New exactly as the app does while the
 * webfont is still loading.
 */
const FONT_STACK = "'Courier Prime', 'Courier New', Courier, monospace"

/** `DESIGN.md` → `rounded.md`, which the Guillotine Rule caps at 2 px on a rectangle. */
const RADIUS = '2px'

/**
 * `DESIGN.md` → `typography`, in px because `rem` in email is scaled by clients that set their own
 * root size. `body` is `0.9375rem`, `label` `0.8125rem`, `subtitle` `1.25rem`.
 */
const TYPE = {
  body: '15px',
  bodyLine: '23px',
  label: '13px',
  labelLine: '20px',
  subtitle: '20px',
  subtitleLine: '25px',
} as const

/**
 * What cannot be inlined.
 *
 * `color-scheme` tells a client the message has both ends covered, which is what stops iOS Mail and
 * Outlook.com from inverting it themselves. The media block then restates the handful of colours
 * that matter; a client that strips `<style>` keeps the inline light styles and is correct, just
 * not dark.
 */
const DARK_MODE_CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
html, body { background-color: ${LIGHT.canvas}; }
@media (prefers-color-scheme: dark) {
  html, body { background-color: ${DARK.canvas} !important; }
  .email-canvas { background-color: ${DARK.canvas} !important; color: ${DARK.ink} !important; }
  .email-surface { background-color: ${DARK.surface} !important; border: 1px solid ${DARK.borderSubtle} !important; }
  .email-ink { color: ${DARK.ink} !important; }
  .email-ink-2 { color: ${DARK.ink2} !important; }
  .email-rule { background-color: ${DARK.borderSubtle} !important; }
  .email-action { background-color: ${DARK.accent} !important; color: ${DARK.onAccent} !important; }
  .email-link { color: ${DARK.accent} !important; }
}
`

/**
 * `<body>` itself carries nothing but a reset.
 *
 * `Body` keeps only `background`, `background-color` and zeroed spacing on the `<body>` element and
 * moves everything else onto a `<td>` it generates — a `<td>` that takes no `className`, because the
 * component does not forward one that deep. Painting the ground through `Body` therefore produced a
 * light band no dark rule could reach, the card floating on `#f5f4ee` in an otherwise dark client.
 * So the ground is painted one level in, on a table this file classes itself.
 */
const bodyReset: CSSProperties = {
  margin: 0,
  padding: 0,
}

const canvas: CSSProperties = {
  backgroundColor: LIGHT.canvas,
  color: LIGHT.ink,
  fontFamily: FONT_STACK,
  fontSize: TYPE.body,
  lineHeight: TYPE.bodyLine,
  padding: '24px 12px',
}

const container: CSSProperties = {
  backgroundColor: LIGHT.surface,
  border: `1px solid ${LIGHT.borderSubtle}`,
  borderRadius: RADIUS,
  margin: '0 auto',
  maxWidth: '600px',
  padding: '32px 28px',
  width: '100%',
}

/**
 * The same treatment `components/app/shell/brand-mark.tsx` gives it: body size, bold, ink — minus
 * the `BrandMark` glyph beside it, which is an image and therefore blocked for half the readers.
 */
const wordmark: CSSProperties = {
  color: LIGHT.ink,
  fontFamily: FONT_STACK,
  fontSize: TYPE.body,
  fontWeight: 700,
  lineHeight: TYPE.bodyLine,
  margin: '0 0 24px',
}

/**
 * A painted 1 px band rather than a border on an `<hr>`.
 *
 * Outlook's word engine renders `border-top` on a rule at its own thickness and in its own colour,
 * and the element keeps its user-agent margins on top; a filled box of a stated height is the one
 * form every client draws identically. The element stays an `<hr>`, so a screen reader still hears
 * a thematic break.
 */
const rule: CSSProperties = {
  backgroundColor: LIGHT.borderSubtle,
  border: 'none',
  // `Hr` merges its own `border-top: 1px solid #eaeaea` after whatever it is handed, and a longhand
  // beats the shorthand above it whatever the order — so the default has to be named to be silenced.
  // Left standing it draws a near-white line, which in a dark client is the brightest thing on the
  // page and in a light one is a colour from no palette this product has.
  borderTop: 'none',
  height: '1px',
  margin: '32px 0 16px',
}

const footerText: CSSProperties = {
  color: LIGHT.ink2,
  fontFamily: FONT_STACK,
  fontSize: TYPE.label,
  lineHeight: TYPE.labelLine,
  margin: '0 0 4px',
}

const footerLink: CSSProperties = {
  color: LIGHT.ink2,
  fontFamily: FONT_STACK,
  fontSize: TYPE.label,
  lineHeight: TYPE.labelLine,
  textDecoration: 'underline',
}

export function EmailLayout({
  locale,
  dir,
  appName,
  preview,
  footerReason,
  unsubscribe,
  children,
}: EmailLayoutProps): ReactElement {
  return (
    <Html lang={locale} dir={dir}>
      <Head>
        <title>{appName}</title>
        <style>{DARK_MODE_CSS}</style>
      </Head>
      <Preview>{preview}</Preview>
      <Body className="email-canvas" style={bodyReset}>
        <Section className="email-canvas" style={canvas}>
          <Container className="email-surface" style={container}>
            {/* A heading rather than a styled paragraph: the wordmark is the document's name, and a
                screen reader reading the message aloud should say so first. */}
            <Heading as="h1" className="email-ink" style={wordmark}>
              {appName}
            </Heading>
            {children}
            <Hr className="email-rule" style={rule} />
            <Section>
              <Text className="email-ink-2" style={footerText}>
                {footerReason}
              </Text>
              {unsubscribe === undefined ? null : (
                <Text className="email-ink-2" style={footerText}>
                  <Link
                    className="email-link"
                    href={unsubscribe.href}
                    style={footerLink}
                  >
                    {unsubscribe.label}
                  </Link>
                </Text>
              )}
            </Section>
          </Container>
        </Section>
      </Body>
    </Html>
  )
}

/**
 * The shared pieces a template draws its own content with, so "what a paragraph looks like" is
 * decided once rather than per family.
 */
export const emailStyles = {
  fontStack: FONT_STACK,
  light: LIGHT,
  dark: DARK,
  heading: {
    color: LIGHT.ink,
    fontFamily: FONT_STACK,
    fontSize: TYPE.subtitle,
    fontWeight: 700,
    lineHeight: TYPE.subtitleLine,
    margin: '0 0 12px',
  } satisfies CSSProperties,
  paragraph: {
    color: LIGHT.ink,
    fontFamily: FONT_STACK,
    fontSize: TYPE.body,
    lineHeight: TYPE.bodyLine,
    margin: '0 0 16px',
  } satisfies CSSProperties,
  muted: {
    color: LIGHT.ink2,
    fontFamily: FONT_STACK,
    fontSize: TYPE.label,
    lineHeight: TYPE.labelLine,
    margin: '0 0 16px',
  } satisfies CSSProperties,
  /**
   * The band a call to action sits in.
   *
   * `padding` rather than `margin`, because the element is a table and Outlook's word engine
   * discards margins on one. Without it the caption below the button touches its bottom edge, which
   * reads as a rendering fault rather than as a caption.
   */
  actionBlock: {
    padding: '4px 0 20px',
  } satisfies CSSProperties,
  /**
   * 14 px of padding either side of a 23 px line box is 51 px, past the 44 px the spec asks for and
   * past WCAG 2.2 §2.5.8's 24×24 minimum with room for a thumb.
   */
  action: {
    backgroundColor: LIGHT.accent,
    borderRadius: RADIUS,
    color: LIGHT.onAccent,
    display: 'inline-block',
    fontFamily: FONT_STACK,
    fontSize: TYPE.body,
    fontWeight: 700,
    lineHeight: TYPE.bodyLine,
    padding: '14px 24px',
    textDecoration: 'none',
  } satisfies CSSProperties,
} as const

/**
 * The body of a message: a paragraph, a caption, a call to action.
 *
 * They are components rather than three more entries in {@link emailStyles} because a style object
 * alone is only half of what a piece of email copy needs. The other half is the class that lets the
 * dark block reach it, and a template that takes the style and forgets the class renders near-black
 * text on a near-black ground — readable in every test, unreadable in an inbox. Pairing the two here
 * makes that mistake unavailable rather than merely documented.
 */
export function EmailText({ children }: { children: ReactNode }): ReactElement {
  return (
    <Text className="email-ink" style={emailStyles.paragraph}>
      {children}
    </Text>
  )
}

/** Secondary copy: smaller, quieter, and still legible in both themes. */
export function EmailMuted({
  children,
}: {
  children: ReactNode
}): ReactElement {
  return (
    <Text className="email-ink-2" style={emailStyles.muted}>
      {children}
    </Text>
  )
}

/** The one thing to click, with the space beneath it that keeps the caption off its edge. */
export function EmailAction({
  href,
  children,
}: {
  href: string
  children: ReactNode
}): ReactElement {
  return (
    <Section style={emailStyles.actionBlock}>
      <Button className="email-action" href={href} style={emailStyles.action}>
        {children}
      </Button>
    </Section>
  )
}
