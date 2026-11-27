import assert from "node:assert/strict"
import { chromium, devices } from "playwright"
import { spendingEndpoint, spendingQuestion } from "../src/lib/spending-chat"

const entryLabel = "Ask Money Tracker"

export async function checkChatBrowser(
  origin: string,
  activeCookie: string,
  inactiveCookie: string
) {
  const browser = await chromium.launch()
  try {
    for (const { name, options, mobile } of [
      {
        name: "desktop",
        options: { viewport: { width: 1440, height: 900 } },
        mobile: false,
      },
      {
        name: "mobile",
        options: devices["iPhone 13"],
        mobile: true,
      },
    ]) {
      const context = await browser.newContext(options)
      try {
        const page = await context.newPage()
        const errors: string[] = []
        page.on("pageerror", (error) => errors.push(error.message))
        await page.addInitScript((endpoint) => {
          const originalFetch = window.fetch
          window.fetch = (input, init) => {
            if (input === endpoint) {
              init?.signal?.addEventListener(
                "abort",
                () => {
                  document.documentElement.dataset.chatAborted = "true"
                },
                { once: true }
              )
            }
            return originalFetch(input, init)
          }
        }, spendingEndpoint)
        await page.goto(origin)
        await page.getByText("Your private workspace").waitFor()
        const entry = page.getByRole("button", { name: entryLabel })
        assert.equal(await entry.count(), 0)
        async function signIn(cookie: string) {
          const separator = cookie.indexOf("=")
          await context.addCookies([
            {
              url: origin,
              name: cookie.slice(0, separator),
              value: cookie.slice(separator + 1),
            },
          ])
          await page.reload()
          await entry.waitFor()
        }

        await signIn(activeCookie)
        if (mobile) await entry.tap()
        else {
          await entry.focus()
          await page.keyboard.press("Enter")
        }
        const dialog = page.getByRole("dialog", { name: entryLabel })
        const ask = dialog.getByRole("button", { name: spendingQuestion })
        await dialog.waitFor()
        await page.waitForFunction(
          (question) => document.activeElement?.textContent.trim() === question,
          spendingQuestion
        )
        const bounds = await dialog.boundingBox()
        const viewport = page.viewportSize()
        assert.ok(bounds && viewport)
        assert.equal(bounds.height, viewport.height, name)
        assert.equal(bounds.x + bounds.width, viewport.width, name)
        assert.equal(bounds.width === viewport.width, mobile, name)
        await page.keyboard.press("Shift+Tab")
        assert.equal(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement)
          ),
          true
        )

        await ask.click()
        await dialog
          .getByRole("paragraph")
          .filter({
            hasText: /750 minor units \(EUR\), 425 minor units \(USD\)/,
          })
          .waitFor()
        await page.keyboard.press("Escape")
        await dialog.waitFor({ state: "hidden" })
        await page.waitForFunction(
          (label) => document.activeElement?.textContent.trim() === label,
          entryLabel
        )

        await entry.click()
        let release!: () => void
        const delayed = new Promise<void>((resolve) => {
          release = resolve
        })
        await page.route(
          `**${spendingEndpoint}`,
          async (route) => {
            await delayed
            await route.abort("aborted")
          },
          { times: 1 }
        )
        const sent = page.waitForRequest((request) =>
          request.url().endsWith(spendingEndpoint)
        )
        await ask.click()
        await sent
        await dialog
          .getByText("Checking your spending…", { exact: true })
          .filter({ visible: true })
          .last()
          .waitFor()
        try {
          await dialog.getByRole("button", { name: "Stop response" }).click()
          await dialog
            .getByText("Response stopped.", { exact: true })
            .last()
            .waitFor()
          await page.waitForFunction(
            () => document.documentElement.dataset.chatAborted === "true"
          )
          await page.waitForFunction(
            (question) =>
              document.activeElement?.textContent.trim() === question,
            spendingQuestion
          )
          assert.equal(await dialog.getByText(/425 minor units/).count(), 0)
        } finally {
          release()
        }
        await dialog.getByRole("button", { name: "Close chat" }).click()
        await dialog.waitFor({ state: "hidden" })

        await signIn(inactiveCookie)
        await entry.click()
        await ask.click()
        const denial = dialog.getByRole("alert")
        await denial.waitFor()
        assert.match(
          await denial.innerText(),
          /active subscription is required/
        )
        assert.equal(await dialog.getByText(/minor units/).count(), 0)
        assert.deepEqual(errors, [], name)
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
