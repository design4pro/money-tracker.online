import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { z } from 'zod'

import {
  CalendarChart,
  CalendarGrid,
  LoanCalendarSkeleton,
} from '#/components/app/loans'
import { SegmentedFilter } from '#/components/app/nav'
import { ErrorPanel } from '#/components/app/shell'
import { Card } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { CALENDAR_START_YEAR } from '#/lib/obligation-calendar'
import { pageHead } from '#/routes/-lib/page-title'
import { loadObligationCalendar } from '#/server/fns/loans'

/**
 * `/loans/months` — paid vs remaining across 12 months × years from 2025 up.
 *
 * The grid is the reading; the stacked bar is the selected year. Both use stored `ref_*`
 * integers. Book filter is Wszystko / Firma / Prywatne.
 */

const searchSchema = z.object({
  book: z.enum(['all', 'business', 'personal']).default('all'),
  year: z.coerce.number().int().min(CALENDAR_START_YEAR).max(2100).optional(),
})

type BookFilter = z.infer<typeof searchSchema>['book']

export const Route = createFileRoute('/_app/loans/months')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ book: search.book, year: search.year }),
  loader: async ({ deps }) => {
    const calendar = await loadObligationCalendar({
      data: { book: deps.book },
    })
    const year =
      deps.year !== undefined && calendar.years.includes(deps.year)
        ? deps.year
        : (calendar.years.find((entry) =>
            calendar.todayMonth.startsWith(String(entry)),
          ) ??
          calendar.years[calendar.years.length - 1] ??
          CALENDAR_START_YEAR)
    return { calendar, year }
  },
  pendingComponent: LoanCalendarSkeleton,
  errorComponent: CalendarError,
  head: ({ matches }) => pageHead(matches, (t) => t('loans.calendar.title')),
  component: CalendarRoute,
})

function CalendarError({ reset }: { readonly reset: () => void }) {
  const t = useTranslate()
  const router = useRouter()
  return (
    <ErrorPanel
      title={t('loans.calendar.error.title')}
      body={t('loans.calendar.error.body')}
      onRetry={() => void router.invalidate().then(reset)}
    />
  )
}

function CalendarRoute() {
  const t = useTranslate()
  const { calendar, year } = Route.useLoaderData()
  const { book } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <div className="flex flex-col gap-6">
      <p>
        <Link
          to="/loans"
          search={{ book }}
          className="target-min-h inline-flex items-center gap-2 text-label font-semibold text-brand"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('loans.detail.back')}
        </Link>
      </p>

      <header>
        <h1 className="text-title font-bold text-ink">
          {t('loans.calendar.title')}
        </h1>
        <p className="mt-1 max-w-prose text-body text-ink-2">
          {t('loans.calendar.subtitle')}
        </p>
      </header>

      <div className="flex flex-wrap gap-4">
        <SegmentedFilter
          label={t('loans.filter.book')}
          value={book}
          onChange={(next: BookFilter) =>
            void navigate({ search: { book: next, year } })
          }
          options={[
            { id: 'all', label: t('loans.filter.book.all') },
            { id: 'business', label: t('loans.book.business') },
            { id: 'personal', label: t('loans.book.personal') },
          ]}
        />
        <SegmentedFilter
          label={t('loans.calendar.filter.year')}
          value={String(year)}
          onChange={(next: string) =>
            void navigate({
              search: { book, year: Number(next) },
            })
          }
          options={calendar.years.map((entry) => ({
            id: String(entry),
            label: String(entry),
          }))}
        />
      </div>

      <Card padding="lg">
        <CalendarChart calendar={calendar} year={year} />
      </Card>

      <CalendarGrid calendar={calendar} />
    </div>
  )
}
