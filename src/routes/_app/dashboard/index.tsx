import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { ErrorPanel } from '#/components/app/accounts'
import {
  AccountsWidget,
  CashFlowWidget,
  DASHBOARD_PERIODS,
  DashboardHeader,
  FirstRunPanel,
  NetWorthWidget,
  PeriodSelector,
  RecentTransactionsWidget,
  SpendingWidget,
  WidgetFrame,
  WidgetGrid,
} from '#/components/app/dashboard'
import { Skeleton } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

import { loadDashboard } from './-server/load-dashboard'

import type { DashboardPeriod } from '#/components/app/dashboard'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/dashboard` — the workspace home, and the first screen a signed-in person sees.
 *
 * It sits at `/dashboard` rather than at `_app`'s `/` because `/` is the public landing page and
 * `_app` is a pathless layout, so the two would resolve to the same path. `nav.dashboard` already
 * points here, which is what the rail, the bottom bar and the drawer all read.
 *
 * ## The period lives in the URL
 *
 * `?period=last3Months` is a bookmark, a back button and a link somebody can send. Held in a
 * `useState` all three would lie: the back button would leave the page instead of leaving the
 * period, and a reload would drop the reader into a different view from the one they were
 * reading. `loaderDeps` ties the loader to it, so changing it refetches with no manual invalidate.
 *
 * ## One request, so the panels cannot disagree
 *
 * Every figure on this screen comes from one `loadDashboard` call. The header's three numbers are
 * the sum of the chart's month buckets rather than a second query, which is what makes "the
 * header and the chart agree" a property of the code instead of a test that passes today.
 *
 * ## A brand-new workspace gets a designed screen, not five empty panels
 *
 * `hasData` is false only while the workspace has no accounts at all, and then the grid is
 * **replaced** by the first-run panel rather than decorated with it. Five boxes each saying
 * "nothing yet" reads as broken; it is also the very first impression this product makes.
 */

const searchSchema = z.object({
  period: z.enum(DASHBOARD_PERIODS).default('thisMonth'),
})

export const Route = createFileRoute('/_app/dashboard/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ period: search.period }),
  loader: async ({ deps }) => loadDashboard({ data: { period: deps.period } }),
  pendingComponent: DashboardSkeleton,
  errorComponent: DashboardError,
  head: ({ matches }) => pageHead(matches, (t) => t('dashboard.title')),
  component: DashboardRoute,
})

function DashboardRoute() {
  const t = useTranslate()
  const data = Route.useLoaderData()
  const navigate = Route.useNavigate()

  const selectPeriod = (period: DashboardPeriod) => {
    void navigate({ search: { period } })
  }

  return (
    <div className="flex flex-col gap-6">
      <DashboardHeader
        baseCurrencyCode={data.baseCurrencyCode}
        range={data.range}
        incomeMinor={data.cashFlow.incomeMinor}
        expenseMinor={data.cashFlow.expenseMinor}
        netMinor={data.cashFlow.netMinor}
        action={<PeriodSelector period={data.period} onChange={selectPeriod} />}
      />

      {data.hasData ? null : <FirstRunPanel />}

      <WidgetGrid label={t('dashboard.panels.label')}>
        {/*
          Stretched, not `height="content"`. The net-worth panel is one grid column beside a
          two-column chart, and letting it end where its text ends left ~150px of page ground
          under it — an unfilled grid cell rather than deliberate space. The panel now takes the
          row's height and composes it (`NetWorthWidget`: hero at the top, the pair on the floor).
        */}
        <WidgetFrame title={t('dashboard.widget.netWorth')}>
          <NetWorthWidget
            baseCurrencyCode={data.baseCurrencyCode}
            totalBalanceMinor={data.netWorth.totalBalanceMinor}
            liabilitiesMinor={data.netWorth.liabilitiesMinor}
            netWorthMinor={data.netWorth.netWorthMinor}
            accountCount={data.accounts.length}
          />
        </WidgetFrame>

        <WidgetFrame span={2} title={t('dashboard.widget.cashFlow')}>
          <CashFlowWidget
            baseCurrencyCode={data.baseCurrencyCode}
            buckets={data.cashFlow.buckets}
          />
        </WidgetFrame>

        <WidgetFrame title={t('dashboard.widget.spendingByCategory')}>
          <SpendingWidget
            baseCurrencyCode={data.baseCurrencyCode}
            spending={data.spending}
          />
        </WidgetFrame>

        <WidgetFrame title={t('dashboard.widget.accountsOverview')}>
          <AccountsWidget
            baseCurrencyCode={data.baseCurrencyCode}
            accounts={data.accounts}
          />
        </WidgetFrame>

        <WidgetFrame title={t('dashboard.widget.recentTransactions')}>
          <RecentTransactionsWidget
            baseCurrencyCode={data.baseCurrencyCode}
            transactions={data.recent}
          />
        </WidgetFrame>
      </WidgetGrid>
    </div>
  )
}

/**
 * The loading state has the shape of the answer.
 *
 * A spinner in the middle of the viewport moves the whole page when the data lands. These blocks
 * are the panels' own sizes, so the layout does not jump — and they are `aria-hidden` behind a
 * single polite status, because five announcing skeletons is five announcements of nothing.
 */
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-24 w-full" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full lg:col-span-2" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}

function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('empty.error.title')}
      body={t('empty.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}
