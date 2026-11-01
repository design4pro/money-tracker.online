import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import {
  LoanCard,
  LoanEmptyState,
  LoanListSkeleton,
  OverviewFigures,
} from '#/components/app/loans'
import { SegmentedFilter } from '#/components/app/nav'
import { ErrorPanel } from '#/components/app/shell'
import { Card } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { loadLoans } from '#/server/fns/loans'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/loans` — the liability register.
 *
 * Remaining, overdue and this month's instalments sit as typed passbook lines. Each card carries
 * a meter, the next payment, and an overdue word when one is late. Clicking the name opens the
 * schedule. There is no create form in this stage.
 */

const searchSchema = z.object({
  book: z.enum(['all', 'business', 'personal']).default('all'),
  status: z.enum(['active', 'all']).default('active'),
})

type BookFilter = z.infer<typeof searchSchema>['book']
type StatusFilter = z.infer<typeof searchSchema>['status']

export const Route = createFileRoute('/_app/loans/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ book: search.book, status: search.status }),
  loader: async ({ deps }) => {
    const overview = await loadLoans({
      data: {
        book: deps.book,
        includeClosed: deps.status === 'all',
      },
    })
    return { overview }
  },
  pendingComponent: LoanListSkeleton,
  errorComponent: LoansListError,
  head: ({ matches }) => pageHead(matches, (t) => t('loans.title')),
  component: LoansListRoute,
})

function LoansListError({ reset }: { readonly reset: () => void }) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('loans.error.title')}
      body={t('loans.error.body')}
      onRetry={reset}
    />
  )
}

function LoansListRoute() {
  const t = useTranslate()
  const { overview } = Route.useLoaderData()
  const { book, status } = Route.useSearch()
  const navigate = Route.useNavigate()

  const baseCurrencyCode = overview.baseCurrencyCode

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 grow basis-72">
          <h1 className="text-title font-bold text-ink">{t('loans.title')}</h1>
          <p className="mt-1 max-w-prose text-body text-ink-2">
            {t('loans.subtitle')}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-4">
        <SegmentedFilter
          label={t('loans.filter.book')}
          value={book}
          onChange={(next: BookFilter) =>
            void navigate({ search: { book: next, status } })
          }
          options={[
            { id: 'all', label: t('loans.filter.book.all') },
            { id: 'business', label: t('loans.book.business') },
            { id: 'personal', label: t('loans.book.personal') },
          ]}
        />
        <SegmentedFilter
          label={t('loans.filter.status')}
          value={status}
          onChange={(next: StatusFilter) =>
            void navigate({ search: { book, status: next } })
          }
          options={[
            { id: 'active', label: t('loans.filter.active') },
            { id: 'all', label: t('loans.filter.all') },
          ]}
        />
      </div>

      {overview.rows.length === 0 && book === 'all' && status === 'active' ? (
        <LoanEmptyState />
      ) : overview.rows.length === 0 ? (
        <Card padding="lg" className="text-center">
          <h2 className="text-subtitle font-semibold text-ink">
            {t('loans.empty.filtered.title')}
          </h2>
          <p className="mt-1 text-body text-ink-2">
            {t('loans.empty.filtered.body')}
          </p>
        </Card>
      ) : (
        <>
          <OverviewFigures
            overview={overview}
            baseCurrencyCode={baseCurrencyCode}
          />
          <ul className="rounded-xl border border-border-subtle bg-surface shadow-card">
            {overview.rows.map((summary) => (
              <LoanCard key={summary.loan.id} summary={summary} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
