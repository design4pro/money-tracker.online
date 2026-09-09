# 0010. Balance-history rebuilds are serialised by an AccountLedger Durable Object

Status: accepted
Date: 2026-09-01

## Context

An account's balance history is the series behind the net-worth chart, the account detail chart and
several dashboard widgets. For an account held in a currency other than the workspace base, the
value on a day is _the units held on that day, valued at that day's rate_ — which means the series
is a **rebuild**, not an accumulation (`docs/MONEY.md` §5.1 records the phantom-loss failure that
accumulating produces).

A rebuild is physically a **delete-range plus insert** over `account_balances` for one account, and
it has to be whole-history to be idempotent.

D1 gives us neither of the two mechanisms this normally relies on:

- **No interactive transactions.** `db.batch()` is atomic, but there is no `BEGIN … COMMIT` spanning
  a read, a computation and a write.
- **No advisory locks.** There is nothing to take before touching an account's rows.

So two concurrent rebuilds of the same account can interleave their deletes and inserts and leave a
**hole** — a range of days with no rows — which the reader then forward-fills as if the last
surviving day were a real measurement. The chart is wrong, no error is raised anywhere, and the
trigger is ordinary: an import queue message and a user edit landing within the same second.

There is a second problem. A 5 000-row import touches perhaps five accounts. Naively that is 5 000
rebuild messages, each rebuilding the whole history, most of them redundant.

Considered and rejected:

- **A single-consumer queue.** Serialises globally, not per account, so one slow rebuild blocks every
  workspace's. And a queue with `max_concurrency: 1` is a throughput ceiling on the whole system for
  a problem that is per-account.
- **An optimistic version column on the account.** Detects the conflict after the fact; the loser
  retries. Workable, but the losing writer has already deleted rows, so the window where the history
  is a hole is real, just short.
- **Compare-and-set on a KV lock.** KV is eventually consistent. A lock that can be acquired twice
  is not a lock.

## Decision

Rebuilds go through a Durable Object class `AccountLedger`, addressed `idFromName(accountId)`.

```
rebuild(accountId):
  if running:  dirty = true; return 'coalesced'
  running = true
  do { dirty = false; await rebuildBalanceHistory({ accountId }) } while (dirty)
  running = false
  return 'rebuilt'
```

It provides exactly two things:

- **Serialisation** — one rebuild per account at a time, by construction.
- **Coalescing** — a request arriving during a rebuild sets a dirty bit instead of queueing a second
  pass, so the import above produces five rebuilds rather than 5 000.

**The DO holds no ledger data.** It holds a lock and a dirty bit and calls back into D1. Every row
still lives in D1, where it can be queried, exported and backed up normally.

`runWithLedgerBatch(fn)` opens an `AsyncLocalStorage` scope at the **outermost** boundary of every
server function, every cron body and every queue handler; it collects touched account ids and
enqueues one rebuild per account after `fn` settles — **including when `fn` throws**, because the
rows are already committed by then and the history is already stale.

A direct write to `account_balances` from outside `src/server/ledger` is a defect.

## Consequences

We take on a Durable Object: a binding, a migration tag, a re-export from `src/server/worker.ts`, and
a class whose local development story is more awkward than a plain function's. Debugging a coalesced
rebuild means reasoning about a stateful object rather than reading a stack trace.

There is a cost model attached — DO requests and duration are billed — though it is small here
because the object does almost nothing and exists for well under a second per invocation.

The failure mode moves rather than disappearing: if a write path forgets to open a ledger batch, the
account's chart is stale until the nightly sweep at 03:00 heals it. That sweep is a **safety net, not
the mechanism**; a person who edits a transaction and refreshes must see a correct chart immediately,
which is why the wrapper is at the outermost boundary and is lint-enforced.

**The lock and the dirty bit are in-memory, and a pass interrupted by eviction falls into that same
net.** A Durable Object is single-threaded, so the flag is tested and set inside one turn and needs
no storage to be a lock; persisting it only made an evicted instance able to leave a claim behind
that nothing would ever clear, which wedged the account permanently rather than for one pass
(issue #22, amended 2026-09-09). What storage holds is the record of the last pass, which is what
`GET /state` reports. The cost of the smaller lock is that an evicted pass is lost rather than
resumed; the next write to that account re-enqueues one, and the nightly sweep catches the rest.

In exchange, the interleaved-rebuild hole is unreachable rather than rare, and a bulk import costs
one rebuild per account instead of one per row.
