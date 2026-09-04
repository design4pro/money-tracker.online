import { useEffect, useId, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import {
  Button,
  Radio,
  RadioGroup,
  Select,
  SelectItem,
  Switch,
  TextField,
} from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { listAccounts } from '#/server/fns/accounts'
import {
  confirmImportMapping,
  offerMappingPreset,
} from '#/server/fns/import-mapping'

import { suggestImportDateFormat } from '../-server/date-format'
import { Notice } from './notice'

import type { MessageKey } from '#/lib/i18n'
import type { DateFormat, ImportMappingInput } from '#/server/import/map'

/**
 * Saying what each column of the file holds.
 *
 * ## The rows are the file's columns, and the data is on screen
 *
 * Three sample values sit beside every column, because a header called `Kwota`, `Obciążenie` or
 * `Uznanie` tells a person nothing that `-45,00` does not tell them better. The choice is grounded
 * in what is actually in the file rather than in what somebody at a bank called a column.
 *
 * ## A saved mapping is offered, never applied
 *
 * A preset whose fingerprint matches this file's header row pre-fills the table **and says so**.
 * It is never confirmed on somebody's behalf: a bank that reorders two columns keeps the same
 * header names, and a silently applied preset would import that file into the wrong fields — which
 * is money in the wrong place, found months later.
 *
 * ## The account is asked for only when it was lost
 *
 * Walking here from `/import` carries the account chosen one screen ago. Landing here after a
 * reload does not: the file is re-read from R2, and no batch column holds the account before a
 * mapping is confirmed. So the picker appears exactly then, and never as a second asking.
 *
 * ## The DMY/MDY question blocks, and is not a toast
 *
 * When every sampled date is ambiguous the server says so rather than choosing, and this step
 * refuses to continue until a person has answered. A toast is dismissible and this is not
 * dismissible: a default here misdates up to twelve rows in every thirty-one, silently.
 *
 * Nothing on this screen is timed. The mapping is confirmed when the person presses the button.
 */

/** Every mapping target a column may be pointed at. `mappingSchema` names each of them. */
const TARGETS = [
  'date',
  'amount',
  'debit',
  'credit',
  'description',
  'payee',
  'category',
  'reference',
  'notes',
  'currency',
  'sourceRef',
] as const

type Target = (typeof TARGETS)[number]

/** What a column is doing: one target, or nothing at all. */
type Assignment = Target | 'ignore'

const DECIMAL_SEPARATORS = ['.', ','] as const
type DecimalSeparator = (typeof DECIMAL_SEPARATORS)[number]

const THOUSANDS_SEPARATORS = ['.', ',', ' ', 'none'] as const
type ThousandsSeparator = (typeof THOUSANDS_SEPARATORS)[number]

/** The message key naming each date layout, so the option list is not four bare patterns. */
const DATE_FORMAT_LABEL: Readonly<Record<DateFormat, MessageKey>> = {
  'YYYY-MM-DD': 'import.mapping.date.iso',
  'DD/MM/YYYY': 'import.mapping.date.dmySlash',
  'MM/DD/YYYY': 'import.mapping.date.mdySlash',
  'DD.MM.YYYY': 'import.mapping.date.dmyDot',
}

const DECIMAL_LABEL: Readonly<Record<DecimalSeparator, MessageKey>> = {
  '.': 'import.mapping.decimal.dot',
  ',': 'import.mapping.decimal.comma',
}

const THOUSANDS_LABEL: Readonly<Record<ThousandsSeparator, MessageKey>> = {
  '.': 'import.mapping.thousands.dot',
  ',': 'import.mapping.thousands.comma',
  ' ': 'import.mapping.thousands.space',
  none: 'import.mapping.thousands.none',
}

/** How many values of a column are shown beside it. Three: enough to see a pattern, not a table. */
const SAMPLES_PER_COLUMN = 3

export interface MappingStepProps {
  readonly batchId: string
  /**
   * The account the rows would land in, or `null` when nobody has said yet.
   *
   * `mappingSchema` carries it and the batch row has no column for it, so a file re-read after a
   * reload cannot recover it - see `-server/describe-batch.ts`. In that case the step asks, because
   * the alternative is posting somebody's statement to the wrong ledger.
   */
  readonly accountId: string | null
  readonly headers: ReadonlyArray<string>
  readonly sampleRows: ReadonlyArray<ReadonlyArray<string>>
  /** Called once the mapping is stored, so the stepper can move on to the review. */
  readonly onConfirmed: () => void
}

/**
 * A stored preset's JSON, read defensively.
 *
 * The value was written by `mappingSchema` and is parsed by it again on the way back in, so this
 * reader only has to fill a form: it takes what it recognises and ignores the rest rather than
 * re-implementing the schema in the browser.
 */
type StoredMapping = Readonly<Record<string, unknown>>

function stringField(mapping: StoredMapping, key: string): string | undefined {
  const value = mapping[key]
  return typeof value === 'string' ? value : undefined
}

export function MappingStep({
  batchId,
  accountId,
  headers,
  sampleRows,
  onConfirmed,
}: MappingStepProps) {
  const t = useTranslate()
  const numbersHeadingId = useId()

  const [chosenAccount, setChosenAccount] = useState<string | null>(accountId)

  const [assignments, setAssignments] = useState<ReadonlyArray<Assignment>>(
    () => headers.map((): Assignment => 'ignore'),
  )
  const [dateFormat, setDateFormat] = useState<DateFormat | null>(null)
  const [decimal, setDecimal] = useState<DecimalSeparator>(',')
  const [thousands, setThousands] = useState<ThousandsSeparator>('none')
  const [accountingNegatives, setAccountingNegatives] = useState(false)
  const [presetLabel, setPresetLabel] = useState('')
  const [presetApplied, setPresetApplied] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const headerKey = headers.join('')

  /**
   * The accounts to choose from, asked for only when the answer is missing.
   *
   * The ordinary walk from `/import` arrives with the account already decided, and this query stays
   * disabled for it. Archived accounts are included for the reason `index.tsx` gives: a statement
   * covering last spring may belong to an account that has since been closed.
   */
  const accounts = useQuery({
    queryKey: ['accounts', 'for-import'],
    queryFn: () => listAccounts({ data: {} }),
    enabled: accountId === null,
  })

  /** The mapping this workspace last confirmed for a file with exactly these columns. */
  const preset = useQuery({
    queryKey: ['import', 'preset', headerKey],
    queryFn: () => offerMappingPreset({ data: { headers: [...headers] } }),
  })

  // Filling the form from a preset happens once, before anything else has been touched. It is a
  // **pre-fill**: nothing is stored until the button at the bottom is pressed.
  useEffect(() => {
    const offered = preset.data
    if (offered === undefined || offered === null || presetApplied !== null) {
      return
    }

    let stored: StoredMapping
    try {
      stored = JSON.parse(offered.mapping) as StoredMapping
    } catch {
      return
    }

    const amount = stored.amount as StoredMapping | undefined
    const columns = new Map<string, Target>()
    const remember = (column: string | undefined, target: Target) => {
      if (column !== undefined) columns.set(column, target)
    }

    remember(stringField(stored, 'date'), 'date')
    if (amount !== undefined && amount.kind === 'signed') {
      remember(stringField(amount, 'column'), 'amount')
    }
    if (amount !== undefined && amount.kind === 'debit_credit') {
      remember(stringField(amount, 'debitColumn'), 'debit')
      remember(stringField(amount, 'creditColumn'), 'credit')
    }
    for (const target of [
      'description',
      'payee',
      'category',
      'reference',
      'notes',
      'currency',
      'sourceRef',
    ] as const) {
      remember(stringField(stored, target), target)
    }

    setAssignments(headers.map((header) => columns.get(header) ?? 'ignore'))

    const format = stringField(stored, 'dateFormat')
    if (format !== undefined && format in DATE_FORMAT_LABEL) {
      setDateFormat(format as DateFormat)
    }
    const storedDecimal = stringField(stored, 'decimalSeparator')
    if (storedDecimal === '.' || storedDecimal === ',') {
      setDecimal(storedDecimal)
    }
    const storedThousands = stringField(stored, 'thousandsSeparator')
    if (
      storedThousands === '.' ||
      storedThousands === ',' ||
      storedThousands === ' ' ||
      storedThousands === 'none'
    ) {
      setThousands(storedThousands)
    }
    if (typeof stored.accountingNegatives === 'boolean') {
      setAccountingNegatives(stored.accountingNegatives)
    }
    if (offered.label !== null) setPresetLabel(offered.label)
    setPresetApplied(offered.label ?? '')
  }, [preset.data, presetApplied, headers])

  const columnOf = (target: Target): string | undefined => {
    const at = assignments.indexOf(target)
    return at === -1 ? undefined : headers[at]
  }

  const dateColumnIndex = assignments.indexOf('date')
  const dateColumn = columnOf('date')

  /** The date column's own cells, which is what a layout is decided from. */
  const dateSamples = useMemo(
    () =>
      dateColumnIndex === -1
        ? []
        : sampleRows
            .map((row) => row[dateColumnIndex] ?? '')
            .filter((cell) => cell.trim() !== ''),
    [dateColumnIndex, sampleRows],
  )

  const suggestion = useQuery({
    queryKey: ['import', 'date-format', batchId, dateColumn ?? ''],
    queryFn: () =>
      suggestImportDateFormat({ data: { samples: [...dateSamples] } }),
    enabled: dateSamples.length > 0,
  })

  // A resolved layout pre-fills the picker; an ambiguous one deliberately does not, which is what
  // leaves the question below unanswered and the step blocked.
  useEffect(() => {
    const answer = suggestion.data
    if (answer?.kind === 'resolved') {
      setDateFormat((current) => current ?? answer.format)
    }
  }, [suggestion.data])

  const ambiguous = suggestion.data?.kind === 'ambiguous'
  const unrecognised = suggestion.data?.kind === 'unrecognised'

  /**
   * Points a column at a target, taking that target off whichever column had it.
   *
   * One column per target, enforced here rather than reported afterwards: two columns claiming the
   * date is not something a person meant to say.
   */
  function assign(index: number, next: Assignment) {
    setAssignments((current) =>
      current.map((value, at) => {
        if (at === index) return next
        return next !== 'ignore' && value === next ? 'ignore' : value
      }),
    )
  }

  const amountColumn = columnOf('amount')
  const debitColumn = columnOf('debit')
  const creditColumn = columnOf('credit')

  /** Everything standing between this form and a mapping the server would accept. */
  const problems: Array<MessageKey> = []
  if (chosenAccount === null) problems.push('import.mapping.error.account')
  if (dateColumn === undefined) problems.push('import.mapping.error.date')
  if (
    amountColumn === undefined &&
    debitColumn === undefined &&
    creditColumn === undefined
  ) {
    problems.push('import.mapping.error.amount')
  }
  if (
    amountColumn !== undefined &&
    (debitColumn !== undefined || creditColumn !== undefined)
  ) {
    problems.push('import.mapping.error.amountShapes')
  }
  if (debitColumn !== undefined && creditColumn === undefined) {
    problems.push('import.mapping.error.creditMissing')
  }
  if (creditColumn !== undefined && debitColumn === undefined) {
    problems.push('import.mapping.error.debitMissing')
  }
  if (dateColumn !== undefined && dateFormat === null) {
    problems.push('import.mapping.date.ambiguous.required')
  }
  if (thousands === decimal) problems.push('import.mapping.error.separators')

  const confirm = useMutation({
    mutationFn: async () => {
      if (
        chosenAccount === null ||
        dateColumn === undefined ||
        dateFormat === null
      ) {
        return
      }

      const amount: ImportMappingInput['amount'] =
        amountColumn !== undefined
          ? { kind: 'signed', column: amountColumn }
          : {
              kind: 'debit_credit',
              debitColumn: debitColumn ?? '',
              creditColumn: creditColumn ?? '',
            }

      const optional = (target: Target) => {
        const column = columnOf(target)
        return column === undefined ? {} : { [target]: column }
      }

      const mapping: ImportMappingInput = {
        accountId: chosenAccount,
        date: dateColumn,
        dateFormat,
        amount,
        decimalSeparator: decimal,
        thousandsSeparator: thousands,
        accountingNegatives,
        ...optional('description'),
        ...optional('payee'),
        ...optional('category'),
        ...optional('reference'),
        ...optional('notes'),
        ...optional('currency'),
        ...optional('sourceRef'),
      }

      await confirmImportMapping({
        data: {
          id: batchId,
          mapping,
          // The header row goes with it: that is what the confirmed mapping is remembered under
          // for the next file of the same shape.
          headers: [...headers],
          presetLabel: presetLabel.trim() === '' ? null : presetLabel.trim(),
        },
      })
    },
    onSuccess: () => onConfirmed(),
  })

  function submit() {
    setSubmitted(true)
    if (problems.length > 0) return
    confirm.mutate()
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-prose text-body text-ink-2">
        {t('import.mapping.body')}
      </p>

      {/*
        Only asked when the answer was lost. Somebody who walked here from `/import` chose the
        account one screen ago and is not asked twice; somebody who reloaded is, because the batch
        row does not carry the account and guessing would post the rows to the wrong ledger.
      */}
      {accountId === null ? (
        <Select
          label={t('import.upload.account.label')}
          placeholder={t('import.upload.account.placeholder')}
          selectedKey={chosenAccount}
          onSelectionChange={(key) => setChosenAccount(String(key))}
          isRequired
          isInvalid={submitted && chosenAccount === null}
          errorMessage={t('import.mapping.error.account')}
          isDisabled={accounts.isPending}
          className="md:max-w-sm"
        >
          {(accounts.data?.accounts ?? []).map((account) => (
            <SelectItem
              key={account.id}
              id={account.id}
              textValue={account.name}
            >
              {account.name}
            </SelectItem>
          ))}
        </Select>
      ) : null}

      {presetApplied === null ? null : (
        <Notice tone="info" title={t('import.mapping.preset.title')}>
          <p>{t('import.mapping.preset.body')}</p>
          {presetApplied === '' ? null : (
            <p>{t('import.mapping.preset.named', { label: presetApplied })}</p>
          )}
        </Notice>
      )}

      {/*
        A plain table, and deliberately not the `00-S8` data-table.

        That component is React Aria's `Table`, which is an ARIA **grid**: every cell is a focus
        stop of its own, arrow keys belong to the grid rather than to what is inside a cell, and a
        cell holding a picker is two overlapping targets — the picker, and the strip of cell around
        it, which comes out at twenty-one pixels and fails WCAG 2.2's 24px minimum. None of that is
        a defect in the data-table; it is what a data grid is for, and the preview step uses it for
        exactly that. This surface is a **form** whose rows happen to line up: three columns, one
        control per row, nothing to sort, select or navigate cell by cell. So it is `<table>`
        markup, which reads the same to a screen reader, leaves the arrow keys to the pickers, and
        puts no focus stop between a person and the control they came for.

        At 360px the header row is read but not drawn, and each row stacks into a card whose cells
        carry their own labels. A three-column grid at that width would either scroll sideways under
        the reader's thumb or set the sample values at four characters.
      */}
      <div className="w-full overflow-auto rounded-lg border border-border-subtle bg-surface">
        <table className="w-full max-md:block">
          <caption className="sr-only">{t('import.mapping.table')}</caption>
          <thead className="bg-surface-sunken text-micro tracking-label uppercase text-ink-2 max-md:sr-only">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-semibold">
                {t('import.mapping.column.header')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">
                {t('import.mapping.column.samples')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">
                {t('import.mapping.column.target')}
              </th>
            </tr>
          </thead>
          <tbody className="max-md:block">
            {headers.map((header, index) => (
              <tr
                key={`${header}-${String(index)}`}
                className="border-b border-border-subtle last:border-b-0 max-md:grid max-md:grid-cols-1 max-md:gap-2 max-md:py-3"
              >
                <th
                  scope="row"
                  className="px-3 py-2.5 text-start align-middle font-medium text-ink max-md:block"
                >
                  {header}
                </th>
                <td className="px-3 py-2.5 align-middle text-ink max-md:block">
                  <span className="block text-micro tracking-label uppercase text-ink-2 md:hidden">
                    {t('import.mapping.column.samples')}
                  </span>
                  <ul className="space-y-0.5 text-caption text-ink-2">
                    {sampleRows.slice(0, SAMPLES_PER_COLUMN).map((row, at) => {
                      // `.at` rather than `[index]`: the parser pads every row to the header's
                      // width, and a file that ever broke that promise should print "(empty)"
                      // rather than throw inside a table cell.
                      const value = row.at(index)
                      return (
                        <li key={at} className="truncate">
                          {value === undefined || value.trim() === ''
                            ? t('import.mapping.column.empty')
                            : value}
                        </li>
                      )
                    })}
                  </ul>
                </td>
                <td className="px-3 py-2.5 align-middle max-md:block">
                  <Select
                    aria-label={t('import.mapping.target.label', {
                      column: header,
                    })}
                    size="sm"
                    selectedKey={assignments[index]}
                    onSelectionChange={(key) =>
                      assign(index, String(key) as Assignment)
                    }
                  >
                    <SelectItem
                      id="ignore"
                      textValue={t('import.mapping.target.ignore')}
                    >
                      {t('import.mapping.target.ignore')}
                    </SelectItem>
                    {TARGETS.map((target) => {
                      const label = t(
                        `import.mapping.target.${target}` as MessageKey,
                      )
                      return (
                        <SelectItem key={target} id={target} textValue={label}>
                          {label}
                        </SelectItem>
                      )
                    })}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        The blocking question, in place and above the button it blocks. A RadioGroup rather than a
        picker with a default, because there is no answer to pre-select.
      */}
      {ambiguous ? (
        <Notice tone="warning" title={t('import.mapping.date.ambiguous.title')}>
          <p className="mb-2">
            {t('import.mapping.date.ambiguous.body', {
              sample: dateSamples[0] ?? '',
            })}
          </p>
          <RadioGroup
            label={t('import.mapping.date.ambiguous.legend')}
            value={dateFormat ?? ''}
            onChange={(value) => setDateFormat(value as DateFormat)}
            isRequired
            isInvalid={submitted && dateFormat === null}
            errorMessage={t('import.mapping.date.ambiguous.required')}
          >
            {(suggestion.data?.kind === 'ambiguous'
              ? suggestion.data.candidates
              : []
            ).map((candidate) => (
              <Radio key={candidate} value={candidate}>
                {t(DATE_FORMAT_LABEL[candidate])}
              </Radio>
            ))}
          </RadioGroup>
        </Notice>
      ) : null}

      {unrecognised && dateColumn !== undefined ? (
        <Notice tone="problem">
          {t('import.mapping.date.unrecognised', { column: dateColumn })}
        </Notice>
      ) : null}

      <section
        aria-labelledby={numbersHeadingId}
        className="flex flex-col gap-4"
      >
        <h3 id={numbersHeadingId} className="text-label font-semibold text-ink">
          {t('import.mapping.numbers.title')}
        </h3>

        <div className="grid gap-4 md:grid-cols-3">
          <Select
            label={t('import.mapping.decimal.label')}
            selectedKey={decimal}
            onSelectionChange={(key) =>
              setDecimal(String(key) as DecimalSeparator)
            }
          >
            {DECIMAL_SEPARATORS.map((separator) => (
              <SelectItem
                key={separator}
                id={separator}
                textValue={t(DECIMAL_LABEL[separator])}
              >
                {t(DECIMAL_LABEL[separator])}
              </SelectItem>
            ))}
          </Select>

          <Select
            label={t('import.mapping.thousands.label')}
            selectedKey={thousands}
            onSelectionChange={(key) =>
              setThousands(String(key) as ThousandsSeparator)
            }
          >
            {THOUSANDS_SEPARATORS.map((separator) => (
              <SelectItem
                key={separator}
                id={separator}
                textValue={t(THOUSANDS_LABEL[separator])}
              >
                {t(THOUSANDS_LABEL[separator])}
              </SelectItem>
            ))}
          </Select>

          <Select
            label={t('import.mapping.date.label')}
            placeholder={
              suggestion.isLoading
                ? t('import.mapping.date.checking')
                : undefined
            }
            selectedKey={dateFormat}
            onSelectionChange={(key) =>
              setDateFormat(String(key) as DateFormat)
            }
            isDisabled={dateColumn === undefined}
          >
            {(Object.keys(DATE_FORMAT_LABEL) as Array<DateFormat>).map(
              (format) => (
                <SelectItem
                  key={format}
                  id={format}
                  textValue={t(DATE_FORMAT_LABEL[format])}
                >
                  {t(DATE_FORMAT_LABEL[format])}
                </SelectItem>
              ),
            )}
          </Select>
        </div>

        <Switch
          isSelected={accountingNegatives}
          onChange={setAccountingNegatives}
          description={t('import.mapping.accounting.description')}
        >
          {t('import.mapping.accounting.label')}
        </Switch>

        <TextField
          label={t('import.mapping.save.label')}
          description={t('import.mapping.save.description')}
          placeholder={t('import.mapping.save.placeholder')}
          value={presetLabel}
          onChange={setPresetLabel}
          maxLength={200}
        />
      </section>

      {submitted && problems.length > 0 ? (
        <Notice tone="problem" title={t('import.mapping.problems')}>
          <ul className="list-disc ps-4">
            {problems.map((problem) => (
              <li key={problem}>{t(problem)}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {confirm.isError ? (
        <Notice tone="problem">
          {t('import.mapping.failed', {
            reason:
              confirm.error instanceof Error ? confirm.error.message : batchId,
          })}
        </Notice>
      ) : null}

      <div>
        <Button
          variant="primary"
          onPress={submit}
          isPending={confirm.isPending}
        >
          {confirm.isPending
            ? t('import.mapping.pending')
            : t('import.mapping.submit')}
        </Button>
      </div>
    </div>
  )
}
