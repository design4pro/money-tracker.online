import { useId } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { Card } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { listAccounts } from '#/server/fns/accounts'
import { listImports } from '#/server/fns/imports'
import { pageHead } from '#/routes/-lib/page-title'

import { loadImportSources } from './-server/sources'
import { ImportHistory } from './-ui/import-history'
import { Notice } from './-ui/notice'
import { UploadCard } from './-ui/upload-card'

import type { ImportProvenance, ImportSourceOption } from './-server/sources'

/**
 * `/import` — the way in, organised by **where the data came from**.
 *
 * ## Provenance, not file format
 *
 * A person has a statement from their bank, or an export from the tracker they are leaving. They do
 * not have "an OFX". A format is a property of the file that the pipeline works out for itself, so
 * the two groups below are the two answers to *where did this come from*, and the acronym never
 * appears as a question. Sorting by format would also put the weakest-signal case — a bare CSV out
 * of a spreadsheet, which is most of them — at the bottom of a list of initialisms.
 *
 * ## The history is a peer, not a page inside a batch
 *
 * Somebody who imported the wrong month is looking for the *list*. It sits here, beside the ways
 * in, rather than behind one of them.
 *
 * ## Nothing here knows which formats exist
 *
 * `-server/sources.ts` reads the parser registry and answers with the formats this build can
 * actually read and the file endings each arrives with. A format landing in a later stage is a new
 * directory under `src/server/import/`; it appears in the right group, and in the upload control's
 * accepted types, without this file being touched.
 */

export const Route = createFileRoute('/_app/import/')({
  loader: async () => {
    const [catalogue, accounts, history] = await Promise.all([
      loadImportSources(),
      // Archived accounts are included: a statement covering last spring may well belong to an
      // account that has since been closed, and refusing to import into it loses the history.
      listAccounts({ data: {} }),
      listImports({ data: {} }),
    ])
    return { catalogue, accounts, history }
  },
  head: ({ matches }) => pageHead(matches, (t) => t('import.title')),
  component: ImportIndexRoute,
})

function ImportIndexRoute() {
  const t = useTranslate()
  const { catalogue, accounts, history } = Route.useLoaderData()

  const fileHeadingId = useId()
  const migrationHeadingId = useId()
  const historyHeadingId = useId()

  const options = (provenance: ImportProvenance): Array<ImportSourceOption> =>
    catalogue.sources.filter((source) => source.provenance === provenance)

  const pickers = accounts.accounts.map((account) => ({
    id: account.id,
    name: account.name,
  }))

  const group = (
    headingId: string,
    title: string,
    body: string,
    provenance: ImportProvenance,
  ) => {
    const sources = options(provenance)
    return (
      <section aria-labelledby={headingId} className="flex">
        <Card className="flex w-full flex-col gap-4">
          <div className="space-y-1">
            <h2 id={headingId} className="text-subtitle font-semibold text-ink">
              {title}
            </h2>
            <p className="text-caption text-ink-2">{body}</p>
          </div>

          {sources.length === 0 ? (
            <Notice tone="info">{t('import.group.empty')}</Notice>
          ) : pickers.length === 0 ? (
            <Notice tone="warning">{t('import.upload.noAccounts')}</Notice>
          ) : (
            <UploadCard
              accounts={pickers}
              options={sources}
              maxBytes={catalogue.maxBytes}
            />
          )}
        </Card>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-title font-semibold text-ink">
          {t('import.title')}
        </h1>
        <p className="max-w-prose text-body text-ink-2">{t('import.lead')}</p>
      </header>

      <div className="grid items-stretch gap-5 lg:grid-cols-2">
        {group(
          fileHeadingId,
          t('import.group.file.title'),
          t('import.group.file.body'),
          'file',
        )}
        {group(
          migrationHeadingId,
          t('import.group.migration.title'),
          t('import.group.migration.body'),
          'migration',
        )}
      </div>

      <section
        aria-labelledby={historyHeadingId}
        className="flex flex-col gap-3"
      >
        <div className="space-y-1">
          <h2
            id={historyHeadingId}
            className="text-subtitle font-semibold text-ink"
          >
            {t('import.history.title')}
          </h2>
          <p className="text-caption text-ink-2">{t('import.history.body')}</p>
        </div>
        <ImportHistory batches={history.items} />
      </section>
    </div>
  )
}
