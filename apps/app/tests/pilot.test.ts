import { operations } from "../src/server/ops"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { readFile } from "node:fs/promises"
import { after, before, test } from "node:test"
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { pilotApi } from "../src/server/api"
import { createAuth, verifiedUser } from "../src/server/auth"
import {
  access,
  expiration,
  freshness,
  getEntitlement,
  receiveWebhook,
  reconcile,
  recheck,
} from "../src/server/billing"
import { readLedger, writeLedger } from "../src/server/ledger"
import type { Env, PolarEvent } from "../src/server/env"

const origin = "https://ledger.example.test"
const monthly = "cd960f79-20dc-4ecb-a5cb-71cd98939470"
const yearly = "ccc38126-f65f-4888-a58e-0e1e371b2df2"
const simulator = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response(null) } }",
    d1Databases: ["DB"],
  })
)
const inbox = new Map<string, string>()
let env: Env
let auth: ReturnType<typeof createAuth>
let alice: { id: string; cookie: string }
let bob: { id: string; cookie: string }

function authRequest(path: string, body?: object) {
  return new Request(
    `${origin}/api/auth/${path}`,
    body
      ? {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "cf-connecting-ip": "192.0.2.3",
          },
          body: JSON.stringify(body),
        }
      : { headers: { "cf-connecting-ip": "192.0.2.3" } }
  )
}

function pilot(path: string, cookie = "", body?: object, from = origin) {
  const headers = new Headers({ cookie })
  if (body) {
    headers.set("origin", from)
    headers.set("content-type", "application/json")
  }
  return pilotApi(
    new Request(`${origin}/api/pilot/${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    auth
  )
}

async function register(name: string) {
  const email = `${name}@example.test`
  const password = "local synthetic test passphrase"
  const pending = await auth.handler(
    authRequest("sign-up/email", {
      email,
      name,
      password,
      callbackURL: "/login",
    })
  )
  assert.equal(pending.status, 200, await pending.text())
  assert.equal(pending.headers.get("set-cookie"), null)
  const link = inbox.get(email)
  assert.ok(link)
  const verification = await auth.handler(
    new Request(link, { headers: { "cf-connecting-ip": "192.0.2.3" } })
  )
  assert.equal(verification.headers.get("location"), "/login")
  const signed = await auth.handler(
    authRequest("sign-in/email", { email, password })
  )
  assert.equal(signed.status, 200, await signed.clone().text())
  const header = signed.headers.get("set-cookie")
  assert.ok(header)
  assert.match(header, /__Secure-.*;.*HttpOnly.*;.*Secure/i)
  const cookie = header.split(";")[0]
  const user = await verifiedUser(auth, new Headers({ cookie }))
  assert.ok(user)
  return { id: user.id, cookie }
}

before(async () => {
  const db = await simulator.getD1Database("DB")
  const sql = await readFile(
    new URL("../migrations/0001_pilot.sql", import.meta.url),
    "utf8"
  )
  await db.batch(
    sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => db.prepare(statement))
  )
  const milestones = await readFile(
    new URL("../migrations/0002_pilot_milestones.sql", import.meta.url),
    "utf8"
  )
  await db.batch(
    milestones
      .trim()
      .split(/;\s*(?=ALTER TABLE|CREATE TRIGGER|$)/)
      .filter(Boolean)
      .map((statement) => db.prepare(statement))
  )

  env = {
    DB: db,
    APP_ORIGIN: origin,
    EMAIL_FROM: "auth@example.test",
    BETTER_AUTH_SECRET: "local-FIXTURE-yIU6tkrW4m78e0uBzUa3JqpM",
    POLAR_ENVIRONMENT: "sandbox",
    POLAR_ACCESS_TOKEN: "fixture-token",
    POLAR_WEBHOOK_SECRET: "fixture-webhook-secret-not-an-actual-secret",
    POLAR_MONTHLY_PRODUCT_ID: monthly,
    POLAR_YEARLY_PRODUCT_ID: yearly,
  } as Env
  auth = createAuth(env, ({ to, text }) => {
    const link = text.match(/https:\/\/\S+/)?.[0]
    assert.ok(link)
    inbox.set(to, link)
    return Promise.resolve()
  })
  alice = await register("alice")
  bob = await register("bob")
})

after(() => simulator.dispose())

test("verified sessions gate checkout and portal; Polar receives only server-owned identity and products", async (t) => {
  const calls: { path: string; body: unknown }[] = []
  const realFetch = globalThis.fetch
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (!url.hostname.endsWith("polar.sh")) return realFetch(input, init)
      assert.equal(url.hostname, "sandbox-api.polar.sh")
      const body: unknown =
        typeof init?.body === "string" ? JSON.parse(init.body) : null
      calls.push({ path: url.pathname, body })
      if (url.pathname.includes("/products/")) {
        const id = url.pathname.split("/").at(-1)
        return Response.json({
          id,
          name: "Synthetic plan",
          is_archived: false,
          is_recurring: true,
          recurring_interval: id === monthly ? "month" : "year",
          recurring_interval_count: 1,
          prices: [
            {
              source: "catalog",
              product_id: id,
              amount_type: "fixed",
              is_archived: false,
              price_amount: 501,
              price_currency: "eur",
            },
          ],
        })
      }
      return url.pathname.includes("customer-sessions")
        ? Response.json({ customer_portal_url: "https://portal.example.test" })
        : Response.json({ url: "https://checkout.example.test" })
    }
  )

  assert.equal((await pilot("checkout", "", { plan: "monthly" })).status, 401)
  assert.equal((await pilot("portal", "", {})).status, 401)
  assert.equal(
    (
      await pilot(
        "checkout",
        alice.cookie,
        { plan: "monthly" },
        "https://untrusted.example.test"
      )
    ).status,
    403
  )

  await env.DB.prepare("UPDATE user SET emailVerified = 0 WHERE id = ?")
    .bind(alice.id)
    .run()
  assert.equal(
    (await pilot("checkout", alice.cookie, { plan: "monthly" })).status,
    401
  )
  assert.equal((await pilot("portal", alice.cookie, {})).status, 401)
  await env.DB.prepare("UPDATE user SET emailVerified = 1 WHERE id = ?")
    .bind(alice.id)
    .run()
  assert.equal(
    (await pilot("checkout", alice.cookie, { plan: yearly })).status,
    400
  )
  assert.equal(calls.length, 0)

  const response = await pilot("checkout", alice.cookie, {
    plan: "monthly",
    email: "attacker@example.test",
    productId: yearly,
    userId: bob.id,
    success_url: "https://untrusted.example.test",
  })
  assert.equal(response.status, 200, await response.clone().text())
  assert.deepEqual(await response.json(), {
    url: "https://checkout.example.test",
  })
  const checkoutCall = calls.find(({ path }) => path.endsWith("/checkouts/"))
  assert.deepEqual(checkoutCall?.body, {
    products: [monthly],
    external_customer_id: alice.id,
    success_url: `${origin}/?checkout=return`,
    return_url: origin,
    allow_trial: false,
    allow_discount_codes: false,
  })
  const state = await (await pilot("status", alice.cookie)).json()
  assert.deepEqual(state, { status: "pending", expiresAt: null })
  assert.equal((await pilot("ledger", alice.cookie)).status, 403)
  assert.equal(
    (await pilot("portal", alice.cookie, { userId: bob.id })).status,
    200
  )
  assert.deepEqual(calls.at(-1)?.body, {
    external_customer_id: alice.id,
    return_url: origin,
  })
})

test("D1 ledger isolates two users, keeps signed exact balances by currency and exports after lapse", async () => {
  const gain = async () => Date.now() + 3_600_000
  await reconcile(env, alice.id, undefined, gain)
  await reconcile(env, bob.id, undefined, gain)

  async function addAccount(cookie: string, name: string, currency: string) {
    const response = await pilot("ledger", cookie, {
      action: "add-account",
      name,
      currency,
    })
    assert.equal(response.status, 200, await response.clone().text())
    const data = await response.json<Awaited<ReturnType<typeof readLedger>>>()
    const account = data.accounts.find((item) => item.name === name)
    assert.ok(account)
    return account
  }

  const euro = await addAccount(alice.cookie, "Euro reserve", "EUR")
  const dollar = await addAccount(alice.cookie, "Dollar wallet", "USD")
  const bobs = await addAccount(bob.cookie, "Bob only", "PLN")
  await writeLedger(env.DB, bob.id, {
    action: "add-category",
    name: "Bob only",
  })
  const category = (await readLedger(env.DB, bob.id)).categories[0]
  const transaction = {
    action: "add-transaction",
    amountMinor: 9007199254740991,
    description: "Synthetic income",
    bookedOn: "2026-11-03",
  }

  assert.equal(
    (
      await pilot("ledger", alice.cookie, {
        ...transaction,
        accountId: bobs.id,
      })
    ).status,
    404
  )
  assert.equal(
    (
      await pilot("ledger", alice.cookie, {
        ...transaction,
        accountId: euro.id,
        categoryId: category.id,
      })
    ).status,
    404
  )
  assert.equal(
    (
      await pilot("ledger", bob.cookie, {
        action: "delete-account",
        id: euro.id,
      })
    ).status,
    404
  )
  assert.equal(
    (
      await pilot("ledger", alice.cookie, {
        ...transaction,
        accountId: euro.id,
        amountMinor: Number.MAX_SAFE_INTEGER + 1,
      })
    ).status,
    400
  )
  assert.equal(
    (
      await pilot("ledger", alice.cookie, {
        ...transaction,
        accountId: euro.id,
        bookedOn: "2026-02-30",
      })
    ).status,
    400
  )
  for (const [accountId, amountMinor] of [
    [euro.id, transaction.amountMinor],
    [euro.id, 2],
    [dollar.id, -1250],
  ]) {
    const saved = await pilot("ledger", alice.cookie, {
      ...transaction,
      accountId,
      amountMinor,
      currency: "PLN",
    })
    assert.equal(saved.status, 200, await saved.text())
  }
  await assert.rejects(
    env.DB.prepare(
      `
    INSERT INTO ledger_transaction VALUES (?, 'bad', ?, NULL, 'USD', 10, 'Wrong currency', '2026-11-03')
  `
    )
      .bind(alice.id, euro.id)
      .run(),
    /FOREIGN KEY/
  )
  assert.equal(
    (
      await pilot("ledger", alice.cookie, {
        action: "delete-account",
        id: euro.id,
      })
    ).status,
    409
  )
  const aliceLedger = await readLedger(env.DB, alice.id)
  assert.deepEqual(aliceLedger.balances, [
    { currency: "EUR", amountMinor: "9007199254740993" },
    { currency: "USD", amountMinor: "-1250" },
  ])
  assert.equal((await readLedger(env.DB, bob.id)).transactions.length, 0)
  assert.equal(
    (
      await pilot("ledger", bob.cookie, {
        action: "delete-transaction",
        id: aliceLedger.transactions[0].id,
      })
    ).status,
    404
  )
  assert.equal(
    (
      await pilot("ledger", alice.cookie, {
        action: "delete-category",
        id: category.id,
      })
    ).status,
    404
  )

  await reconcile(env, alice.id, undefined, async () => 0)
  assert.equal((await pilot("ledger", alice.cookie)).status, 403)
  const response = await pilot("export", alice.cookie)
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="money-tracker.json"'
  )
  const data = await response.json<{
    accounts: typeof aliceLedger.accounts
    version: number
  }>()
  assert.equal(data.version, 1)
  assert.deepEqual(data.accounts, aliceLedger.accounts)
})

test("signed ingress queues only webhook event and external user ID", async () => {
  const messages: PolarEvent[] = []
  const webhookEnv = {
    ...env,
    POLAR_EVENTS: {
      send: async (message: PolarEvent) => {
        messages.push(message)
      },
    },
  }
  const body = JSON.stringify({
    type: "customer.state_changed",
    timestamp: new Date().toISOString(),
    data: {
      external_id: alice.id,
      active_subscriptions: [],
      email: "unused@example.test",
    },
  })
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac("sha256", env.POLAR_WEBHOOK_SECRET!)
    .update(`evt_test.${timestamp}.${body}`)
    .digest("base64")
  function request(payload: string) {
    return new Request(`${origin}/api/webhooks/polar`, {
      method: "POST",
      body: payload,
      headers: {
        "webhook-id": "evt_test",
        "webhook-timestamp": String(timestamp),
        "webhook-signature": `v1,${signature}`,
      },
    })
  }
  assert.equal(
    (await receiveWebhook(request(body + " "), webhookEnv)).status,
    400
  )
  assert.deepEqual(messages, [])
  assert.equal((await receiveWebhook(request(body), webhookEnv)).status, 204)
  assert.deepEqual(messages, [{ eventId: "evt_test", userId: alice.id }])
})

test("replay does not refetch, and late billing results cannot replace newer state", async () => {
  const now = Date.now()
  const until = now + 10_000
  let started!: () => void
  let finish!: (expires: number) => void
  const observed = new Promise<void>((resolve) => {
    started = resolve
  })
  const slow = new Promise<number>((resolve) => {
    finish = resolve
  })

  const olderRead = reconcile(env, alice.id, "event-old-delivery", () => {
    started()
    return slow
  })
  await observed
  await reconcile(env, alice.id, "event-recent", async () => 0)
  finish(until)
  await olderRead
  assert.equal(access(await getEntitlement(env.DB, alice.id), now), "inactive")
  await reconcile(env, alice.id, "event-old-delivery", () =>
    assert.fail("replay queried Polar")
  )

  // Out-of-order delivery fetches current state again and can repair revoked access.
  await reconcile(env, alice.id, "event-even-older", async () => until)
  const snapshot = await getEntitlement(env.DB, alice.id)
  assert.equal(access(snapshot, now), "active")
  assert.equal(access(snapshot, until), "expired")
  assert.equal(
    access(
      {
        status: "active",
        expires_at: now + 1,
        checked_at: now - freshness,
        pending_until: 0,
      },
      now
    ),
    "stale"
  )

  const valid = {
    product_id: monthly,
    status: "active",
    current_period_end: new Date(until).toISOString(),
    ends_at: null,
  }
  assert.equal(expiration([valid], [monthly, yearly], now), until)
  assert.equal(
    expiration([{ ...valid, status: "past_due" }], [monthly, yearly], now),
    0
  )
  assert.equal(
    expiration(
      [{ ...valid, ends_at: new Date(now).toISOString() }],
      [monthly, yearly],
      now
    ),
    0
  )
  assert.equal(expiration([valid], [yearly], now), 0)

  const eventCount = await env.DB.prepare(
    "SELECT count(*) AS total FROM polar_event WHERE user_id = ?"
  )
    .bind(alice.id)
    .first<number>("total")
  assert.equal(eventCount, 3)
})

test("a failed provider refresh is retryable and commits no event receipt", async () => {
  await assert.rejects(
    reconcile(env, bob.id, "retryable", async () => {
      throw new Error("synthetic outage")
    })
  )
  assert.equal(
    await env.DB.prepare(
      "SELECT id FROM polar_event WHERE id = 'retryable'"
    ).first(),
    null
  )
  await reconcile(env, bob.id, "retryable", async () => 0)
  assert.ok(
    await env.DB.prepare(
      "SELECT id FROM polar_event WHERE id = 'retryable'"
    ).first()
  )
})

test("password reset uses injected email and revokes the previous session", async () => {
  const reset = await auth.handler(
    authRequest("request-password-reset", {
      email: "bob@example.test",
      redirectTo: "/reset-password",
    })
  )
  assert.equal(reset.status, 200, await reset.text())
  const link = inbox.get("bob@example.test")
  assert.ok(link)
  const redirect = await auth.handler(
    new Request(link, { headers: { "cf-connecting-ip": "192.0.2.3" } })
  )
  const target = redirect.headers.get("location")
  assert.ok(target)
  const token = new URL(target, origin).searchParams.get("token")
  assert.ok(token)
  const update = await auth.handler(
    authRequest("reset-password", {
      token,
      newPassword: "a different synthetic password",
    })
  )
  assert.equal(update.status, 200, await update.text())
  assert.equal(
    await verifiedUser(auth, new Headers({ cookie: bob.cookie })),
    null
  )
})

test("scheduled recheck activates pending access and revokes stale provider state", async (t) => {
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE entitlement SET recheck_at = 0 WHERE user_id = ?"
    ).bind(alice.id),
    env.DB.prepare(
      `
      UPDATE entitlement SET pending_until = ?, recheck_at = 0 WHERE user_id = ?
    `
    ).bind(now + 60_000, bob.id),
  ])

  const requested: string[] = []
  const realFetch = globalThis.fetch
  t.mock.method(
    globalThis,
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (!url.hostname.endsWith("polar.sh")) return realFetch(input, init)
      assert.equal(url.hostname, "sandbox-api.polar.sh")
      const userId = url.pathname.match(
        /^\/v1\/customers\/external\/([^/]+)\/state$/
      )?.[1]
      assert.ok(userId)
      requested.push(userId)
      const activeSubscriptions =
        userId === bob.id
          ? [
              {
                product_id: yearly,
                status: "active",
                current_period_end: new Date(now + 60_000).toISOString(),
                ends_at: null,
              },
            ]
          : []
      return Promise.resolve(
        Response.json({
          external_id: userId,
          active_subscriptions: activeSubscriptions,
        })
      )
    }
  )
  await recheck(env)
  assert.deepEqual(new Set(requested), new Set([alice.id, bob.id]))
  assert.equal(access(await getEntitlement(env.DB, alice.id)), "inactive")
  assert.equal(access(await getEntitlement(env.DB, bob.id)), "active")
})

test("operations report aggregate milestones and refresh lag without exposing user data", async () => {
  const db = env.DB
  const signup = await db
    .prepare("SELECT count(*) AS total FROM user")
    .first<number>("total")
  const firstPaid = await db
    .prepare("SELECT first_paid_at FROM user WHERE id = ?")
    .bind(alice.id)
    .first<number>("first_paid_at")
  assert.ok(firstPaid && firstPaid > 0)
  const firstTransaction = await db
    .prepare("SELECT first_transaction_at FROM user WHERE id = ?")
    .bind(alice.id)
    .first<number>("first_transaction_at")
  assert.ok(firstTransaction && firstTransaction >= firstPaid)

  await reconcile(
    env,
    alice.id,
    "milestone-expired",
    async () => Date.now() - 1
  )
  await reconcile(env, alice.id, "milestone-expired", () =>
    assert.fail("replay queried Polar")
  )
  await reconcile(
    env,
    alice.id,
    "milestone-renewed",
    async () => Date.now() + 60_000
  )
  assert.equal(
    await db
      .prepare("SELECT first_paid_at FROM user WHERE id = ?")
      .bind(alice.id)
      .first<number>("first_paid_at"),
    firstPaid
  )

  const opsEnv = { ...env, POLAR_SIGNAL_TOKEN: "synthetic-signal-token" }
  const get = (path: string, token?: string) =>
    operations(
      new Request(`https://app.invalid${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
      opsEnv,
      path
    )
  const path = "/ops/pilot-milestones"
  assert.equal((await get(path)).status, 401)
  assert.equal((await get(path, "wrong")).status, 401)
  const response = await get(path, opsEnv.POLAR_SIGNAL_TOKEN)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  const counts: Record<string, number> = await response.json()
  assert.deepEqual(Object.keys(counts).sort(), [
    "firstPaid",
    "firstTransaction",
    "signUps",
  ])
  assert.equal(counts.signUps, signup)
  assert.ok(
    counts.firstPaid >= counts.firstTransaction && counts.firstTransaction >= 1
  )

  const lag = "/ops/polar-lag"
  assert.equal((await get(lag)).status, 401)
  await db
    .prepare("UPDATE entitlement SET recheck_at = ? WHERE user_id = ?")
    .bind(Date.now() - 90_000, alice.id)
    .run()
  assert.deepEqual(await (await get(lag, opsEnv.POLAR_SIGNAL_TOKEN)).json(), {
    lagSeconds: 90,
  })
})
