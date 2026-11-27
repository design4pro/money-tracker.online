import { Link, createFileRoute } from "@tanstack/react-router"
import { ArrowDownToLine } from "lucide-react"
import { Session } from "@/components/session"
import { SpendingChat } from "@/components/spending-chat"
import { LedgerPanel } from "@/components/ledger-panel"
import { Button } from "@/components/ui/button"
import { subscriptionLabel, useSubscription } from "@/lib/subscription"

export const Route = createFileRoute("/")({
  validateSearch: (
    search: Record<string, unknown>
  ): { checkout?: "return" } => ({
    checkout: search.checkout === "return" ? "return" : undefined,
  }),
  component: Dashboard,
})

function Dashboard() {
  const returning = Route.useSearch().checkout === "return"
  return (
    <Session>
      {(name, userId) => (
        <Workspace key={userId} name={name} returning={returning} />
      )}
    </Session>
  )
}

function Workspace({ name, returning }: { name: string; returning: boolean }) {
  const { state, error, refresh } = useSubscription(returning)
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">Welcome, {name}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {state?.spendingChat && <SpendingChat />}
          <Button
            render={<a href="/api/pilot/export" download />}
            nativeButton={false}
            variant="outline"
          >
            <ArrowDownToLine aria-hidden="true" /> Export JSON
          </Button>
        </div>
      </div>
      <section
        className="panel mb-5 flex flex-wrap items-center justify-between gap-3"
        aria-label="Subscription status"
      >
        <div>
          <p className="font-semibold" role="status">
            {state ? subscriptionLabel[state.status] : "Checking subscription…"}
          </p>
          {returning && state?.status !== "active" && (
            <p className="mt-1 text-sm text-muted-foreground">
              Waiting for Polar to confirm your subscription. This page checks
              for updates automatically.
            </p>
          )}
          {error && (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm">
          {(returning || error || state?.status === "stale") && (
            <Button variant="ghost" onClick={refresh}>
              Check again
            </Button>
          )}
          <Link to="/billing">Manage billing</Link>
        </div>
      </section>
      {state?.status === "active" ? (
        <LedgerPanel />
      ) : state ? (
        <section className="panel">
          <h2>Ledger access</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            An active subscription opens your ledger. You can always export your
            saved data from this page.
          </p>
        </section>
      ) : null}
    </>
  )
}
