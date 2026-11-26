import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { CreditCard, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Session } from "@/components/session"
import { errorMessage, money, requestJson } from "@/lib/client"
import { subscriptionLabel, useSubscription } from "@/lib/subscription"

export const Route = createFileRoute("/billing")({
  component: () => <Session>{() => <Billing />}</Session>,
})

interface Plan {
  plan: "monthly" | "yearly"
  name: string
  amount: number
  currency: string
}

function Billing() {
  const { state, error, refresh } = useSubscription()
  const [plans, setPlans] = useState<Plan[]>([])
  const [planError, setPlanError] = useState("")
  const [actionError, setActionError] = useState("")
  const [busy, setBusy] = useState(false)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const canCheckout =
    !!state && state.status !== "active" && state.status !== "stale"

  useEffect(() => {
    if (!canCheckout) return
    let live = true
    void requestJson<{ plans: Plan[] }>("catalog")
      .then(({ plans: products }) => {
        if (live) {
          setPlans(products)
          setPlanError("")
        }
      })
      .catch((problem: unknown) => {
        if (live) setPlanError(errorMessage(problem))
      })
    return () => {
      live = false
    }
  }, [canCheckout, catalogAttempt])

  async function go(plan?: Plan["plan"]) {
    setActionError("")
    setBusy(true)
    try {
      const { url } = await requestJson<{ url: string }>(
        plan ? "checkout" : "portal",
        plan ? { plan } : {}
      )
      window.location.assign(url)
    } catch (problem) {
      setActionError(errorMessage(problem))
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="mb-5 text-3xl font-semibold tracking-tight">Billing</h1>
      <section className="panel mb-5" aria-labelledby="subscription">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2" id="subscription">
              <CreditCard size={18} aria-hidden="true" /> Subscription
            </h2>
            <p className="mt-2 text-sm" role="status">
              {state
                ? subscriptionLabel[state.status]
                : "Checking subscription…"}
            </p>
            {state?.expiresAt && state.status === "active" ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Current period ends{" "}
                {new Date(state.expiresAt).toLocaleDateString()}.
              </p>
            ) : null}
          </div>
          <Button variant="outline" disabled={busy} onClick={() => void go()}>
            Open billing portal <ExternalLink aria-hidden="true" />
          </Button>
        </div>
        {error && (
          <p className="mt-3 text-destructive" role="alert">
            {error}
          </p>
        )}
        {actionError && (
          <p className="mt-3 text-destructive" role="alert">
            {actionError}
          </p>
        )}
        <Button variant="ghost" className="mt-2" onClick={refresh}>
          Refresh status
        </Button>
      </section>
      {canCheckout && (
        <section aria-labelledby="plans-heading">
          <h2 className="mb-3" id="plans-heading">
            Choose a subscription
          </h2>
          {planError ? (
            <div className="panel">
              <p role="alert">{planError}</p>
              <Button
                className="mt-2"
                variant="outline"
                onClick={() => setCatalogAttempt((value) => value + 1)}
              >
                Try again
              </Button>
            </div>
          ) : plans.length === 0 ? (
            <p role="status">Loading plans…</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {plans.map((plan) => (
                <article className="panel" key={plan.plan}>
                  <h3>{plan.name}</h3>
                  <p className="my-4 text-xl font-semibold">
                    {money(plan.amount, plan.currency.toUpperCase())}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      / {plan.plan === "monthly" ? "month" : "year"}
                    </span>
                  </p>
                  <Button disabled={busy} onClick={() => void go(plan.plan)}>
                    Continue to checkout
                  </Button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  )
}
