import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import { ArrowDownLeft, ArrowUpRight, List, Plus, Trash2 } from "lucide-react"
import type { Ledger } from "@/server/ledger"
import { errorMessage, money, requestJson } from "@/lib/client"
import { Button } from "./ui/button"

type Entry = "transaction" | "account" | "category"

export function LedgerPanel() {
  const [ledger, setLedger] = useState<Ledger>()
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [entry, setEntry] = useState<Entry>()
  const pending = useRef(new Map<string, string>())

  useEffect(() => {
    let live = true
    void requestJson<Ledger>("ledger")
      .then((data) => {
        if (live) {
          setLedger(data)
          setError("")
        }
      })
      .catch((problem: unknown) => {
        if (live) setError(errorMessage(problem))
      })
    return () => {
      live = false
    }
  }, [attempt])

  async function change(body: Record<string, unknown>) {
    setBusy(true)
    setError("")
    const payload = JSON.stringify(body)
    const requestId = pending.current.get(payload) ?? crypto.randomUUID()
    pending.current.set(payload, requestId)
    try {
      await requestJson<{ ok: true }>("ledger", { ...body, requestId })
      pending.current.delete(payload)
      setAttempt((value) => value + 1)
      return true
    } catch (problem) {
      setError(errorMessage(problem))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add(event: FormEvent<HTMLFormElement>, type: Entry) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const data: Record<string, unknown> = Object.fromEntries(fields)
    if (type === "transaction") data.amountMinor = Number(data.amountMinor)
    if (await change({ ...data, action: `add-${type}` })) setEntry(undefined)
  }

  function remove(type: Entry, id: string, name: string) {
    if (window.confirm(`Delete “${name}”?`))
      void change({ action: `delete-${type}`, id })
  }

  if (!ledger) {
    return (
      <section className="panel">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </Button>
          </>
        ) : (
          <p role="status">Loading your ledger…</p>
        )}
      </section>
    )
  }

  const accounts = new Map(
    ledger.accounts.map((account) => [account.id, account.name])
  )
  const categories = new Map(
    ledger.categories.map((category) => [category.id, category.name])
  )

  return (
    <>
      {error && (
        <div className="mb-4">
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
          <Button
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
            disabled={busy}
          >
            Refresh ledger
          </Button>
        </div>
      )}
      <section className="mb-5" aria-labelledby="balances">
        <h2 id="balances" className="mb-3">
          Balances by currency
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ledger.balances.length === 0 && (
            <p className="panel text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
              Add an account to start tracking a balance.
            </p>
          )}
          {ledger.balances.map(({ currency, amountMinor }) => (
            <div className="panel balance" key={currency}>
              <p className="mb-2 text-xs text-muted-foreground">{currency}</p>
              <p className="text-xl font-semibold break-words tabular-nums">
                {money(amountMinor, currency)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {entry && (
        <section className="panel mb-5" aria-labelledby="add-entry">
          <h2 id="add-entry" className="mb-4">
            Add {entry === "account" ? "an" : "a"} {entry}
          </h2>
          <form key={entry} onSubmit={(event) => void add(event, entry)}>
            <div className="grid gap-4 sm:grid-cols-2">
              {entry === "transaction" ? (
                <>
                  <label>
                    Description
                    <input name="description" required maxLength={160} />
                  </label>
                  <label>
                    Date
                    <input
                      name="bookedOn"
                      type="date"
                      defaultValue={new Date().toISOString().slice(0, 10)}
                      required
                    />
                  </label>
                  <label>
                    Account
                    <select name="accountId" required>
                      {ledger.accounts.map(({ id, currency, name }) => (
                        <option key={id} value={id}>
                          {name} ({currency})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Category
                    <select name="categoryId" defaultValue="">
                      <option value="">Uncategorized</option>
                      {ledger.categories.map(({ id, name }) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="sm:col-span-2">
                    <span id="amount-minor-label">Amount in minor units</span>
                    <input
                      name="amountMinor"
                      type="number"
                      step="1"
                      min="-9007199254740991"
                      max="9007199254740991"
                      required
                      aria-labelledby="amount-minor-label"
                      aria-describedby="minor-units"
                    />
                    <span
                      id="minor-units"
                      className="text-xs text-muted-foreground"
                    >
                      Use positive amounts for income and negative amounts for
                      expenses. For EUR, enter −1250 for an expense of €12.50.
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Name
                    <input name="name" required maxLength={80} />
                  </label>
                  {entry === "account" && (
                    <label>
                      Currency code
                      <input
                        name="currency"
                        required
                        minLength={3}
                        maxLength={3}
                        placeholder="EUR"
                      />
                    </label>
                  )}
                </>
              )}
            </div>
            <div className="mt-4 flex gap-3">
              <Button type="submit" disabled={busy}>
                Save {entry}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setEntry(undefined)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </section>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="panel" aria-labelledby="transactions">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="transactions" className="flex items-center gap-2">
              <List size={18} aria-hidden="true" /> Transactions
            </h2>
            <Button
              size="sm"
              disabled={busy || accounts.size === 0}
              onClick={() => setEntry("transaction")}
            >
              <Plus aria-hidden="true" /> Add transaction
            </Button>
          </div>
          {ledger.transactions.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {accounts.size
                ? "No transactions yet."
                : "Add an account before recording a transaction."}
            </p>
          ) : (
            <ul className="mt-4 divide-y">
              {ledger.transactions.map((transaction) => (
                <li
                  className="flex flex-wrap items-center gap-3 py-3"
                  key={transaction.id}
                >
                  <span className="rounded-full bg-muted p-2">
                    {transaction.amount_minor > 0 ? (
                      <ArrowDownLeft size={16} aria-hidden="true" />
                    ) : (
                      <ArrowUpRight size={16} aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 basis-36">
                    <p className="text-sm font-semibold break-words">
                      {transaction.description}
                    </p>
                    <p className="text-xs break-words text-muted-foreground">
                      {transaction.booked_on} ·{" "}
                      {accounts.get(transaction.account_id)}
                      {transaction.category_id
                        ? ` · ${categories.get(transaction.category_id)}`
                        : ""}
                    </p>
                  </div>
                  <p className="text-sm tabular-nums">
                    {money(transaction.amount_minor, transaction.currency)}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={`Delete transaction ${transaction.description}`}
                    onClick={() =>
                      remove(
                        "transaction",
                        transaction.id,
                        transaction.description
                      )
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="grid gap-5">
          <section className="panel" aria-labelledby="accounts">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="accounts">Accounts</h2>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setEntry("account")}
              >
                <Plus aria-hidden="true" /> Add account
              </Button>
            </div>
            {ledger.accounts.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                No accounts yet.
              </p>
            )}
            <ul className="divide-y">
              {ledger.accounts.map(({ id, name, currency }) => (
                <li className="flex items-center gap-3 py-2 text-sm" key={id}>
                  <span className="min-w-0 flex-1 break-words">{name}</span>
                  <span className="text-xs text-muted-foreground">
                    {currency}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={`Delete account ${name}`}
                    onClick={() => remove("account", id, name)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel" aria-labelledby="categories">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="categories">Categories</h2>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setEntry("category")}
              >
                <Plus aria-hidden="true" /> Add category
              </Button>
            </div>
            {ledger.categories.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                No categories yet.
              </p>
            )}
            <ul className="divide-y">
              {ledger.categories.map(({ id, name }) => (
                <li className="flex items-center gap-3 py-2 text-sm" key={id}>
                  <span className="min-w-0 flex-1 break-words">{name}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={`Delete category ${name}`}
                    onClick={() => remove("category", id, name)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  )
}
