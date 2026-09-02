import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, TriangleAlert } from 'lucide-react'

import { amountReading } from '#/components/app/money'
import {
  Badge,
  Button,
  Cell,
  Column,
  Row,
  Select,
  SelectItem,
  Spinner,
  Table,
  TableBody,
  TableContainer,
  TableHeader,
} from '#/components/ui'
import {
  formatCalendarDate,
  formatNumber,
  useLocale,
  useTranslate,
} from '#/lib/i18n'
import { asCurrencyCode, formatSignedMoney, makeMoney } from '#/lib/money'
import {
  previewImportBatch,
  signedAmountMinor,
} from '#/server/fns/import-mapping'

import { Notice } from './notice'

import type { MessageKey } from '#/lib/i18n'
import type { ImportRowDecision } from '#/server/import/dedupe'
import type {
  ImportPreviewError,
  ImportPreviewRow,
} from '#/server/fns/import-mapping'

/**
 * What the file would do, row by row, before anything is written.
 *
 * ## The numbers on this screen are the numbers that would be stored
 *
 * `previewImportBatch` re-reads the batch's object and re-parses it with the confirmed mapping, and
 * the commit runs the same parse over the same bytes. Every figure here is an integer count of
 * minor units in the account's own currency, formatted through `#/lib/money` at that currency's
 * `digits`; nothing on this screen divides, rounds or re-derives an amount.
 *
 * ## A flagged row is distinguishable without colour
 *
 * A probable duplicate carries a word ("Possible duplicate"), a glyph and a rule down the start
 * edge of its row. The amber wash is the fourth channel, not the first: a reader who cannot see it
 * still meets three others.
 *
 * ## The dead end is designed
 *
 * A file where **every** row was refused is the most likely outcome of a column pointed at the
 * wrong field, so it gets its own screen with the first three reasons quoted from the file's own
 * text and two ways out — back to the mapping, or start over with another file. An empty table with
 * a zero above it would leave a person with nothing to act on.
 */

/** Which rows are on screen. A view of the same response, never a second request. */
type PreviewFilter = 'all' | 'create' | 'duplicate' | 'flagged'

const FILTER_LABEL: Readonly<Record<PreviewFilter, MessageKey>> = {
  all: 'import.preview.filter.all',
  create: 'import.preview.filter.create',
  duplicate: 'import.preview.filter.duplicate',
  flagged: 'import.preview.filter.flagged',
}

/** How many refusals the dead end quotes. Three: a pattern, not a log. */
const QUOTED_ERRORS = 3

export interface PreviewStepProps {
  readonly batchId: string
  /** Back to the mapping — the same address the stepper's back link points at. */
  readonly onRemap: () => void
  /** Away from this batch entirely, for a file that cannot be salvaged. */
  readonly onStartOver: () => void
}

export function PreviewStep({
  batchId,
  onRemap,
  onStartOver,
}: PreviewStepProps) {
  const t = useTranslate()
  const locale = useLocale()
  const summaryId = useId()

  const [filter, setFilter] = useState<PreviewFilter>('all')
  /** The person's own decisions, over the deduper's. Keyed by the file's row index. */
  const [decisions, setDecisions] = useState<
    ReadonlyMap<number, ImportRowDecision>
  >(new Map())

  /**
   * The preview runs once per visit and is not refetched behind the reader's back.
   *
   * It re-parses the file and replaces this batch's stored error report, so a refetch on window
   * focus would be a write nobody asked for while somebody was reading the result of the last one.
   */
  const preview = useQuery({
    queryKey: ['import', 'preview', batchId],
    queryFn: () => previewImportBatch({ data: { id: batchId } }),
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })

  if (preview.isPending) {
    return (
      <p className="flex items-center gap-2 text-body text-ink-2">
        <Spinner aria-hidden="true" />
        {t('import.preview.pending')}
      </p>
    )
  }

  if (preview.isError) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="problem" title={t('import.preview.failed.title')}>
          {t('import.preview.failed.body')}
        </Notice>
        <div className="flex gap-2">
          <Button onPress={() => void preview.refetch()}>
            {t('import.preview.retry')}
          </Button>
          <Button variant="ghost" onPress={onRemap}>
            {t('import.preview.allInvalid.remap')}
          </Button>
        </div>
      </div>
    )
  }

  const result = preview.data
  const currencyCode = asCurrencyCode(result.currencyCode)

  const decisionOf = (row: ImportPreviewRow): ImportRowDecision =>
    decisions.get(row.rowIndex) ?? row.decision

  // Not one row survived the mapping: the designed dead end rather than an empty table.
  if (result.rows.length === 0 && result.errors.length > 0) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="problem" title={t('import.preview.allInvalid.title')}>
          {t('import.preview.allInvalid.body', {
            count: result.errors.length,
          })}
        </Notice>
        <ul className="flex flex-col gap-3">
          {result.errors.slice(0, QUOTED_ERRORS).map((error) => (
            <QuotedError key={error.rowIndex} error={error} />
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onPress={onRemap}>
            {t('import.preview.allInvalid.remap')}
          </Button>
          <Button variant="secondary" onPress={onStartOver}>
            {t('import.preview.allInvalid.restart')}
          </Button>
        </div>
      </div>
    )
  }

  const visible = result.rows.filter((row) => {
    if (filter === 'all') return true
    if (filter === 'flagged') return row.flagged
    if (filter === 'create') return decisionOf(row) === 'create'
    return decisionOf(row) === 'skip_duplicate'
  })

  const figures: ReadonlyArray<{
    readonly key: MessageKey
    readonly value: string
  }> = [
    {
      key: 'import.preview.count.total',
      value: formatNumber(locale, result.summary.total),
    },
    {
      key: 'import.preview.count.toCreate',
      value: formatNumber(locale, result.summary.toCreate),
    },
    {
      key: 'import.preview.count.duplicates',
      value: formatNumber(locale, result.summary.duplicates),
    },
    {
      key: 'import.preview.count.invalid',
      value: formatNumber(locale, result.summary.invalid),
    },
    {
      key: 'import.preview.count.flagged',
      value: formatNumber(locale, result.summary.flagged),
    },
    {
      key: 'import.preview.count.amount',
      // A signed integer of minor units, formatted at the account currency's own digits. Signed,
      // because this is what the balance would move by and a net of expenses is a fall: a bare
      // magnitude here would read as money arriving.
      value: formatSignedMoney(
        locale,
        makeMoney(result.summary.createAmountMinor, currencyCode),
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-prose text-body text-ink-2">
        {t('import.preview.body')}
      </p>

      <dl
        aria-label={t('import.preview.summary.label')}
        className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6"
        id={summaryId}
      >
        {figures.map((figure) => (
          <div
            key={figure.key}
            className="rounded-lg border border-border-subtle bg-surface px-3 py-2"
          >
            <dt className="text-micro tracking-label uppercase text-ink-2">
              {t(figure.key)}
            </dt>
            <dd className="text-label font-semibold text-ink">
              {figure.value}
            </dd>
          </div>
        ))}
      </dl>

      {result.quota === null ? null : (
        <Notice tone="warning">
          {t('import.preview.quota', {
            excess: formatNumber(locale, result.quota.excess),
            limit: formatNumber(locale, result.quota.limit),
          })}
        </Notice>
      )}

      {result.truncated ? (
        <Notice tone="warning">
          {t('import.file.truncated', {
            rows: formatNumber(locale, result.rows.length),
          })}
        </Notice>
      ) : null}

      {result.sourceRefUsed ? (
        <Notice tone="info">{t('import.preview.sourceRef.used')}</Notice>
      ) : null}

      <Notice tone="info">{t('import.preview.decisions.note')}</Notice>

      <Select
        label={t('import.preview.filter.label')}
        selectedKey={filter}
        onSelectionChange={(key) => setFilter(String(key) as PreviewFilter)}
        className="max-w-xs"
      >
        {(Object.keys(FILTER_LABEL) as Array<PreviewFilter>).map((option) => (
          <SelectItem
            key={option}
            id={option}
            textValue={t(FILTER_LABEL[option])}
          >
            {t(FILTER_LABEL[option])}
          </SelectItem>
        ))}
      </Select>

      {visible.length === 0 ? (
        <p className="text-body text-ink-2">{t('import.preview.empty')}</p>
      ) : (
        <TableContainer>
          {/*
            `max-md:block` on the table and its body is what makes the stacked layout hold up.
            Below `md` each row becomes a grid, and a `display: table` element whose rows are no
            longer table rows has no row boxes to take its width from: WebKit lays it out at zero
            width and the whole preview disappears on an iPhone. Chromium happens to keep the
            declared width, which is why this is only visible on one engine.
          */}
          <Table
            aria-label={t('import.preview.table')}
            className="max-md:block"
          >
            <TableHeader className="max-md:sr-only">
              <Column isRowHeader>{t('import.preview.column.date')}</Column>
              <Column>{t('import.preview.column.description')}</Column>
              <Column align="end">{t('import.preview.column.amount')}</Column>
              <Column>{t('import.preview.column.match')}</Column>
              <Column>{t('import.preview.column.decision')}</Column>
            </TableHeader>
            <TableBody className="max-md:block">
              {visible.map((row) => {
                const drawnDate = formatCalendarDate(locale, row.bookedOn)
                const amount = makeMoney(signedAmountMinor(row), currencyCode)
                const spokenAmount = amountReading(t, locale, amount, {
                  signed: true,
                })

                return (
                  <Row
                    key={row.rowIndex}
                    id={row.rowIndex}
                    className={
                      row.flagged
                        ? 'shadow-[inset_3px_0_0_0_var(--color-warning)] max-md:grid max-md:gap-2 max-md:py-3'
                        : 'max-md:grid max-md:gap-2 max-md:py-3'
                    }
                  >
                    <Cell className="whitespace-nowrap max-md:block">
                      {drawnDate}
                    </Cell>
                    <Cell className="max-md:block">
                      <span className="block truncate text-ink">
                        {row.description ?? row.payee ?? ''}
                      </span>
                      {row.payee === null || row.description === null ? null : (
                        <span className="block truncate text-caption text-ink-2">
                          {row.payee}
                        </span>
                      )}
                    </Cell>
                    <Cell
                      align="end"
                      className="tabular-nums whitespace-nowrap max-md:block"
                    >
                      <span aria-hidden="true">
                        {formatSignedMoney(locale, amount)}
                      </span>
                      <span className="sr-only">{spokenAmount}</span>
                    </Cell>
                    <Cell className="max-md:block">
                      <MatchBadge row={row} />
                      {row.reason === null ? null : (
                        <span className="block text-caption text-ink-2">
                          {t(
                            `import.preview.reason.${row.reason}` as MessageKey,
                          )}
                        </span>
                      )}
                    </Cell>
                    <Cell className="max-md:block">
                      <Select
                        // Never a bare "Action": in a table of four hundred rows the name has to
                        // say *which* row this control belongs to.
                        aria-label={t('import.preview.decision.label', {
                          date: drawnDate,
                          amount: spokenAmount,
                        })}
                        size="sm"
                        selectedKey={decisionOf(row)}
                        onSelectionChange={(key) =>
                          setDecisions((current) => {
                            const next = new Map(current)
                            next.set(row.rowIndex, key as ImportRowDecision)
                            return next
                          })
                        }
                      >
                        <SelectItem
                          id="create"
                          textValue={t('import.preview.decision.create')}
                        >
                          {t('import.preview.decision.create')}
                        </SelectItem>
                        <SelectItem
                          id="skip_duplicate"
                          textValue={t('import.preview.decision.skip')}
                        >
                          {t('import.preview.decision.skip')}
                        </SelectItem>
                      </Select>
                    </Cell>
                  </Row>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {result.errors.length === 0 ? null : (
        <section className="flex flex-col gap-3">
          <div className="space-y-1">
            <h3 className="text-label font-semibold text-ink">
              {t('import.preview.invalid.title')}
            </h3>
            <p className="text-caption text-ink-2">
              {t('import.preview.invalid.body')}
            </p>
          </div>
          <ul className="flex flex-col gap-3">
            {result.errors.map((error) => (
              <QuotedError key={error.rowIndex} error={error} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** The duplicate marker: a word and a glyph before it is ever a colour. */
function MatchBadge({ row }: { readonly row: ImportPreviewRow }) {
  const t = useTranslate()

  if (row.confidence === 'certain') {
    return (
      <Badge tone="neutral" icon={<Copy aria-hidden="true" />}>
        {t('import.preview.match.certain')}
      </Badge>
    )
  }
  if (row.confidence === 'probable' || row.flagged) {
    return (
      <Badge tone="warning" icon={<TriangleAlert aria-hidden="true" />}>
        {t('import.preview.match.probable')}
      </Badge>
    )
  }
  return (
    <Badge tone="neutral" size="sm">
      {t('import.preview.match.none')}
    </Badge>
  )
}

/**
 * One refused row: which row it was, why, and the file's own text.
 *
 * The reason and the quote are the row's description, tied to it with `aria-describedby`, so a
 * reader who lands on the entry hears the row number and then what was wrong with it rather than
 * three unattached sentences. `raw` is source text and is never read back as an amount.
 */
function QuotedError({ error }: { readonly error: ImportPreviewError }) {
  const t = useTranslate()
  const labelId = useId()
  const reasonId = useId()
  const rawId = useId()

  return (
    <li
      aria-labelledby={labelId}
      aria-describedby={`${reasonId} ${rawId}`}
      className="rounded-lg border border-border-subtle bg-surface px-3 py-2"
    >
      <p id={labelId} className="text-label font-semibold text-ink">
        {t('import.preview.invalid.row', { row: error.rowIndex + 1 })}
      </p>
      <p id={reasonId} className="text-caption text-ink-2">
        {t(error.message as MessageKey)}
      </p>
      <p id={rawId} className="truncate text-caption text-ink-2">
        {t('import.preview.invalid.raw', { raw: error.raw.join(' · ') })}
      </p>
    </li>
  )
}
