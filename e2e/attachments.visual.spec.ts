import { expect, test } from './support/console'

import { openTransactionDetailPanel, useLocale, useTheme } from './support/app'
import { expectNoSeriousViolations } from './support/budgets'
import { storageStateFor } from './support/session'

import type { AppLocale, AppTheme } from './support/app'
import type { Page } from '@playwright/test'

/**
 * The receipts panel in the browser: the axe gate `11-S3` sets, the non-drag path, and the one
 * refusal that cannot be tested anywhere but end to end.
 *
 * ## The gate
 *
 * Zero `serious`, zero `critical` on the transaction detail route with the panel present, in both
 * themes and both locales — the same pair of axes `accessibility.spec.ts` argues for at length, for
 * the same two reasons: a dark theme is a different set of colour tokens so contrast is a different
 * question in each, and a locale changes `<html lang>`, the length of every label and the accessible
 * name of every control.
 *
 * `expectNoSeriousViolations` is imported from `support/budgets` rather than copied, for the reason
 * `splits.visual.spec.ts` gives: the file is named for the plan that first needed it, and a second
 * copy would be a second place for the tag list to be widened by whoever is in a hurry.
 *
 * ## The demo workspace is read and never written
 *
 * Nothing here uploads a file that could succeed. The rejection test posts a **renamed
 * executable** — bytes that `src/server/files/upload.ts` refuses by their signature — so the round
 * trip is real, the refusal is the server's, and `scripts/seed/verify.mjs` still finds every
 * counter it asserts after a run. There is deliberately no happy-path upload here: it would leave
 * an R2 object and a row behind in a fixture every other suite reads.
 *
 * ## This spec is red until the panel is mounted
 *
 * `attachment-list.tsx` and `attachment-dropzone.tsx` are self-contained; the transaction detail
 * screen hosts them, and that integration is a separate change (three stages want
 * `$transactionId.tsx` this wave). Until it lands, {@link openReceipts} fails with the sentence
 * naming what is missing — which is the correct failure for a gate, and the one that turns green
 * the moment the panel is in place.
 */

test.use({ storageState: storageStateFor('demo') })

const THEMES: readonly AppTheme[] = ['light', 'dark']
const LOCALES: readonly AppLocale[] = ['en', 'pl']

/**
 * The panel's own labels, per locale.
 *
 * Quoted rather than imported, for the `import.meta.glob` reason `support/app.ts` sets out: the
 * catalogue loader is a Vite primitive that does not exist in Playwright's module runner, and
 * importing it takes the whole suite down at collection time.
 */
interface ReceiptLabels {
  /** `attachments.title` — the panel's accessible name, so also its region label. */
  readonly panel: string
  /** `attachments.attach` — the real button that makes this not drag-only. */
  readonly attach: string
  /** `attachments.dropzone.label` — the drop target's accessible name. */
  readonly dropzone: string
  /** A fragment of `attachments.error.file` that survives whatever reason is in it. */
  readonly rejectionFragment: RegExp
}

const LABELS: Readonly<Record<AppLocale, ReceiptLabels>> = {
  en: {
    panel: 'Receipts',
    attach: 'Attach a receipt',
    dropzone: 'Drop receipts here to attach them',
    rejectionFragment: /was not attached/i,
  },
  pl: {
    panel: 'Paragony',
    attach: 'Załącz paragon',
    dropzone: 'Upuść tutaj paragony, aby je załączyć',
    rejectionFragment: /nie załączono/i,
  },
}

/**
 * A Linux executable, renamed and declared as a PNG.
 *
 * `\x7FELF` is the whole point: the extension says PNG, the multipart `Content-Type` says PNG, and
 * the first four bytes say otherwise. Only the server's magic-byte sniff can tell, which is why
 * this case lives in a browser test rather than beside the unit tests for the sniffer.
 */
const RENAMED_EXECUTABLE = Buffer.from([
  0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
])

/**
 * Opens the first transaction in the ledger and returns its receipts panel.
 *
 * The navigation, the wait for the screen to finish loading and the failure message all live in
 * `support/app.ts`; see the note on the same helper in `refunds.visual.spec.ts`.
 */
async function openReceipts(page: Page, labels: ReceiptLabels) {
  return openTransactionDetailPanel(page, labels.panel)
}

for (const theme of THEMES) {
  for (const locale of LOCALES) {
    test(`the receipts panel has no serious or critical violations — ${theme}, ${locale}`, async ({
      page,
      context,
    }) => {
      await useLocale(context, locale)
      await useTheme(page, theme)

      const panel = await openReceipts(page, LABELS[locale])
      await expect(
        panel.getByRole('button', { name: LABELS[locale].attach }),
      ).toBeVisible()

      await expectNoSeriousViolations(
        page,
        `/transactions/$id with the receipts panel (${theme}, ${locale})`,
      )
    })
  }
}

test('attaching is a button, not a drag gesture', async ({ page }) => {
  const labels = LABELS.en
  const panel = await openReceipts(page, labels)

  // §2 clause 7: a non-drag path beside every drag-and-drop affordance. `FileTrigger` renders a
  // real button, so it is reachable from the keyboard by construction rather than by a second
  // implementation somebody has to remember to write.
  const attach = panel.getByRole('button', { name: labels.attach })
  await attach.focus()
  await expect(attach).toBeFocused()

  // The drop target is an enhancement over it, and it has its own accessible name rather than
  // being a decorated `<div>`.
  //
  // That name is deliberately not on anything painted. React Aria exposes a drop target to
  // assistive technology through a proxy `<button>` measured at 0x0 inside a 1x1 wrapper, while
  // the region a reader sees - 228x155 here - is a bare `div[data-rac]` carrying this file's
  // classes and no role of its own. So `toBeVisible()` on the named node asserted something the
  // library can never satisfy, and this test failed on all three projects from the commit that
  // introduced it. What matters for clause 7 is not that the name is painted but that a keyboard
  // reader can reach the thing it names.
  const dropTarget = panel.getByLabel(labels.dropzone)
  await expect(dropTarget).toBeAttached()
  // `tabindex="0"` is the half that makes "reachable" true rather than merely "focusable":
  // `focus()` succeeds on anything with a tabindex at all, including `-1`, which is a node no
  // amount of tabbing ever arrives at.
  await expect(dropTarget).toHaveAttribute('tabindex', '0')
  await dropTarget.focus()
  await expect(dropTarget).toBeFocused()
})

test('a renamed executable is refused, and the reason names that file', async ({
  page,
  expectConsole,
}) => {
  // The refusal is a validation failure, and the failure boundary answers one with its own status
  // (`422`) rather than `200`, so the browser reports the response once, as it does for any
  // non-2xx. The message is the test's own doing, and the pattern is anchored to that status.
  expectConsole([
    {
      why: 'the browser reporting the 422 the server answers a refused upload with, which is the behaviour under test',
      match:
        /^Failed to load resource: the server responded with a status of 422 \(Unprocessable Entity\)$/,
    },
  ])
  const labels = LABELS.en
  const panel = await openReceipts(page, labels)

  await panel.locator('input[type="file"]').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: RENAMED_EXECUTABLE,
  })

  // Per file, inline, naming the file — never a single banner for a batch. The row survives after
  // the request settles, so somebody can read why one of several did not land.
  const failure = panel.getByRole('alert')
  await expect(failure).toBeVisible()
  await expect(failure).toHaveText(labels.rejectionFragment)
  await expect(failure).toContainText('receipt.png')

  // And nothing was stored: the list is still whatever it was, with no link to the refused file.
  await expect(panel.getByRole('link', { name: /receipt\.png/ })).toHaveCount(0)
})
