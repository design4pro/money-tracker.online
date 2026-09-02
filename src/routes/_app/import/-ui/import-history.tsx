import { Link } from '@tanstack/react-router'

import {
  Badge,
  Cell,
  Column,
  EmptyState,
  Row,
  Table,
  TableBody,
  TableContainer,
  TableHeader,
} from '#/components/ui'
import { formatCalendarDate, useLocale, useTranslate } from '#/lib/i18n'

import { importLinkClass } from '../-lib/link-style'

import type { MessageKey } from '#/lib/i18n'
import type { BadgeProps } from '#/components/ui'
import type { ImportBatchRow, ImportStatus } from '#/server/db/schema'

/**
 * Every file this workspace has brought in — a peer of the two upload groups, not a page inside a
 * batch.
 *
 * A person who imported the wrong month wants the *list*, and a history reachable only by first
 * opening a batch is a history nobody finds. So it sits on `/import` beside the two ways in.
 *
 * ## The status is a word before it is a colour
 *
 * `Badge` carries its text at every tone, and the tone here only reinforces what the word already
 * says. A reader who cannot separate the amber wash from the sheet still reads "Failed".
 */

/** The tone each status wears. Exhaustive over `IMPORT_STATUSES`, so a new one cannot be silent. */
const STATUS_TONE: Readonly<Record<ImportStatus, BadgeProps['tone']>> = {
  queued: 'neutral',
  parsing: 'info',
  mapping: 'warning',
  previewing: 'info',
  running: 'info',
  completed: 'positive',
  failed: 'negative',
  reverted: 'neutral',
}

/** `imports/<org>/<batch>/statement.csv` → `statement.csv`. */
function fileNameOf(batch: ImportBatchRow): string {
  const key = batch.fileR2Key
  if (key === null) return batch.id
  return key.slice(key.lastIndexOf('/') + 1)
}

export interface ImportHistoryProps {
  readonly batches: ReadonlyArray<ImportBatchRow>
}

export function ImportHistory({ batches }: ImportHistoryProps) {
  const t = useTranslate()
  const locale = useLocale()

  if (batches.length === 0) {
    return (
      <EmptyState
        title={t('import.history.empty.title')}
        description={t('import.history.empty.body')}
      />
    )
  }

  return (
    <TableContainer>
      <Table aria-label={t('import.history.table')}>
        <TableHeader>
          <Column isRowHeader>{t('import.history.column.file')}</Column>
          <Column>{t('import.history.column.status')}</Column>
          <Column align="end">{t('import.history.column.rows')}</Column>
          <Column>{t('import.history.column.created')}</Column>
        </TableHeader>
        <TableBody>
          {batches.map((batch) => {
            const name = fileNameOf(batch)
            return (
              <Row key={batch.id} id={batch.id}>
                <Cell>
                  <Link
                    className={importLinkClass}
                    to="/import/$batchId"
                    params={{ batchId: batch.id }}
                    search={{ step: 'upload' }}
                    aria-label={t('import.history.open', { name })}
                  >
                    {name}
                  </Link>
                  <span className="block text-caption text-ink-2">
                    {t(`import.source.${batch.source}` as MessageKey)}
                  </span>
                </Cell>
                <Cell>
                  <Badge tone={STATUS_TONE[batch.status as ImportStatus]}>
                    {t(`import.status.${batch.status}` as MessageKey)}
                  </Badge>
                </Cell>
                <Cell align="end" numeric>
                  {t('import.history.rows', {
                    imported: batch.importedCount,
                    total: batch.rowCount,
                  })}
                </Cell>
                <Cell numeric>
                  {formatCalendarDate(
                    locale,
                    batch.createdAt.toISOString().slice(0, 10),
                  )}
                </Cell>
              </Row>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
