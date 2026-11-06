/**
 * Render every React Email message to a gitignored scratch dir.
 *
 * ```
 * pnpm email:preview
 * ```
 *
 * Writes HTML and text for each fixture × en/pl, plus an index that links them.
 * Catalogues are imported statically: this script runs under `tsx`, which has
 * no Vite `import.meta.glob` (the runtime `loadCatalogue` path). Templates
 * import `directionOf` from `#/lib/i18n/locales` for the same reason — the
 * `#/lib/i18n` barrel evaluates the glob at load.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveMessage } from '#/lib/i18n/interpolate'
import { directionOf, LOCALE_TAGS } from '#/lib/i18n/locales'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'
import { renderEmail } from '#/server/email/render'
import { EMAIL_PREVIEW_FIXTURES } from '#/server/email/templates/preview-fixtures'

import type {
  Catalogue,
  Locale,
  MessageKey,
  MessageParams,
  Translate,
  TranslateArgs,
} from '#/lib/i18n'

const OUT_DIR = '.ai/qa/artifacts_email-preview'
const CATALOGUES: Record<Locale, Catalogue> = {
  en,
  pl,
}

function translatorFor(locale: Locale, catalogue: Catalogue): Translate {
  return <TKey extends MessageKey>(
    key: TKey,
    ...args: TranslateArgs<TKey>
  ): string => {
    const first: unknown = args[0]
    const params =
      typeof first === 'object' && first !== null
        ? (first as MessageParams)
        : undefined
    const message = Object.hasOwn(catalogue, key) ? catalogue[key] : undefined
    return message === undefined ? key : resolveMessage(message, locale, params)
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url))
  const root = join(here, '../..')
  const out = join(root, OUT_DIR)
  await mkdir(out, { recursive: true })

  const rows: Array<{
    name: string
    locale: Locale
    subject: string
    htmlFile: string
    textFile: string
  }> = []

  for (const fixture of EMAIL_PREVIEW_FIXTURES) {
    for (const locale of LOCALE_TAGS) {
      const t = translatorFor(locale, CATALOGUES[locale])
      const { subject, element } = fixture.build(t, locale)
      const { html, text } = await renderEmail(element)
      const stem = `${fixture.name}.${locale}`
      const htmlFile = `${stem}.html`
      const textFile = `${stem}.txt`
      await writeFile(join(out, htmlFile), html, 'utf8')
      await writeFile(join(out, textFile), text, 'utf8')
      rows.push({ name: fixture.name, locale, subject, htmlFile, textFile })
    }
  }

  const index = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Email preview</title>
    <style>
      body { font-family: 'Courier New', Courier, monospace; margin: 24px; }
      table { border-collapse: collapse; }
      th, td { border: 1px solid #c3d1c4; padding: 8px 12px; text-align: left; }
    </style>
  </head>
  <body dir="${directionOf('en')}">
    <h1>Email preview</h1>
    <p>Synthetic fixtures only. No amounts, no transaction data.</p>
    <table>
      <thead>
        <tr>
          <th>Message</th>
          <th>Locale</th>
          <th>Subject</th>
          <th>HTML</th>
          <th>Text</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.locale)}</td>
          <td>${escapeHtml(row.subject)}</td>
          <td><a href="${escapeHtml(row.htmlFile)}">${escapeHtml(row.htmlFile)}</a></td>
          <td><a href="${escapeHtml(row.textFile)}">${escapeHtml(row.textFile)}</a></td>
        </tr>`,
          )
          .join('\n        ')}
      </tbody>
    </table>
  </body>
</html>
`

  await writeFile(join(out, 'index.html'), index, 'utf8')
  process.stdout.write(
    `Wrote ${String(rows.length * 2 + 1)} files to ${OUT_DIR}\n`,
  )
}

await main()
