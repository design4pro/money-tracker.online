import { expect, test, watchConsole } from './support/console'

import { useLocale, waitForHydration } from './support/app'
import { storageStateFor } from './support/session'

import type { ConsoleReport } from './support/console'
import type {
  Browser,
  BrowserContextOptions,
  Page,
  Response,
} from '@playwright/test'

/**
 * The status matrix from issue #16, asserted where the status actually exists.
 *
 * ## Why this claim can only be made in a browser
 *
 * "Answers 404" is a property of an HTTP response, and nothing below the router produces one. A
 * `createServerFn` value is not callable outside the Start request context — the dashboard's own
 * `-server/__tests__` file says so, and a probe on this branch confirmed it throws "No Start
 * context found in AsyncLocalStorage" — so a vitest case can prove the classifier
 * (`src/server/fns/__tests__/not-found.test.ts` does, exhaustively) and cannot prove that any of the
 * seven loaders is wired to it. The wiring is seven single lines, each one of which is exactly the
 * kind of edit that gets missed, so it is checked here: one real request per route, against the
 * real router, reading the real status code.
 *
 * ## What was wrong before
 *
 * All seven answered **500** with the retryable error panel and the repository's developer-facing
 * English sentence inside it — on the Polish locale too. Retrying never helped, because nothing was
 * broken: the row does not exist. An address the router cannot match at all (`/zzz/qqq`) already
 * answered 404, which is why one case below is the control: the not-found machinery worked and
 * simply was never reached from a matched route.
 *
 * ## The row that is deliberately not 404
 *
 * `/transactions/$transactionId` loads with `useQuery` rather than a loader and renders its own
 * translated notice, so it never sets a status either way and is out of scope for issue #16. It is
 * asserted at 200 here so that "unchanged" is a recorded decision rather than an accident, and so a
 * later change to that route has to come past this file.
 *
 * ## Why this spec owns its pages
 *
 * Almost every navigation here is meant to answer 404, and chromium writes a `console.error` —
 * "Failed to load resource: the server responded with a status of 404" — about the document it was
 * told to fetch. That is the browser reporting the very thing under test. Putting it in
 * `TOLERATED_CONSOLE_WARNINGS` would blind **every** spec to a failed request, which is far too
 * wide a hole for one file's benefit, and that table is explicitly reserved for stopwatch
 * advisories rather than for anything a page actually did. So this spec drives its own page, keeps
 * the same net (`watchConsole`) attached to it, and subtracts exactly that one sentence — every
 * other message, including a React warning or a second failed resource, still fails the run.
 */

/** The routes issue #16 owns, with an id that names no row in any workspace. */
const NOT_FOUND_ROUTES = [
  '/accounts/does-not-exist',
  '/budgets/does-not-exist',
  '/goals/does-not-exist',
  '/import/does-not-exist',
  '/payees/does-not-exist',
  '/recurring/does-not-exist',
  '/transactions/rules/does-not-exist',
] as const

/**
 * Chromium's own report that a document it fetched answered 404 — the outcome under test.
 *
 * Anchored and whole-sentence, the way `TOLERATED_CONSOLE_WARNINGS` anchors its entries: a message
 * that merely quotes this one is still fatal.
 */
const DOCUMENT_404 =
  /^console\.error: Failed to load resource: the server responded with a status of 404 \(Not Found\)$/

/**
 * A watched page in a context carrying this project's `use` options — storage state, locale,
 * viewport and the clock pin — which `browser.newContext()` does not inherit on its own.
 */
async function watchedPage(
  browser: Browser,
  contextOptions: BrowserContextOptions,
  prepare?: (
    context: Awaited<ReturnType<Browser['newContext']>>,
  ) => Promise<void>,
): Promise<{ page: Page; report: ConsoleReport; close: () => Promise<void> }> {
  const context = await browser.newContext(contextOptions)
  await prepare?.(context)
  const page = await context.newPage()
  return { page, report: watchConsole(page), close: () => context.close() }
}

/**
 * `page.goto` for a document whose status *is* the assertion.
 *
 * `waitUntil: 'commit'` because the default waits for `load`, and there is nothing to wait for
 * before the status is known. `waitForHydration` is called separately where the rendered surface
 * matters. The response is never null for a same-document navigation, which is all this file
 * performs.
 */
async function visit(page: Page, path: string): Promise<Response> {
  const response = await page.goto(path, { waitUntil: 'commit' })
  expect(response, `no response for ${path}`).not.toBeNull()
  return response as Response
}

/** Fails the test on anything the browser said other than "that document answered 404". */
function expectOnly404Noise(report: ConsoleReport): void {
  expect(
    report.fatal.filter((entry) => !DOCUMENT_404.test(entry)),
    'the not-found surface must be silent apart from the 404 this spec asked for',
  ).toEqual([])
}

test.describe('a missing row answers 404', () => {
  test.use({ storageState: storageStateFor('demo') })

  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'A status code is decided by the Worker. Three engines would ask the same server the same ' +
      'questions and spend the run’s budget doing it.',
  )

  test('every detail route, and nothing of the repository’s own words', async ({
    browser,
    contextOptions,
  }) => {
    const { page, report, close } = await watchedPage(browser, contextOptions)

    for (const path of NOT_FOUND_ROUTES) {
      const response = await visit(page, path)
      expect(response.status(), `${path} should answer 404`).toBe(404)

      await waitForHydration(page)
      await expect(
        page.getByRole('heading', { name: 'Not here' }),
        `${path} should render the translated not-found surface`,
      ).toBeVisible()

      // The repository's messages are developer-facing and permanently English — `repos/errors.ts`
      // says so in its own header. None may reach the reader, and the id is the half of the
      // sentence that would survive a rewording of the other half.
      await expect(page.locator('body')).not.toContainText('was not found')
      await expect(page.locator('body')).not.toContainText('does-not-exist')
      // A 403 would confirm the row exists in *some* workspace. Not-found must not drift into it.
      await expect(page.locator('body')).not.toContainText(
        /forbidden|not allowed|permission/i,
      )
    }

    expectOnly404Noise(report)
    await close()
  })

  test('an address the router cannot match at all still answers 404', async ({
    browser,
    contextOptions,
  }) => {
    const { page, report, close } = await watchedPage(browser, contextOptions)

    // The control: this row was already correct before issue #16, and it is what proves the seven
    // above now reach the same machinery rather than a second one built beside it.
    const response = await visit(page, '/zzz/qqq')
    expect(response.status()).toBe(404)
    await waitForHydration(page)

    expectOnly404Noise(report)
    await close()
  })

  test('a transaction id keeps its 200 and its own notice', async ({
    browser,
    contextOptions,
  }) => {
    const { page, report, close } = await watchedPage(browser, contextOptions)

    // Out of scope for issue #16 by decision, not by omission: this screen fetches with `useQuery`,
    // so there is no loader to classify and no status to set.
    const response = await visit(page, '/transactions/does-not-exist')
    expect(response.status()).toBe(200)

    await waitForHydration(page)
    await expect(
      page.getByRole('heading', { name: 'That transaction is not here' }),
    ).toBeVisible()

    // Nothing was refused at the document level here, so not even the 404 sentence is allowed.
    expect(report.fatal).toEqual([])
    await close()
  })

  test('a Polish reader is told nothing in English', async ({
    browser,
    contextOptions,
  }) => {
    const { page, report, close } = await watchedPage(
      browser,
      contextOptions,
      (context) => useLocale(context, 'pl'),
    )

    const response = await visit(page, '/budgets/does-not-exist')
    expect(response.status()).toBe(404)

    await waitForHydration(page)
    await expect(
      page.getByRole('heading', { name: 'Nie ma tu nic' }),
    ).toBeVisible()

    // The exact sentence issue #16 photographed on this screen, in this locale.
    await expect(page.locator('body')).not.toContainText(
      'budget does-not-exist was not found.',
    )
    await expect(page.locator('body')).not.toContainText('was not found')
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl')

    expectOnly404Noise(report)
    await close()
  })
})
