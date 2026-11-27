import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { test } from "node:test"
import { createHttpAgentChatRuntime } from "@agent-native/core/client/agent-chat"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { createAuth } from "../src/server/auth"
import type { Ledger } from "../src/server/ledger"
import type { Env } from "../src/server/env"
import {
  spendingEndpoint,
  spendingQuestion as prompt,
} from "../src/lib/spending-chat"

const browser = process.env.CHAT_BROWSER === "1"
const origin = "http://localhost:3000"
const secret = "synthetic-chat-proof-secret-for-local-use-only"

function monthStart(date: Date, offset = 0) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)
  )
    .toISOString()
    .slice(0, 10)
}

test("Agent-Native streams owner-only monthly totals from the built Worker", async () => {
  const modules = [
    "index.js",
    ...(await readdir("dist/server/assets"))
      .filter((name) => name.endsWith(".js"))
      .map((name) => `assets/${name}`),
  ].map((name) => ({ type: "ESModule" as const, path: `dist/server/${name}` }))
  const options = (enabled: boolean) =>
    convertV4MiniflareOptions({
      ...(browser && {
        host: "localhost",
        port: 3000,
        assets: {
          directory: "dist/client",
          routerConfig: { has_user_worker: true },
        },
      }),
      modules,
      modulesRoot: "dist/server",
      compatibilityDate: "2026-11-26",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      bindings: {
        APP_ORIGIN: origin,
        BETTER_AUTH_SECRET: secret,
        ...(enabled && { LOCAL_CHAT_PROOF: "1" }),
        EMAIL_FROM: "auth@example.test",
        POLAR_ENVIRONMENT: "sandbox",
      },
    })
  const worker = new Miniflare(options(true))
  try {
    const db = await worker.getD1Database("DB")
    for (const name of [
      "0001_pilot",
      "0002_pilot_milestones",
      "0003_pilot_write_safety",
      "0004_polar_access_refresh",
    ]) {
      const sql = await readFile(`migrations/${name}.sql`, "utf8")
      await db.batch(
        sql
          .trim()
          .split(/;\s*(?=CREATE|ALTER|DROP|$)/)
          .filter(Boolean)
          .map((statement) => db.prepare(statement))
      )
    }
    const health = await worker.dispatchFetch(`${origin}/health`)
    assert.equal(health.status, 200)
    await health.json()

    const inbox = new Map<string, string>()
    const auth = createAuth(
      {
        DB: db,
        APP_ORIGIN: origin,
        BETTER_AUTH_SECRET: secret,
      } as Env,
      async ({ to, text }) => {
        inbox.set(to, text)
      }
    )

    let clientNumber = 0
    async function fixture(name: string, active: boolean, verified = true) {
      const ip = `192.0.2.${++clientNumber}`
      const email = `${name}@example.test`
      const password = "local synthetic test passphrase"
      const authRoute = (path: string) =>
        auth.handler(
          new Request(`${origin}/api/auth/${path}`, {
            method: "POST",
            headers: {
              origin,
              "content-type": "application/json",
              "cf-connecting-ip": ip,
            },
            body: JSON.stringify({ name, email, password, callbackURL: "/" }),
          })
        )
      const signUp = await authRoute("sign-up/email")
      assert.equal(signUp.status, 200)
      await signUp.text()
      const link = inbox.get(email)?.match(/https?:\/\/\S+/)?.[0]
      assert.ok(link)
      const verification = await auth.handler(new Request(link))
      assert.equal(verification.status, 302)
      const signIn = await authRoute("sign-in/email")
      assert.equal(signIn.status, 200)
      const cookie = signIn.headers.getSetCookie()[0]?.split(";")[0]
      assert.ok(cookie)
      const session = await auth.api.getSession({
        headers: new Headers({ cookie }),
      })
      assert.ok(session)
      const id = session.user.id
      if (!verified)
        await db
          .prepare("UPDATE user SET emailVerified = 0 WHERE id = ?")
          .bind(id)
          .run()
      if (active)
        await db
          .prepare(
            "INSERT INTO entitlement(user_id, status, checked_at, expires_at) VALUES (?, 'active', ?, ?)"
          )
          .bind(id, Date.now(), Date.now() + 3_600_000)
          .run()
      return { id, cookie }
    }

    const alice = await fixture("alice", true)
    const bob = await fixture("bob", true)
    const unverified = await fixture("unverified", true, false)
    const unsubscribed = await fixture("unsubscribed", false)
    const now = new Date()
    const monthlyEntries = [
      [alice.id, "USD", -125],
      [alice.id, "USD", -300],
      [alice.id, "USD", 1000],
      [alice.id, "EUR", -750],
      [bob.id, "USD", -49],
      [unverified.id, "USD", -123456],
      [unsubscribed.id, "USD", -654321],
    ] as const
    // Either month may be current by the time the Worker handles a turn.
    // Expenses on both month starts also exercise the exclusive upper bound.
    const fixtures = [
      ...[monthStart(now), monthStart(now, 1)].flatMap((date) =>
        monthlyEntries.map(
          ([id, currency, amount]) => [id, currency, amount, date] as const
        )
      ),
      [alice.id, "USD", -8000, monthStart(now, -1)],
      [alice.id, "USD", -9000, monthStart(now, 2)],
    ] as const
    await db.batch(
      fixtures.flatMap(([id, currency, amount, date], index) => [
        db
          .prepare(
            "INSERT OR IGNORE INTO ledger_account VALUES (?, ?, 'Synthetic account', ?)"
          )
          .bind(id, currency, currency),
        db
          .prepare(
            "INSERT INTO ledger_transaction VALUES (?, ?, ?, NULL, ?, ?, 'Private synthetic description', ?)"
          )
          .bind(id, String(index), currency, currency, amount, date),
      ])
    )

    const workerUrl = await worker.ready
    const endpoint = new URL(spendingEndpoint, workerUrl).href
    async function answer(cookie: string, claimedUserId: string) {
      const runtime = createHttpAgentChatRuntime({
        endpoint,
        headers: { origin, cookie },
        mapRequest: ({ turn }) => ({
          prompt: turn.prompt,
          userId: claimedUserId,
        }),
        fetch: async (input, init) => {
          const response = await fetch(input, init)
          assert.match(
            response.headers.get("content-type") ?? "",
            /^text\/event-stream/
          )
          assert.equal(response.headers.get("cache-control"), "no-store")
          return response
        },
      })
      const session = await runtime.createSession()
      const turn = await session.startTurn({ prompt })
      const types: string[] = []
      const text: string[] = []
      for await (const event of turn.events) {
        types.push(event.type)
        if (event.type === "message-delta" && event.delta.type === "text")
          text.push(event.delta.text)
      }
      assert.deepEqual(types, [
        "message-start",
        "message-delta",
        "message-delta",
        "done",
      ])
      return text.join("")
    }
    for (const [viewer, other, expected] of [
      [alice, bob, "750 minor units (EUR), 425 minor units (USD)"],
      [bob, alice, "49 minor units (USD)"],
    ] as const) {
      const ledger = await fetch(new URL("/api/pilot/ledger", workerUrl), {
        headers: { cookie: viewer.cookie },
      })
      assert.equal(ledger.status, 200)
      const { transactions } = await ledger.json<Ledger>()
      const beforeTurn = new Date()
      const text = await answer(viewer.cookie, other.id)
      const afterTurn = new Date()
      const period = [beforeTurn, afterTurn]
        .map((date) => {
          const from = monthStart(date)
          const until = monthStart(date, 1)
          return {
            from,
            until,
            prefix: `Spending from ${from} up to ${until} (exclusive, UTC): `,
          }
        })
        .find(({ prefix }) => text.startsWith(prefix))
      assert.ok(
        period,
        "The answer must identify the UTC month at the time of the turn"
      )
      const { from, until, prefix } = period
      const derived = new Map<string, bigint>()
      for (const row of transactions) {
        if (
          row.booked_on >= from &&
          row.booked_on < until &&
          row.amount_minor < 0
        ) {
          derived.set(
            row.currency,
            (derived.get(row.currency) ?? 0n) - BigInt(row.amount_minor)
          )
        }
      }
      const fromLedger = [...derived]
        .sort()
        .map(([currency, amount]) => `${amount} minor units (${currency})`)
        .join(", ")
      assert.equal(fromLedger, expected)
      assert.equal(text, prefix + fromLedger)
    }
    for (const [cookie, status, message] of [
      ["", 401, "Sign in with a verified email to continue."],
      [unverified.cookie, 401, "Sign in with a verified email to continue."],
      [unsubscribed.cookie, 403, "An active subscription is required."],
    ] as const) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { cookie, origin, "content-type": "application/json" },
        body: JSON.stringify({ prompt, userId: alice.id }),
      })
      assert.equal(response.status, status)
      assert.deepEqual(await response.json(), { message })
    }
    const unsupported = await fetch(endpoint, {
      method: "POST",
      headers: {
        cookie: alice.cookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt: "List my transactions" }),
    })
    assert.equal(unsupported.status, 400)
    assert.equal(
      (await unsupported.json<{ message: string }>()).message,
      "Ask about spending this month."
    )
    const crossOrigin = await fetch(endpoint, {
      method: "POST",
      headers: {
        cookie: alice.cookie,
        origin: "https://example.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    })
    assert.equal(crossOrigin.status, 403)
    assert.equal(
      (await crossOrigin.json<{ message: string }>()).message,
      "Invalid request origin."
    )

    if (browser) {
      const { checkChatBrowser } = await import("./chat-browser")
      const { checkLedgerBrowser } = await import("./ledger-browser")
      await checkChatBrowser(origin, alice.cookie, unsubscribed.cookie)
      await checkLedgerBrowser(origin, alice.cookie)
    }
    await worker.setOptions(options(false))
    const disabled = await worker.dispatchFetch(
      `${origin}${spendingEndpoint}`,
      {
        method: "POST",
        headers: {
          cookie: alice.cookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      }
    )
    assert.equal(disabled.status, 404)
    assert.deepEqual(await disabled.json(), { message: "Endpoint not found." })
    const status = await worker.dispatchFetch(`${origin}/api/pilot/status`, {
      headers: { cookie: alice.cookie },
    })
    assert.equal(status.status, 200)
    assert.deepEqual(Object.keys((await status.json()) as object).sort(), [
      "expiresAt",
      "status",
    ])
  } finally {
    await worker.dispose()
  }
})
