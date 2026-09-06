import { createFileRoute } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'

import { amountReading } from '#/components/app/money'
import { AmountText } from '#/components/app/transactions'
import { cn } from '#/lib/cn'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'
import { asCurrencyCode, asMinor, formatMoney, makeMoney } from '#/lib/money'
import { BudgetStates } from './-ui/budget-states'
import { EURO_ENTRY, LedgerPreview, TYPED_LINE } from './-ui/ledger-preview'
import { MAIN_CONTENT_ID } from './__root'

import type { MessageKey } from '#/lib/i18n'
import type { CSSProperties } from 'react'

/**
 * The landing page.
 *
 * Public, server-rendered, and holding no session: it is the one screen most visitors ever see,
 * so it loads nothing, waits for nothing and renders in the negotiated language on the first
 * pass. Every string comes out of the catalogue rather than out of the JSX, because "the
 * marketing page is English-only" is how a product ends up with a Polish app behind an English
 * front door.
 *
 * ## Why it opens on a page of the book
 *
 * The product is a passbook kept by hand, and the page says so by being one: ruled paper from the
 * first pixel, the refusal written across the top of it in the hand, and directly beneath - still
 * inside the first viewport - the ledger typed on the same form, with the balance after every line
 * standing in its own column on the right. A visitor reads the promise and sees the book the
 * promise is about without scrolling. There is no hero image and no screenshot: the thing itself
 * is smaller and truer than a picture of it.
 *
 * ## Why the evidence is components rather than pictures
 *
 * The page's claim is that the arithmetic is right. A screenshot of correct arithmetic is a claim;
 * the arithmetic itself is a demonstration. So the ledger page and the three budget meters are the
 * product's own components handed static props - which means they carry the U+2212 minus, the
 * tabular figures, the spoken sentence and the four-channel overspend encoding for free, they
 * cannot drift out of date, and the axe suite reads them the same way it reads the signed-in
 * screens. `PRODUCT.md` forbids fabricated evidence, so both blocks label their rows as examples.
 *
 * ## Why nothing on it moves
 *
 * There is no entrance sequence and no scroll-linked reveal. A page of a book lies still, and a
 * landing page that animates itself into place contradicts the product it is selling. The
 * composition carries the page: the ruled first page, bands in the paper's four grounds, rows and
 * slips separated by rules rather than lifted by shadows, and one violet stamp at the end.
 *
 * ## What may not appear here, ever
 *
 * Testimonials, customer logos, ratings, adoption or uptime figures, security certifications,
 * prices, plan limits, and any claim that the product is installable or works offline. None of
 * those are true yet and several never will be. `PRODUCT.md` is the list.
 */
export const Route = createFileRoute('/')({
  component: LandingPage,
})

/**
 * Shared link chrome for the calls to action.
 *
 * Plain anchors rather than the design system's `Button`: each of these leaves the marketing shell
 * for the authenticated one, which has to be a document load rather than a client navigation so
 * the app shell's loader sees the session cookie on its first run.
 */
const CTA_BASE =
  'target-min-h inline-flex items-center justify-center gap-2 rounded-sm px-5 text-label font-bold whitespace-nowrap no-underline transition-[color,background-color,box-shadow,translate] duration-fast ease-out-quint focus-ring'
/**
 * The stamp. Uppercase and tracked like the printed impression it is, in the one violet ink the
 * product spends on actions, and the only filled control in the first viewport.
 *
 * `translate` is named in the transition list on purpose: Tailwind v4 compiles `translate-y-px` to
 * the standalone `translate` property rather than to `transform`, so a list that stops at
 * `box-shadow` leaves the press snapping while the class says otherwise. The press itself is the
 * design system's one-pixel rule - down a pixel and the hairline shadow gone, never a bounce.
 */
const CTA_PRIMARY = `${CTA_BASE} bg-accent text-on-accent uppercase tracking-label shadow-card hover:bg-accent-hover hover:shadow-elevated active:translate-y-px active:shadow-card`
/**
 * The typed pair to it: a ruled box on the paper. The header uses it because the first viewport
 * gets exactly one stamp and the hero owns it; the hero uses it for the anchor that answers the
 * refusal, so the two actions read as different weights of the same offer rather than as a choice
 * between two ways into the same place.
 */
const CTA_QUIET = `${CTA_BASE} border border-border-strong bg-surface text-ink hover:bg-hover active:translate-y-px`
/** The one action inside the violet panel, where the stamp ink itself has no contrast left. */
const CTA_INVERTED = `${CTA_BASE} bg-canvas text-ink uppercase tracking-label shadow-card hover:bg-surface hover:shadow-elevated active:translate-y-px active:shadow-card`

/** The well every band's content sits in. The marketing measure, not the app shell's. */
const WELL = 'mx-auto w-full max-w-6xl px-4 sm:px-6'

/**
 * The first page of the book: printed ruling at a 2.5rem pitch, edge to edge, in the same green the
 * form's hairlines use everywhere else. It is the page's one ornament and it is the product's own
 * subject. The last 4rem fade so the final rule never sits a pixel above the band's own border
 * and reads as a double line.
 *
 * It is painted twice, on two zones that each start their own pitch: the refusal's, where the hand
 * sits on the rules, and the ledger's, where the typed rows are the rules. One continuous ruling
 * would need everything between the two - prose, buttons, a caption - to be a multiple of the
 * pitch tall, which flowing text at a fluid size never is; the first zone's fade is what makes the
 * seam invisible.
 *
 * Written as a style object rather than as arbitrary utilities because the value is a multi-stop
 * gradient plus a mask: as a class it would be one unreadable string, and the token reference
 * inside it would be invisible to anyone grepping for it.
 */
const RULED_PAGE: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(to bottom, transparent 0 calc(2.5rem - 1px), var(--color-border-subtle) calc(2.5rem - 1px) 2.5rem)',
  maskImage: 'linear-gradient(to bottom, #000 calc(100% - 4rem), transparent)',
  WebkitMaskImage:
    'linear-gradient(to bottom, #000 calc(100% - 4rem), transparent)',
}

/**
 * The same ruling inside the violet panel, drawn in that panel's own foreground rather than in a
 * border token: on a stamp-coloured ground a border colour is on the wrong side of the contrast
 * and disappears in one theme or shouts in the other. Held down to a tenth by the wrapper's
 * opacity.
 */
const PANEL_RULES: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(to bottom, var(--color-on-accent) 0 1px, transparent 1px 2.5rem)',
  maskImage:
    'linear-gradient(to bottom, transparent, #000 20%, #000 62%, transparent)',
  WebkitMaskImage:
    'linear-gradient(to bottom, transparent, #000 20%, #000 62%, transparent)',
}

/**
 * The hand on the rules.
 *
 * Caveat's baseline sits half the line box plus 0.33em below the box's top (measured in the
 * browser, at both weights), so a line of it in a 5rem or a 2.5rem box is centred between two
 * rules rather than on one. Painting it 2.5rem minus 0.33em lower in the 5rem box, or 1.25rem
 * minus 0.33em lower in the 2.5rem box, lands every baseline on a printed rule at any size the
 * clamp reaches; a transform moves paint rather than layout, so the boxes still stack on the pitch.
 */
const HAND_ON_RULES_HERO = 'translate-y-[calc(2.5rem-0.33em)]'
const HAND_ON_RULES_TITLE = 'leading-10 translate-y-[calc(1.25rem-0.33em)]'

/** The four answers to "so how does anything get into it?". Entries on the form, not icon tiles. */
const ANSWERS: ReadonlyArray<Passage> = [
  {
    id: 'entry',
    title: 'marketing.instead.entry.title',
    body: 'marketing.instead.entry.body',
  },
  {
    id: 'import',
    title: 'marketing.instead.import.title',
    body: 'marketing.instead.import.body',
  },
  {
    id: 'recurring',
    title: 'marketing.instead.recurring.title',
    body: 'marketing.instead.recurring.body',
  },
  {
    id: 'rules',
    title: 'marketing.instead.rules.title',
    body: 'marketing.instead.rules.body',
  },
]

/** The scope list. Deliberately dense and deliberately not a grid of cards. */
const SCOPE: ReadonlyArray<MessageKey> = [
  'marketing.scope.accounts',
  'marketing.scope.transactions',
  'marketing.scope.classification',
  'marketing.scope.budgets',
  'marketing.scope.recurring',
  'marketing.scope.currency',
  'marketing.scope.reports',
  'marketing.scope.dashboard',
  'marketing.scope.data',
  'marketing.scope.household',
]

/** A heading over a body. Used by the two bands that are prose rather than product. */
interface Passage {
  readonly id: string
  readonly title: MessageKey
  readonly body: MessageKey
}

/** The four things this product refuses to become. The hero's promise, itemised. */
const NEVER: ReadonlyArray<Passage> = [
  {
    id: 'connectors',
    title: 'marketing.never.connectors.title',
    body: 'marketing.never.connectors.body',
  },
  {
    id: 'investments',
    title: 'marketing.never.investments.title',
    body: 'marketing.never.investments.body',
  },
  {
    id: 'tax',
    title: 'marketing.never.tax.title',
    body: 'marketing.never.tax.body',
  },
  {
    id: 'realtime',
    title: 'marketing.never.realtime.title',
    body: 'marketing.never.realtime.body',
  },
]

const COMMITMENTS: ReadonlyArray<Passage> = [
  {
    id: 'export',
    title: 'marketing.commit.export.title',
    body: 'marketing.commit.export.body',
  },
  {
    id: 'a11y',
    title: 'marketing.commit.a11y.title',
    body: 'marketing.commit.a11y.body',
  },
]

/** The three anchors the header and the footer both offer. */
const SECTION_LINKS: ReadonlyArray<{ href: string; label: MessageKey }> = [
  { href: '#how', label: 'marketing.nav.how' },
  { href: '#ledger', label: 'marketing.nav.ledger' },
  { href: '#scope', label: 'marketing.nav.scope' },
]

/**
 * A heading over a body, with a hairline above it.
 *
 * The rule is what gives these items their structure. A card would give them a scaffold instead,
 * and a page whose every section is a grid of equal cards has no hierarchy left to spend.
 */
function RuledItem({ title, body }: { title: MessageKey; body: MessageKey }) {
  const t = useTranslate()

  return (
    <div className="border-t border-border-subtle pt-4">
      <h3 className="text-subtitle text-ink">{t(title)}</h3>
      <p className="prose-measure mt-2 text-body text-ink-2">{t(body)}</p>
    </div>
  )
}

/**
 * The wordmark, in the header and again at the top of the footer. Typed, with the mark as a small
 * square stamp. One size step down below `sm`, where it shares 360px with the way-in button.
 */
function Wordmark() {
  const t = useTranslate()

  return (
    <a
      href="/"
      className="target-min-h inline-flex items-center gap-2 rounded-md text-body font-bold whitespace-nowrap text-ink no-underline focus-ring sm:text-subtitle"
    >
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-sm bg-accent text-caption font-bold text-on-accent"
      >
        M
      </span>
      {t('app.name')}
    </a>
  )
}

function LandingPage() {
  const t = useTranslate()
  const locale = useLocale()
  const year = new Date().getUTCFullYear()

  /**
   * The euro expense as the workspace holds it. Written down rather than converted: the stored
   * `ref_amount_minor` is a historical value fixed at the booking date's rate, and recomputing it
   * on a marketing page would contradict the very sentence beside it.
   */
  const heldValue = makeMoney(EURO_ENTRY.refAmountMinor, 'PLN')

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      {/* The form's printed header rule. Solid, never a blur: text over a blurred copy of
          whatever scrolled underneath it has no computable contrast ratio. */}
      <header className="sticky top-0 z-nav border-b border-border-panel bg-canvas">
        <div
          className={cn(WELL, 'flex h-16 items-center justify-between gap-3')}
        >
          <Wordmark />

          <nav
            aria-label={t('nav.primary')}
            className="flex items-center gap-1 sm:gap-2"
          >
            {SECTION_LINKS.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="target-min-h hidden items-center rounded-md px-3 text-label whitespace-nowrap text-ink-2 no-underline hover:bg-hover hover:text-ink focus-ring md:inline-flex"
              >
                {t(label)}
              </a>
            ))}
            <a
              href="/login"
              className="target-min-h hidden items-center rounded-md px-3 text-label whitespace-nowrap text-ink no-underline hover:bg-hover focus-ring sm:inline-flex"
            >
              {t('marketing.nav.signIn')}
            </a>
            {/* Always on screen, at every width. A header whose only action disappears below
                `sm` leaves a phone visitor with a page and no way into it. */}
            <a href="/register" className={cn(CTA_QUIET, 'h-10')}>
              {t('marketing.nav.getStarted')}
            </a>
          </nav>
        </div>
      </header>

      {/* `tabIndex={-1}` is what makes the skip link in the shell actually move focus here:
          without it the browser scrolls to the anchor and leaves focus where it was. */}
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 outline-none">
        {/* -- The first page: the refusal in the hand, the ledger typed under it ---- */}
        <div className="border-b border-border-panel">
          <div className="relative">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={RULED_PAGE}
            />

            {/* One rule of paper above the hand, two from `sm`: the h1's box then starts on the
                pitch, and each of its 5rem lines takes two rules. */}
            <section className={cn(WELL, 'relative pt-10 pb-10 sm:pt-20')}>
              <div className="grid gap-x-12 gap-y-6 lg:grid-cols-12 lg:items-end">
                <h1
                  className={cn(
                    'text-balance text-hero lg:col-span-8',
                    HAND_ON_RULES_HERO,
                  )}
                >
                  <span className="block">
                    {t('marketing.hero.title.lead')}
                  </span>
                  <span className="block text-ink-2">
                    {t('marketing.hero.title.rest')}
                  </span>
                </h1>
                <p className="prose-measure text-body text-ink-2 lg:col-span-4">
                  {t('marketing.hero.body')}
                </p>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href="/register" className={cn(CTA_PRIMARY, 'h-12')}>
                  {t('marketing.hero.cta.primary')}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </a>
                <a href="#how" className={cn(CTA_QUIET, 'h-12')}>
                  {t('marketing.nav.how')}
                </a>
              </div>
              <p className="mt-3 text-caption text-ink-2">
                {t('marketing.hero.note')}
              </p>
            </section>
          </div>

          {/* The ledger, typed on the form, with a note in the margin. This zone starts its own
              pitch one rule above the column headings, so every row of the table is a whole
              number of rules and its cell rules and the printed ruling are one line. From `lg`
              the margin is a real column with the page's margin rule at its end, and the note
              starts two rules down so its first baseline shares the first entry's rule; below
              `lg` it precedes the table, on the rules, with one rule of paper between them. */}
          <div className="relative">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={RULED_PAGE}
            />
            <div
              className={cn(
                WELL,
                'relative grid gap-y-10 pt-10 pb-16 sm:pb-20 lg:grid-cols-12 lg:gap-x-10',
              )}
            >
              <p className="font-display text-title text-ink lg:col-span-3 lg:border-e lg:border-border-panel lg:pe-6 lg:pt-20">
                <span className={cn('block', HAND_ON_RULES_TITLE)}>
                  {t('marketing.ledger.note')}
                </span>
              </p>
              <div className="lg:col-span-9">
                <LedgerPreview />
                <p className={cn('text-caption text-ink-2', TYPED_LINE)}>
                  {t('marketing.ledger.sample')}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* -- Why that figure will never move ----------------------------- */}
        <section
          id="ledger"
          aria-labelledby="ledger-heading"
          className={cn(WELL, 'scroll-mt-16 py-20 sm:py-28')}
        >
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <h2 id="ledger-heading" className="text-balance text-display">
                {t('marketing.ledger.title')}
              </h2>
              <p className="prose-measure mt-5 text-body text-ink-2">
                {t('marketing.ledger.body')}
              </p>
            </div>

            {/* The one figure on the page that never changes, as the entry it is: the euro line
                as it was typed, and under it, on the next rule, what the book holds it as. No
                label over a large number: the figure is the second line of a two-line entry. */}
            <div className="lg:col-span-5 lg:col-start-8">
              <dl className="border-y border-border-panel">
                <div className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="text-label text-ink">
                    {t(EURO_ENTRY.payee)}
                    <span className="block text-caption text-ink-2">
                      {formatCalendarDate(
                        locale,
                        EURO_ENTRY.bookedOn,
                        'medium',
                      )}
                    </span>
                  </dt>
                  <dd className="text-label">
                    <AmountText
                      amountMinor={asMinor(EURO_ENTRY.amountMinor)}
                      currencyCode={asCurrencyCode(EURO_ENTRY.currencyCode)}
                      direction="expense"
                    />
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-border-subtle py-3">
                  <dt className="text-label text-ink-2">
                    {t('marketing.ledger.figure.label')}
                  </dt>
                  <dd className="text-title font-bold text-ink tabular">
                    <span aria-hidden="true">
                      {formatMoney(locale, heldValue)}
                    </span>
                    <span className="sr-only">
                      {amountReading(t, locale, heldValue)}
                    </span>
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-caption text-ink-2">
                {t('marketing.ledger.figure.caption')}
              </p>
            </div>
          </div>
        </section>

        {/* -- So how does anything get into it? --------------------------- */}
        <div className="border-y border-border-panel bg-surface">
          <section
            id="how"
            aria-labelledby="how-heading"
            className={cn(WELL, 'scroll-mt-16 py-20 sm:py-28')}
          >
            <div className="grid gap-x-12 gap-y-5 lg:grid-cols-12 lg:items-end">
              <h2
                id="how-heading"
                className="text-balance text-display lg:col-span-5"
              >
                {t('marketing.instead.title')}
              </h2>
              <p className="prose-measure text-body text-ink-2 lg:col-span-6 lg:col-start-7">
                {t('marketing.instead.body')}
              </p>
            </div>

            {/* Four entries between rules, two abreast: the answer in the hand, the detail typed
                under it. Not a grid of icon tiles; the thesis refuses that one. */}
            <dl className="mt-14 grid gap-x-10 border-b border-border-panel sm:grid-cols-2">
              {ANSWERS.map(({ id, title, body }) => (
                <div key={id} className="border-t border-border-panel py-5">
                  <dt className="font-display text-subtitle text-ink">
                    {t(title)}
                  </dt>
                  <dd className="mt-2 text-body text-ink-2">{t(body)}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        {/* -- The budget meter, with the colour switched off -------------- */}
        {/* The side the product sits on flips here: the ledger row above put the figure on the
            right, so the meters take the left and the prose answers them. */}
        <section
          aria-labelledby="meter-heading"
          className={cn(WELL, 'py-20 sm:py-28')}
        >
          <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-5 lg:col-start-8 lg:row-start-1">
              <h2 id="meter-heading" className="text-balance text-display">
                {t('marketing.meter.title')}
              </h2>
              <p className="mt-5 text-body text-ink-2">
                {t('marketing.meter.body')}
              </p>
              <p className="mt-4 text-caption text-ink-2">
                {t('marketing.meter.caption')}
              </p>
            </div>
            <div className="lg:col-span-6 lg:row-start-1">
              <BudgetStates />
              <p className="mt-3 text-caption text-ink-2">
                {t('marketing.meter.sample')}
              </p>
            </div>
          </div>
        </section>

        {/* -- What it is, facing what it will never be -------------------- */}
        <div
          id="scope"
          className="scroll-mt-16 border-y border-border-panel bg-surface-panel"
        >
          <div
            className={cn(WELL, 'grid gap-12 py-20 lg:grid-cols-12 sm:py-28')}
          >
            <section aria-labelledby="scope-heading" className="lg:col-span-7">
              <h2 id="scope-heading" className="text-title">
                {t('marketing.scope.title')}
              </h2>
              {/* Two flowing columns rather than a grid: the entries are of very different
                  lengths and a grid would rule ten boxes of ten different heights. */}
              <ul className="mt-6 sm:columns-2 sm:gap-x-10">
                {SCOPE.map((key) => (
                  <li
                    key={key}
                    className="break-inside-avoid border-t border-border-panel py-3 text-body text-ink"
                  >
                    {t(key)}
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="never-heading" className="lg:col-span-5">
              <h2 id="never-heading" className="text-title">
                {t('marketing.never.title')}
              </h2>
              <div className="mt-6 grid gap-6">
                {NEVER.map(({ id, title, body }) => (
                  <RuledItem key={id} title={title} body={body} />
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* -- The two commitments, then the way in ------------------------ */}
        <section
          aria-labelledby="commit-heading"
          className={cn(WELL, 'py-20 sm:py-28')}
        >
          <h2 id="commit-heading" className="text-balance text-display">
            {t('marketing.commit.title')}
          </h2>
          <div className="mt-10 grid gap-10 lg:grid-cols-2">
            {COMMITMENTS.map(({ id, title, body }) => (
              <div key={id}>
                <h3 className="text-title">{t(title)}</h3>
                <p className="prose-measure mt-3 text-body text-ink-2">
                  {t(body)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* -- The way in, stamped -------------------------------------------- */}
        {/* Inset rather than full-bleed, so the last thing on the page is an object on the paper
            rather than another band of it. `--color-accent` is the stamp ink in both themes -
            violet on the light paper, lilac on the slate - so this is the page's one stamp,
            pressed at the end where the book is signed. */}
        <section
          aria-labelledby="cta-heading"
          className={cn(WELL, 'pb-20 sm:pb-28')}
        >
          <div className="relative overflow-hidden rounded-xl bg-accent px-6 py-16 text-center sm:px-12 sm:py-20">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-10"
              style={PANEL_RULES}
            />
            <div className="relative">
              <h2
                id="cta-heading"
                className="mx-auto max-w-2xl text-balance text-display text-on-accent"
              >
                {t('marketing.cta.title')}
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-pretty text-body text-on-accent/85">
                {t('marketing.cta.body')}
              </p>
              <a href="/register" className={cn(CTA_INVERTED, 'mt-10 h-12')}>
                {t('marketing.cta.action')}
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
              <p className="mt-5 text-caption text-on-accent/85">
                {t('marketing.hero.note')}
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border-panel bg-surface-sunken">
        {/* The link lists are plain `ul`s inside `contentinfo` rather than `nav` landmarks: two
            further navigation landmarks would need two further accessible names, and a footer
            column list is not a landmark a screen-reader user wants to land on. */}
        <div className={cn(WELL, 'py-14')}>
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <Wordmark />
              <p className="prose-measure mt-4 text-caption text-ink-2">
                {t('marketing.hero.body')}
              </p>
            </div>

            <ul className="grid content-start gap-1">
              {SECTION_LINKS.map(({ href, label }) => (
                <li key={href}>
                  <a
                    href={href}
                    className="target-min-h inline-flex items-center rounded-md text-label text-ink-2 no-underline hover:text-ink focus-ring"
                  >
                    {t(label)}
                  </a>
                </li>
              ))}
            </ul>

            <ul className="grid content-start gap-1">
              <li>
                <a
                  href="/login"
                  className="target-min-h inline-flex items-center rounded-md text-label text-ink-2 no-underline hover:text-ink focus-ring"
                >
                  {t('marketing.nav.signIn')}
                </a>
              </li>
              <li>
                <a
                  href="/register"
                  className="target-min-h inline-flex items-center rounded-md text-label font-bold text-ink no-underline hover:text-brand focus-ring"
                >
                  {t('marketing.nav.getStarted')}
                </a>
              </li>
            </ul>
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border-subtle pt-6 text-caption text-ink-2">
            <p>
              © {year} {t('app.name')}
            </p>
            <p>{t('marketing.footer.legal')}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
