import { test as base, expect } from '@playwright/test'

import {
  classifyConsoleMessage,
  describeConsoleFailure,
} from './console-policy'

import type { ConsoleReport, ExpectedConsoleMessage } from './console-policy'
import type { Page, TestInfo } from '@playwright/test'

/**
 * The console net: `docs/SPEC.md` §2.10 as something that can go red.
 *
 * ## Why a fixture and not a helper each spec calls
 *
 * A net that has to be remembered is a net with holes in it, and the holes are invisible — a spec
 * that forgot the call is green, and reads exactly like a spec that was clean. `auto: true` means
 * every test that imports `test` from this module is watched whether its author thought about the
 * console or not, and the one place the rule lives is here (`docs/SPEC.md` §8: one concept, one
 * owner).
 *
 * The cost of that choice is the import line: specs take `test` and `expect` from here rather than
 * from `@playwright/test`, and `expect` is re-exported so a spec never needs both. A spec importing
 * `test` straight from Playwright is unwatched, which is the one thing to look for in review.
 *
 * ## What it watches, and what it cannot
 *
 * It attaches to the `page` fixture, so it covers the page Playwright hands the test. A spec that
 * opens a **second** page or its own context — `tenant-isolation.spec.ts` and
 * `accessibility.spec.ts` both do — is on its own for that page; `watchConsole()` below is exported
 * for exactly that case. Widening the fixture to every page of every context would mean owning
 * context creation too, which is a larger seam than this buys.
 *
 * ## Why it does not pile onto a failure
 *
 * When the test body has already failed, the console output is attached to the report and nothing
 * is thrown. A teardown that throws replaces the real failure with a downstream one, and the real
 * failure is the one worth reading — a page that 500s writes to the console *because* it 500'd.
 */

/**
 * Attaches the listeners and returns the report, which fills as the test runs.
 *
 * `expected` is read at classification time rather than copied, so a caller may keep pushing to it
 * after the listeners are attached — which is what lets a test declare its expectations in the
 * test body, next to the interception that causes them, instead of before the page exists.
 */
export function watchConsole(
  page: Page,
  expected: readonly ExpectedConsoleMessage[] = [],
): ConsoleReport {
  const fatal: string[] = []
  const tolerated: string[] = []

  page.on('console', (message) => {
    const text = message.text()
    const verdict = classifyConsoleMessage(
      { type: message.type(), text },
      expected,
    )
    if (verdict === 'fatal') fatal.push(`console.${message.type()}: ${text}`)
    else if (verdict === 'tolerated') tolerated.push(text)
  })

  // An uncaught exception never reaches `page.on('console')` in every engine, and it is the most
  // serious thing this net can catch, so it is listened for separately and is always fatal.
  page.on('pageerror', (error) => {
    fatal.push(`pageerror: ${error.message}`)
  })

  return {
    get fatal() {
      return fatal
    },
    get tolerated() {
      return tolerated
    },
  }
}

/**
 * Fails the test on a fatal console entry, or attaches the report when it has already failed.
 *
 * Exported for the second-page case, where the caller owns the lifetime of the page.
 */
export async function assertConsoleClean(
  report: ConsoleReport,
  testInfo: TestInfo,
): Promise<void> {
  const failure = describeConsoleFailure(report)
  if (failure === undefined) return

  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('console', {
      body: failure,
      contentType: 'text/plain',
    })
    return
  }
  throw new Error(failure)
}

/**
 * `test`, with the console watched for the whole of every test body.
 *
 * Import this instead of `@playwright/test` in every spec. `expect` is re-exported unchanged.
 *
 * ## Declaring output a test causes on purpose
 *
 * The fixture is still `auto: true`, so a spec is watched whether or not its author thought about
 * the console. A spec that deliberately makes the server fail takes the fixture by name and says
 * so, beside the interception that causes it:
 *
 * ```ts
 * test('the accounts list offers a retry when the read breaks', async ({ page, expectConsole }) => {
 *   expectConsole(DELIBERATE_SERVER_FAILURE)
 *   const failure = await failServerFns(page)
 *   try {
 *     // …
 *   } finally {
 *     await failure.release()
 *   }
 * })
 * ```
 *
 * The declaration lasts for that test only. It is deliberately not a second tolerance table: see
 * the note on {@link ExpectedConsoleMessage}.
 */
export const test = base.extend<{
  expectConsole: (expected: readonly ExpectedConsoleMessage[]) => void
}>({
  expectConsole: [
    async ({ page }, use, testInfo) => {
      const expected: ExpectedConsoleMessage[] = []
      const report = watchConsole(page, expected)
      await use((more) => {
        expected.push(...more)
      })
      await assertConsoleClean(report, testInfo)
    },
    { auto: true },
  ],
})

export { expect }
export {
  DELIBERATE_SERVER_FAILURE,
  TOLERATED_CONSOLE_WARNINGS,
} from './console-policy'
export type {
  ConsoleReport,
  ConsoleVerdict,
  ExpectedConsoleMessage,
} from './console-policy'
