import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { ErrorPanel } from '#/components/app/accounts'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Radio,
  RadioGroup,
  Skeleton,
  toast,
} from '#/components/ui'
import { BILLING_INTERVALS, PLANS } from '#/lib/plans'
import { useLocale, useTranslate } from '#/lib/i18n'
import { formatCalendarDate } from '#/lib/i18n/format'
import {
  cancelSubscription,
  loadBilling,
  resumeSubscription,
} from '#/server/fns/billing'

import { ConfirmDialog } from '../accounts/-ui/confirm-dialog'
import { utcDay } from './-ui/format-day'
import { PlanCards } from './-ui/plan-cards'
import { UsageMeters } from './-ui/usage-meters'

import type { BillingInterval } from '#/lib/plans'
import type { BillingView } from '#/server/fns/billing'
import type { MessageKey } from '#/lib/i18n'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/settings/billing` — the plan, what it costs, and how much of it is in use.
 *
 * ## Nothing on this screen grants anything
 *
 * Every figure comes from `loadBilling`, which reads the stored subscription row. Coming back from
 * a checkout does not change the plan — the signed webhook does — so `?billing=confirming` renders
 * an honest **confirming** state with a re-check button rather than pretending the upgrade landed.
 * The alternative, trusting the return URL, would make the plan a query parameter anybody can type.
 *
 * ## The screen never claims a feature the plan does not include
 *
 * The tier cards and the meters both read `src/lib/plans.ts`, which is the same catalogue
 * `assertWithinLimit` enforces from. Two copies of pricing drift, and drifted pricing is a refund.
 *
 * ## Actions follow the role, not the other way round
 *
 * A `member` sees the plan and the usage and no buttons at all — not disabled ones. The server
 * refuses them too (`assertRole` in the checkout route and the two server functions), so the UI is
 * a reflection of the rule rather than the place it is enforced.
 */

const searchSchema = z.object({
  billing: z.enum(['confirming', 'unknown-plan', 'no-customer']).optional(),
})

export const Route = createFileRoute('/_app/settings/billing')({
  validateSearch: searchSchema,
  loader: async () => ({ billing: await loadBilling() }),
  pendingComponent: BillingSkeleton,
  errorComponent: BillingError,
  head: ({ matches }) => pageHead(matches, (t) => t('billing.title')),
  component: BillingRoute,
})

function BillingSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function BillingError({ error, reset }: { error: Error; reset: () => void }) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('billing.error.title')}
      body={t('empty.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

function BillingRoute() {
  const t = useTranslate()
  const { billing } = Route.useLoaderData()
  const search = Route.useSearch()
  const router = useRouter()
  const [interval, setInterval] = useState<BillingInterval>('monthly')
  const [isCancelOpen, setCancelOpen] = useState(false)
  const locale = useLocale()

  const periodEnd = billing.subscription?.currentPeriodEnd ?? null
  const periodEndLabel =
    periodEnd === null ? '' : formatCalendarDate(locale, utcDay(periodEnd))

  const canManage = billing.role !== 'member'
  const refresh = () => void router.invalidate()

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-bold text-ink">{t('billing.title')}</h1>
        <p className="max-w-[68ch] text-body text-ink-2">
          {t('billing.subtitle')}
        </p>
      </header>

      {billing.exceeded.length === 0 ? null : <OverLimitNotice />}

      <Card padding="lg" as="section" aria-label={t('billing.plan.title')}>
        <CardHeader
          headingLevel={2}
          title={t('billing.plan.title')}
          description={t(PLANS[billing.planId].taglineKey)}
        />
        <CardBody className="flex flex-col gap-4">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone="brand" size="md">
              {t(PLANS[billing.planId].nameKey)}
            </Badge>
            <span className="text-body text-ink-2">
              <PlanState
                view={billing}
                confirming={search.billing === 'confirming'}
              />
            </span>
          </p>

          {!canManage || !billing.configured ? null : (
            <div className="flex flex-wrap gap-3">
              <form method="post" action="/api/billing/portal">
                <Button type="submit" variant="secondary">
                  {t('billing.action.portal')}
                </Button>
              </form>

              {billing.subscription === null ? null : billing.subscription
                  .cancelAtPeriodEnd ? (
                <Button
                  variant="secondary"
                  onPress={() => {
                    void resumeSubscription().then(() => {
                      toast.success(t('billing.action.resume'))
                      refresh()
                    })
                  }}
                >
                  {t('billing.action.resume')}
                </Button>
              ) : (
                <Button variant="ghost" onPress={() => setCancelOpen(true)}>
                  {t('billing.action.cancel')}
                </Button>
              )}

              {search.billing === 'confirming' ? (
                <Button variant="ghost" onPress={refresh}>
                  {t('billing.action.refresh')}
                </Button>
              ) : null}
            </div>
          )}

          {billing.configured ? null : (
            <p className="text-body text-ink-2">{t('billing.notConfigured')}</p>
          )}
        </CardBody>
      </Card>

      <Card padding="lg" as="section" aria-label={t('billing.usage.title')}>
        <CardHeader
          headingLevel={2}
          title={t('billing.usage.title')}
          description={t('billing.usage.description')}
        />
        <CardBody>
          <UsageMeters limits={billing.limits} usage={billing.usage} />
        </CardBody>
      </Card>

      <section
        aria-labelledby="billing-plans-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2
            id="billing-plans-heading"
            className="text-subtitle font-bold text-ink"
          >
            {t('plans.current')}
          </h2>
          <RadioGroup
            orientation="horizontal"
            aria-label={t('plans.interval.monthly')}
            value={interval}
            onChange={(next) => setInterval(next as BillingInterval)}
          >
            {BILLING_INTERVALS.map((option) => (
              <Radio key={option} value={option}>
                {t(INTERVAL_LABEL[option])}
              </Radio>
            ))}
          </RadioGroup>
        </div>

        <PlanCards
          currentPlanId={billing.planId}
          interval={interval}
          canPurchase={canManage && billing.configured}
        />
      </section>

      <ConfirmDialog
        isOpen={isCancelOpen}
        onOpenChange={setCancelOpen}
        title={t('billing.cancel.title')}
        body={t('billing.cancel.body', { date: periodEndLabel })}
        confirmLabel={t('billing.cancel.confirm')}
        errorTitle={t('billing.error.title')}
        errorBody={t('members.error.generic')}
        onConfirm={async () => {
          await cancelSubscription()
          refresh()
        }}
      />
    </div>
  )
}

const INTERVAL_LABEL: Readonly<Record<BillingInterval, MessageKey>> = {
  monthly: 'plans.interval.monthly',
  yearly: 'plans.interval.yearly',
}

/**
 * The one sentence under the plan name.
 *
 * Every state the resolver can report has its own sentence, including the two that are easy to
 * leave unwritten: **grace**, which has to name the day the plan stops working, and **confirming**,
 * which has to admit that the payment has not been applied yet.
 */
function PlanState({
  view,
  confirming,
}: {
  view: BillingView
  confirming: boolean
}) {
  const t = useTranslate()
  const locale = useLocale()
  const subscription = view.subscription

  if (confirming && view.state === 'no-subscription') {
    return <>{t('billing.state.confirming')}</>
  }

  const day = (value: Date | null) =>
    value === null ? '' : formatCalendarDate(locale, utcDay(value))

  if (view.state === 'no-subscription') return <>{t('billing.state.free')}</>
  if (view.state === 'lapsed') return <>{t('billing.state.lapsed')}</>
  if (view.state === 'grace') {
    return (
      <>
        {t('billing.state.grace', {
          date: day(subscription?.graceEndsAt ?? null),
        })}
      </>
    )
  }
  if (subscription?.cancelAtPeriodEnd) {
    return (
      <>
        {t('billing.state.cancelling', {
          date: day(subscription.currentPeriodEnd),
        })}
      </>
    )
  }
  if (subscription?.status === 'trialing') {
    return (
      <>
        {t('billing.state.trialing', {
          date: day(subscription.currentPeriodEnd),
        })}
      </>
    )
  }
  return (
    <>
      {t('billing.state.entitled', {
        date: day(subscription?.currentPeriodEnd ?? null),
      })}
    </>
  )
}

/**
 * The over-limit state, as a `role="status"` region and deliberately **not** an alert.
 *
 * An assertive interruption on every page load is hostile for a state that persists for days, and
 * the message is not urgent: nothing is being lost, only additions are refused.
 */
function OverLimitNotice() {
  const t = useTranslate()
  return (
    <div
      role="status"
      className="rounded-lg border border-warning bg-warning-soft px-4 py-3"
    >
      <p className="text-label font-semibold text-ink">
        {t('billing.overLimit.title')}
      </p>
      <p className="mt-1 max-w-[68ch] text-body text-ink-2">
        {t('billing.overLimit.body')}
      </p>
    </div>
  )
}
