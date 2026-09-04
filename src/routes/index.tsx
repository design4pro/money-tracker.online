import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowRight,
  CalendarClock,
  ChartNoAxesCombined,
  FileUp,
  Globe,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react'

import { Card } from '#/components/ui'
import { cn } from '#/lib/cn'
import { useTranslate } from '#/lib/i18n'
import { MAIN_CONTENT_ID } from './__root'

import type { ComponentType } from 'react'
import type { MessageKey } from '#/lib/i18n'

/**
 * The landing page.
 *
 * Public, server-rendered, and holding no session: it is the one screen most visitors ever see,
 * so it loads nothing, waits for nothing and renders in the negotiated language on the first
 * pass. Every string comes out of the catalogue rather than out of the JSX, because "the
 * marketing page is English-only" is how a product ends up with a Polish app behind an English
 * front door.
 *
 * The blueprint's full marketing surface — the comparison table, the pricing cards, the feature
 * deep-dive, the changelog — is a later plan. What is here is complete rather than sketched: a
 * nav, a hero with a real proposition, the six things this product actually does, the privacy
 * position that is the reason it exists, a closing call to action and a footer.
 */
export const Route = createFileRoute('/')({
  component: LandingPage,
})

/** One feature card. The icon is a component so the card decides its own size. */
interface Feature {
  readonly id: string
  readonly Icon: ComponentType<{ className?: string }>
  readonly title: MessageKey
  readonly body: MessageKey
}

const FEATURES: ReadonlyArray<Feature> = [
  {
    id: 'multi-currency',
    Icon: Globe,
    title: 'marketing.feature.multiCurrency.title',
    body: 'marketing.feature.multiCurrency.body',
  },
  {
    id: 'manual',
    Icon: FileUp,
    title: 'marketing.feature.manual.title',
    body: 'marketing.feature.manual.body',
  },
  {
    id: 'budgets',
    Icon: Wallet,
    title: 'marketing.feature.budgets.title',
    body: 'marketing.feature.budgets.body',
  },
  {
    id: 'recurring',
    Icon: CalendarClock,
    title: 'marketing.feature.recurring.title',
    body: 'marketing.feature.recurring.body',
  },
  {
    id: 'reports',
    Icon: ChartNoAxesCombined,
    title: 'marketing.feature.reports.title',
    body: 'marketing.feature.reports.body',
  },
  {
    id: 'household',
    Icon: Users,
    title: 'marketing.feature.household.title',
    body: 'marketing.feature.household.body',
  },
]

/**
 * Shared link chrome for the two calls to action.
 *
 * Plain anchors rather than the design system's `Button`: both of these leave the marketing shell
 * for the authenticated one, which has to be a document load rather than a client navigation so
 * the app shell's loader sees the session cookie on its first run.
 */
const CTA_BASE =
  'target-min-h inline-flex items-center justify-center gap-2 rounded-md px-5 text-label font-semibold whitespace-nowrap no-underline transition-[color,background-color,box-shadow] duration-fast ease-out-quint focus-ring'
const CTA_PRIMARY = `${CTA_BASE} bg-brand text-on-brand shadow-card hover:bg-brand-hover hover:shadow-elevated`
const CTA_SECONDARY = `${CTA_BASE} border border-border-strong bg-surface text-ink hover:bg-surface-sunken`

function LandingPage() {
  const t = useTranslate()
  const year = new Date().getUTCFullYear()

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-nav border-b border-border-subtle bg-canvas/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a
            href="/"
            className="target-min-h inline-flex items-center gap-2 rounded-md text-subtitle font-semibold whitespace-nowrap no-underline text-ink focus-ring"
          >
            <span
              aria-hidden="true"
              className="grid size-7 place-items-center rounded-lg bg-brand text-on-brand text-caption font-bold"
            >
              M
            </span>
            {t('app.name')}
          </a>

          <nav
            aria-label={t('nav.primary')}
            className="flex items-center gap-1 sm:gap-2"
          >
            <a
              href="#features"
              className="target-min-h hidden items-center rounded-md px-3 text-label whitespace-nowrap text-ink-2 no-underline hover:text-ink focus-ring sm:inline-flex"
            >
              {t('marketing.nav.features')}
            </a>
            <a
              href="#privacy"
              className="target-min-h hidden items-center rounded-md px-3 text-label whitespace-nowrap text-ink-2 no-underline hover:text-ink focus-ring sm:inline-flex"
            >
              {t('marketing.nav.security')}
            </a>
            <a
              href="/login"
              className="target-min-h inline-flex items-center rounded-md px-3 text-label font-medium whitespace-nowrap text-ink no-underline focus-ring hover:bg-hover"
            >
              {t('marketing.nav.signIn')}
            </a>
            <a
              href="/login"
              // `cn` rather than interpolation: `CTA_BASE` already sets
              // `inline-flex`, so a plain template leaves both that and `hidden`
              // on the element and lets stylesheet order pick the winner. It
              // picked `inline-flex`, which is why this button was on screen at
              // every width despite saying otherwise. `tailwind-merge` settles
              // the `display` group by argument order instead.
              className={cn(CTA_PRIMARY, 'h-10 hidden sm:inline-flex')}
            >
              {t('marketing.nav.getStarted')}
            </a>
          </nav>
        </div>
      </header>

      {/* `tabIndex={-1}` is what makes the skip link in the shell actually move focus here:
          without it the browser scrolls to the anchor and leaves focus where it was. */}
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 outline-none">
        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-3xl">
            <p className="text-micro tracking-label text-ink-2 uppercase">
              {t('app.tagline')}
            </p>
            <h1 className="mt-4 text-display sm:text-hero">
              {t('marketing.hero.title')}
            </h1>
            <p className="prose-measure mt-6 text-subtitle text-ink-2">
              {t('marketing.hero.body')}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="/login" className={`${CTA_PRIMARY} h-12`}>
                {t('marketing.hero.cta.primary')}
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
              <a href="#features" className={`${CTA_SECONDARY} h-12`}>
                {t('marketing.hero.cta.secondary')}
              </a>
            </div>
            <p className="mt-4 text-caption text-ink-2">
              {t('marketing.hero.note')}
            </p>
          </div>
        </section>

        <section
          id="features"
          aria-labelledby="features-heading"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 pb-16 sm:px-6 sm:pb-24"
        >
          <h2 id="features-heading" className="text-title">
            {t('marketing.features.title')}
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ id, Icon, title, body }) => (
              <li key={id}>
                <Card as="article" padding="lg" className="h-full">
                  <Icon aria-hidden="true" className="size-5 text-brand" />
                  <h3 className="mt-4 text-subtitle">{t(title)}</h3>
                  <p className="mt-2 text-body text-ink-2">{t(body)}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="privacy"
          aria-labelledby="privacy-heading"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 pb-16 sm:px-6 sm:pb-24"
        >
          <Card variant="brand" padding="lg" className="sm:p-10">
            <ShieldCheck aria-hidden="true" className="size-6 text-brand" />
            <h2 id="privacy-heading" className="mt-4 text-title">
              {t('marketing.privacy.title')}
            </h2>
            <p className="prose-measure mt-3 text-body text-ink-2">
              {t('marketing.privacy.body')}
            </p>
          </Card>
        </section>

        <section
          aria-labelledby="cta-heading"
          className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28"
        >
          <div className="border-t border-border-subtle pt-12 text-center">
            <h2 id="cta-heading" className="text-title">
              {t('marketing.cta.title')}
            </h2>
            <p className="prose-measure mx-auto mt-3 text-body text-ink-2">
              {t('marketing.cta.body')}
            </p>
            <a href="/login" className={`${CTA_PRIMARY} mt-8 h-12`}>
              {t('marketing.cta.action')}
              <ArrowRight aria-hidden="true" className="size-4" />
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-border-subtle">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-8 text-caption text-ink-2 sm:px-6">
          <p>
            © {year} {t('app.name')}
          </p>
          <p>{t('marketing.footer.legal')}</p>
        </div>
      </footer>
    </div>
  )
}
