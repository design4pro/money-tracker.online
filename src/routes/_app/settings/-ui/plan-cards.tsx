import { Check } from 'lucide-react'

import { Badge, Button, Card, CardBody, CardHeader } from '#/components/ui'
import { PLAN_LIST, yearlySavingPercent } from '#/lib/plans'
import { useLocale, useTranslate } from '#/lib/i18n'
import { asCurrencyCode, asMinor, formatMoney, makeMoney } from '#/lib/money'

import type { BillingInterval, PlanDefinition, PlanId } from '#/lib/plans'

/**
 * The three tiers, side by side, each with the price it is actually charged at.
 *
 * ## The price is the provider's, and it is never converted
 *
 * A subscription billed in EUR is a EUR fact. Rendering it in the household's base currency would
 * print a number nobody was ever charged, and one that changes with the rate of the day.
 * {@link formatPrice} formats with the **billing** currency's own digits, which is what makes a
 * zero-digit currency render correctly rather than a hundred times too small.
 *
 * ## Upgrading is a form post, not a fetch
 *
 * `/api/billing/checkout` answers with a 303 to the provider's hosted page, and a plain `<form>`
 * follows a redirect to another origin where `fetch` would not. It also means the flow works before
 * hydration and with scripting unavailable — for a payment path that is worth more than the
 * animation it costs.
 */

export interface PlanCardsProps {
  readonly currentPlanId: PlanId
  readonly interval: BillingInterval
  /** `false` when the deployment has no billing credentials: the cards render without actions. */
  readonly canPurchase: boolean
}

export function PlanCards({
  currentPlanId,
  interval,
  canPurchase,
}: PlanCardsProps) {
  return (
    <ul className="grid items-start gap-4 lg:grid-cols-3">
      {PLAN_LIST.map((plan) => (
        <li key={plan.id}>
          <PlanCard
            plan={plan}
            interval={interval}
            isCurrent={plan.id === currentPlanId}
            canPurchase={canPurchase}
          />
        </li>
      ))}
    </ul>
  )
}

function PlanCard({
  plan,
  interval,
  isCurrent,
  canPurchase,
}: {
  plan: PlanDefinition
  interval: BillingInterval
  isCurrent: boolean
  canPurchase: boolean
}) {
  const t = useTranslate()
  const locale = useLocale()
  const price = plan.prices?.[interval] ?? null
  const saving = interval === 'yearly' ? yearlySavingPercent(plan.id) : null

  return (
    <Card padding="lg" className="h-full">
      <CardHeader
        headingLevel={3}
        title={t(plan.nameKey)}
        description={t(plan.taglineKey)}
      />
      <CardBody className="flex flex-col gap-5">
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="text-title font-bold tabular-nums text-ink">
            {price === null
              ? t('plans.price.free')
              : t(
                  interval === 'yearly'
                    ? 'plans.price.yearly'
                    : 'plans.price.monthly',
                  {
                    amount: formatPrice(
                      locale,
                      price.amountMinor,
                      price.currency,
                    ),
                  },
                )}
          </span>
          {saving === null ? null : (
            <Badge tone="positive">
              {t('plans.saving', { percent: saving })}
            </Badge>
          )}
        </p>

        <ul className="flex flex-col gap-2">
          {plan.featureKeys.map((key) => (
            <li
              key={key}
              className="flex items-start gap-2 text-body text-ink-2"
            >
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>

        {isCurrent ? (
          <p className="text-label font-semibold text-ink">
            {t('plans.current')}
          </p>
        ) : plan.free || !canPurchase ? null : (
          <form method="post" action="/api/billing/checkout">
            <input type="hidden" name="planId" value={plan.id} />
            <input type="hidden" name="interval" value={interval} />
            <Button type="submit" variant="primary" className="w-full">
              {t('billing.action.upgrade')}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * A billing amount, in the currency it is billed in.
 *
 * `asMinor` is the one deliberate crossing between the plan catalogue's plain integers and the
 * money formatter's branded ones, and it is confined to this function. The brand marks *ledger*
 * money — amounts that flow through the arithmetic in `src/lib/money` — and a plan price must never
 * be addable to a transaction, which is why `plans.ts` does not carry it and why the cast happens
 * here, at the last step before the string.
 */
function formatPrice(
  locale: ReturnType<typeof useLocale>,
  amountMinor: number,
  currency: string,
): string {
  return formatMoney(
    locale,
    makeMoney(asMinor(amountMinor), asCurrencyCode(currency)),
  )
}
