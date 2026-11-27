import assert from "node:assert/strict"
import { chromium } from "playwright"
import type { Ledger } from "../src/server/ledger"

const rows = [
  { description: "market refund", amount_minor: 125 },
  { description: "train ticket", amount_minor: -200 },
  { description: "market purchase", amount_minor: -450 },
  { description: "rebate", amount_minor: 100 },
  { description: "balance adjustment", amount_minor: 0 },
]

const ledger: Ledger = {
  accounts: [{ id: "wallet", name: "Wallet", currency: "USD" }],
  categories: [],
  balances: [{ currency: "USD", amountMinor: "-425" }],
  transactions: rows.map((row, index) => ({
    ...row,
    id: String(index),
    account_id: "wallet",
    category_id: null,
    currency: "USD",
    booked_on: "2026-11-01",
  })),
}

export async function checkLedgerBrowser(origin: string, activeCookie: string) {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({
      viewport: { width: 320, height: 720 },
    })
    const separator = activeCookie.indexOf("=")
    await context.addCookies([
      {
        url: origin,
        name: activeCookie.slice(0, separator),
        value: activeCookie.slice(separator + 1),
      },
    ])
    const page = await context.newPage()
    await page.route(new URL("/api/pilot/ledger", origin).href, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: ledger })
        : route.continue()
    )
    await page.goto(origin)
    const transactions = page.getByRole("region", { name: "Transactions" })
    const search = transactions.getByRole("searchbox", {
      name: "Search transaction descriptions",
    })
    const direction = transactions.getByRole("combobox", {
      name: "Transaction direction",
    })
    const descriptions = transactions
      .getByRole("listitem")
      .locator("div > p:first-child")
    await descriptions.first().waitFor()
    assert.equal(await direction.inputValue(), "all")
    assert.deepEqual(
      await descriptions.allTextContents(),
      rows.map((row) => row.description)
    )

    await search.focus()
    await page.keyboard.press("Tab")
    assert.ok(
      await direction.evaluate((element) => {
        const style = getComputedStyle(element)
        return (
          element.matches(":focus-visible") &&
          style.outlineStyle !== "none" &&
          parseFloat(style.outlineWidth) >= 2
        )
      })
    )
    for (const control of [search, direction]) {
      const bounds = await control.boundingBox()
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320)
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    )

    await page.keyboard.press("ArrowDown")
    assert.equal(await direction.inputValue(), "spending")
    assert.deepEqual(await descriptions.allTextContents(), [
      "train ticket",
      "market purchase",
    ])
    await page.keyboard.press("ArrowDown")
    assert.equal(await direction.inputValue(), "income")
    assert.deepEqual(await descriptions.allTextContents(), [
      "market refund",
      "rebate",
    ])

    await search.fill("Market")
    assert.deepEqual(await descriptions.allTextContents(), ["market refund"])
    await direction.selectOption("spending")
    assert.deepEqual(await descriptions.allTextContents(), ["market purchase"])
    await direction.selectOption("all")
    assert.equal(await search.inputValue(), "Market")
    assert.deepEqual(await descriptions.allTextContents(), [
      "market refund",
      "market purchase",
    ])

    await search.fill("train")
    await direction.selectOption("income")
    assert.equal(
      await transactions.getByRole("status").textContent(),
      "No transactions match your filters."
    )
  } finally {
    await browser.close()
  }
}
