import { useId } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Spinner } from '#/components/ui'
import { formatNumber, useLocale, useTranslate } from '#/lib/i18n'
import { getImport } from '#/server/fns/imports'

import { describeImportBatch } from './-server/describe-batch'
import {
  IMPORT_STEPS,
  importStepSearchSchema,
  nextStep,
  previousStep,
  recallParsedFile,
  toFileView,
} from './-lib/flow'
import { importLinkClass } from './-lib/link-style'
import { MappingStep } from './-ui/mapping-step'
import { Notice } from './-ui/notice'
import { PreviewStep } from './-ui/preview-step'

import type { MessageKey } from '#/lib/i18n'
import { pageHead } from '#/routes/-lib/page-title'
import type { ImportStep } from './-lib/flow'

/**
 * `/import/$batchId` — one file, walked through four named steps.
 *
 * ## All four are shown from the first screen
 *
 * Upload, map, review, import. A person knows how long the flow is before they are inside it, and
 * the fourth is `19-S3`'s commit rendered **in this same stepper** rather than on a surface of its
 * own — the seam is left open here and the step already says what it will do.
 *
 * ## Back and forward are links
 *
 * `?step=` carries the position, so the browser's back button walks the flow, a step is a thing
 * that can be linked to, and nothing here is a button pretending to be navigation. A step that is
 * not reachable yet is not a link at all rather than a link that would land on an error.
 *
 * ## Nothing is timed
 *
 * No step expires, no request is cancelled by a clock, and the preview may be left open (2.2.6).
 *
 * ## A reload keeps the flow
 *
 * The header row and the sample values arrive with the upload, and the tab holds them: the ordinary
 * walk costs no second round trip. A reload, or a link opened elsewhere, finds that map empty and
 * `describeImportBatch` re-reads the stored file instead — see `-lib/flow.ts` and
 * `-server/describe-batch.ts`. Only a file that cannot be read back at all ends the flow here, and
 * it says so rather than drawing an empty mapping table.
 */

export const Route = createFileRoute('/_app/import/$batchId')({
  validateSearch: importStepSearchSchema,
  loader: ({ params }) => getImport({ data: { id: params.batchId } }),
  head: ({ matches }) => pageHead(matches, (t) => t('import.title')),
  component: ImportBatchRoute,
})

const STEP_LABEL: Readonly<Record<ImportStep, MessageKey>> = {
  upload: 'import.step.upload',
  map: 'import.step.map',
  review: 'import.step.review',
  done: 'import.step.done',
}

function ImportBatchRoute() {
  const t = useTranslate()
  const locale = useLocale()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const { batchId } = Route.useParams()
  const search = Route.useSearch()
  const batch = Route.useLoaderData()
  const headingId = useId()

  const step: ImportStep = search.step ?? 'upload'

  /**
   * The file, from the tab if the upload happened here and from the server otherwise.
   *
   * The query is disabled while the tab still holds the upload's answer, so the ordinary walk from
   * `/import` costs no round trip; a reload or a second tab finds the map empty and pays for one
   * re-read. `staleTime: Infinity` because the bytes behind a batch never change — an import is one
   * file, stored once.
   */
  const remembered = recallParsedFile(batchId)
  const described = useQuery({
    queryKey: ['import', 'describe', batchId],
    queryFn: () => describeImportBatch({ data: { id: batchId } }),
    enabled: remembered === undefined,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const source = remembered ?? described.data
  const file = source === undefined ? undefined : toFileView(source)

  /**
   * Which steps may be entered.
   *
   * The mapping needs the file's columns, and the review needs a confirmed mapping. Both are facts
   * rather than opinions, which is why they are read off the batch and the file rather than tracked
   * as a wizard's own progress counter. While the re-read is still in flight the mapping step is
   * held closed rather than opened onto an empty table.
   */
  const reachable: Readonly<Record<ImportStep, boolean>> = {
    upload: true,
    map: file !== undefined,
    review: batch.mapping !== null,
    done: batch.mapping !== null,
  }

  const goTo = (target: ImportStep) =>
    void navigate({ search: { step: target } })

  const fileName =
    batch.fileR2Key === null
      ? batch.id
      : batch.fileR2Key.slice(batch.fileR2Key.lastIndexOf('/') + 1)

  const back = previousStep(step)
  const forward = nextStep(step)

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-title font-semibold text-ink">
          {t('import.title')}
        </h1>
        <p className="text-caption text-ink-2">{fileName}</p>
      </header>

      <nav aria-label={t('import.stepper.label')}>
        <ol className="flex flex-wrap gap-x-4 gap-y-2">
          {IMPORT_STEPS.map((entry, index) => {
            const label = `${formatNumber(locale, index + 1)}. ${t(
              STEP_LABEL[entry],
            )}`
            const isCurrent = entry === step

            return (
              <li key={entry} className="text-label">
                {isCurrent ? (
                  <span
                    aria-current="step"
                    className="font-semibold text-ink underline decoration-accent decoration-2 underline-offset-4"
                  >
                    {label}
                  </span>
                ) : reachable[entry] ? (
                  <Link
                    className={importLinkClass}
                    to="/import/$batchId"
                    params={{ batchId }}
                    search={{ step: entry }}
                  >
                    {label}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    title={t('import.step.locked')}
                    className="text-ink-2"
                  >
                    {label}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/*
        The step is announced on entry. `role="status"` is a polite live region: it says where the
        reader has arrived without interrupting whatever is being read, and it is the only way a
        screen-reader user learns that a client-side navigation moved them at all.
      */}
      <p role="status" className="sr-only">
        {t('import.step.position', {
          position: formatNumber(locale, IMPORT_STEPS.indexOf(step) + 1),
          total: formatNumber(locale, IMPORT_STEPS.length),
          name: t(STEP_LABEL[step]),
        })}
      </p>

      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <h2 id={headingId} className="text-subtitle font-semibold text-ink">
          {t(STEP_LABEL[step])}
        </h2>

        {step === 'upload' ? (
          <div className="flex flex-col gap-3">
            {file === undefined ? (
              <FileUnavailable isPending={described.isPending} />
            ) : (
              <>
                <p className="text-body text-ink">
                  {t('import.file.rows', {
                    rows: formatNumber(locale, file.rowCount),
                    name: fileName,
                  })}
                </p>
                {file.truncated ? (
                  <Notice tone="warning">
                    {t('import.file.truncated', {
                      rows: formatNumber(locale, file.rowCount),
                    })}
                  </Notice>
                ) : null}
                {file.warnings.length === 0 ? null : (
                  <Notice tone="warning" title={t('import.warnings.title')}>
                    <ul className="list-disc ps-4">
                      {[
                        ...new Set(
                          file.warnings.map((warning) => warning.code),
                        ),
                      ].map((code) => (
                        <li key={code}>
                          {t(`import.warning.${code}` as MessageKey)}
                        </li>
                      ))}
                    </ul>
                  </Notice>
                )}
              </>
            )}
          </div>
        ) : null}

        {step === 'map' ? (
          file === undefined ? (
            <FileUnavailable isPending={described.isPending} />
          ) : (
            <MappingStep
              batchId={batchId}
              accountId={file.accountId}
              headers={file.headers}
              sampleRows={file.sampleRows}
              onConfirmed={() => {
                // The batch row on screen now has a mapping, which is what makes the review
                // reachable — so the loader is re-run before the step changes.
                void router.invalidate().then(() => goTo('review'))
              }}
            />
          )
        ) : null}

        {step === 'review' ? (
          batch.mapping === null ? (
            <Notice tone="info">{t('import.step.locked')}</Notice>
          ) : (
            <PreviewStep
              batchId={batchId}
              onRemap={() => goTo('map')}
              onStartOver={() => void navigate({ to: '/import' })}
            />
          )
        ) : null}

        {step === 'done' ? (
          <Notice tone="info" title={t('import.done.title')}>
            {t('import.done.body')}
          </Notice>
        ) : null}
      </section>

      <nav
        aria-label={t('import.stepper.label')}
        className="flex flex-wrap items-center gap-4"
      >
        {back === null || !reachable[back] ? null : (
          <Link
            className={importLinkClass}
            to="/import/$batchId"
            params={{ batchId }}
            search={{ step: back }}
          >
            {t('import.step.back', { name: t(STEP_LABEL[back]) })}
          </Link>
        )}
        {forward === null || !reachable[forward] ? null : (
          <Link
            className={importLinkClass}
            to="/import/$batchId"
            params={{ batchId }}
            search={{ step: forward }}
          >
            {t('import.step.next', { name: t(STEP_LABEL[forward]) })}
          </Link>
        )}
      </nav>
    </div>
  )
}

/**
 * The re-read, while it runs and if it fails.
 *
 * Two states rather than two components because they are one story told twice: the tab does not
 * have the file's columns, so the server is being asked for them. Failure is a dead end with a way
 * out — nothing was written, the batch is still in the history, and uploading the file again is the
 * whole recovery.
 */
function FileUnavailable({ isPending }: { readonly isPending: boolean }) {
  const t = useTranslate()

  if (isPending) {
    return (
      // The words beside the ring are the announcement, so the spinner does not make a second one.
      <p role="status" className="flex items-center gap-2 text-body text-ink-2">
        <Spinner label={null} />
        {t('import.resume.pending')}
      </p>
    )
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Notice tone="warning" title={t('import.resume.title')}>
        {t('import.resume.body')}
      </Notice>
      <Link className={importLinkClass} to="/import">
        {t('import.resume.action')}
      </Link>
    </div>
  )
}
