import { useMemo, useState } from 'react'
import { ArrowDownUp, ListFilter, Plus, X } from 'lucide-react'
import { getLocalTimeZone, parseDate, today } from '@internationalized/date'

import {
  Badge,
  Button,
  Checkbox,
  CheckboxGroup,
  ComboBox,
  ComboBoxItem,
  DateRangePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
  Modal,
  Radio,
  RadioGroup,
  SearchField,
  Select,
  SelectItem,
} from '#/components/ui'
import { cn } from '#/lib/cn'
import { useLocale, useTranslate } from '#/lib/i18n'
import { asCurrencyCode } from '#/lib/money'

import { AmountField } from './amount-field'
import {
  PAYMENT_METHOD_KEY,
  countActiveFilters,
  describeFilters,
} from './filter-chips'
import { LEDGER_PAYMENT_METHODS, LEDGER_SORT_FIELDS } from './types'

import type { DateValue, RangeValue } from 'react-aria-components'
import type { MessageKey } from '#/lib/i18n'
import type { Minor } from '#/lib/money'
import type {
  LedgerFilters,
  LedgerSort,
  LedgerSortField,
  NamedOption,
  TransactionReference,
} from './types'

/**
 * Everything that narrows the ledger, and the state of that narrowing made visible.
 *
 * ## Two tiers on purpose, and a third one on a phone
 *
 * The search box, the date range and the sort are on the bar itself, because those three are used
 * on most visits. Everything else lives behind one **Filters** button that carries a count. A bar
 * that shows nine controls at once is a bar nobody reads.
 *
 * Below `md` even three is too many. Four stacked full-width controls plus a full-width primary
 * button put the first transaction some 620px down an 844px screen — under two rows of a list the
 * reader opened to read. So on a phone the bar is one row (search, Filters, New) and the date range
 * and the sort move inside the panel, where they are drafted and applied with everything else.
 *
 * ## Every active filter is visible and removable
 *
 * Whatever is set — including a filter that arrived on a shared link and whose picker this
 * workspace does not have yet — renders as a chip whose accessible name contains its **value**.
 * "Remove filter" is not a label; "Remove Account: Wallet, Cash" is. The panel can be closed and
 * the reader can still see, and undo, what is in force.
 *
 * ## Vocabularies that do not exist yet are simply absent
 *
 * Categories, tags and payees are owned by plan `08`. An empty collection removes its picker rather
 * than rendering one that can only be opened to find nothing — which is also the right behaviour
 * for a real workspace that has never made a tag.
 */

export interface FilterBarProps {
  readonly filters: LedgerFilters
  readonly sort: LedgerSort
  /**
   * The next view, as one call.
   *
   * Narrowing and ordering move together or not at all: the panel's Apply button changes both, and
   * two separate callbacks would each write the whole search object from its own stale closure, so
   * whichever ran second would quietly discard the other's change.
   */
  readonly onViewChange: (filters: LedgerFilters, sort: LedgerSort) => void
  readonly reference: TransactionReference
  readonly onCreate: () => void
}

const SORT_LABEL: Record<LedgerSortField, MessageKey> = {
  bookedOn: 'transactions.field.date',
  payee: 'transactions.field.payee',
  category: 'transactions.field.category',
  account: 'transactions.field.account',
}

/** Drops the keys whose value is an empty array, so `{ tagIds: [] }` never reaches the URL. */
function prune(filters: LedgerFilters): LedgerFilters {
  const entries = Object.entries(filters).filter(([, value]) => {
    if (value === undefined) {
      return false
    }
    return !(Array.isArray(value) && value.length === 0)
  })
  return Object.fromEntries(entries)
}

/* -------------------------------------------------------------------------- */
/* Pickers                                                                     */
/* -------------------------------------------------------------------------- */

interface MultiPickerProps {
  readonly label: string
  readonly options: ReadonlyArray<NamedOption>
  readonly selected: ReadonlyArray<string>
  readonly onChange: (next: ReadonlyArray<string>) => void
}

/**
 * A bounded set — accounts, account groups, payment methods — as a real checkbox group.
 *
 * Announced as one group with one name, and every option reachable by Tab within it. For a list
 * that could run to hundreds of entries this would be the wrong control, which is what
 * {@link SearchablePicker} is for.
 */
function CheckboxPicker({
  label,
  options,
  selected,
  onChange,
}: MultiPickerProps) {
  return (
    <CheckboxGroup
      label={label}
      value={[...selected]}
      onChange={(next) => onChange(next)}
      orientation="horizontal"
    >
      {options.map((option) => (
        <Checkbox key={option.id} value={option.id}>
          {option.name}
        </Checkbox>
      ))}
    </CheckboxGroup>
  )
}

interface SearchablePickerProps extends MultiPickerProps {
  readonly placeholder: string
  readonly emptyState: string
  readonly removeLabel: (name: string) => string
}

/**
 * An unbounded vocabulary — categories, payees, tags — as a filter-as-you-type box that appends
 * to a list of removable chips.
 *
 * React Aria announces the remaining option count on every keystroke, which is the half of an
 * autocomplete that hand-rolled ones leave out. Chosen entries leave the list, so the same payee
 * cannot be added twice.
 */
function SearchablePicker({
  label,
  options,
  selected,
  onChange,
  placeholder,
  emptyState,
  removeLabel,
}: SearchablePickerProps) {
  // The disclosure button's accessible name. `components/ui` holds no catalogue, so the caller
  // localises it; without this the Polish UI announced the English default.
  const t = useTranslate()
  const chosen = new Set(selected)
  const available = options.filter((option) => !chosen.has(option.id))
  const names = new Map(options.map((option) => [option.id, option.name]))

  return (
    <div className="flex flex-col gap-2">
      <ComboBox
        label={label}
        toggleLabel={t('a11y.showSuggestions')}
        items={available}
        placeholder={placeholder}
        emptyState={emptyState}
        selectedKey={null}
        onSelectionChange={(key) => {
          if (key === null) {
            return
          }
          onChange([...selected, String(key)])
        }}
      >
        {(option: NamedOption) => (
          <ComboBoxItem id={option.id} textValue={option.name}>
            {option.name}
          </ComboBoxItem>
        )}
      </ComboBox>
      {selected.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const name = names.get(id) ?? id
            return (
              <li key={id}>
                <Button
                  variant="subtle"
                  size="sm"
                  shape="pill"
                  iconAfter={<X />}
                  aria-label={removeLabel(name)}
                  onPress={() =>
                    onChange(selected.filter((entry) => entry !== id))
                  }
                >
                  {name}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

interface SortControlsProps {
  readonly sort: LedgerSort
  readonly onChange: (next: LedgerSort) => void
  readonly className?: string
}

/**
 * The ordering: a field, and a direction toggle beside it.
 *
 * One definition, rendered twice — on the bar from `md` up and inside the panel below it — so the
 * two can never offer different fields or label the toggle differently. Only one of the two is
 * ever displayed, so only one is ever in the accessibility tree.
 */
function SortControls({ sort, onChange, className }: SortControlsProps) {
  const t = useTranslate()
  return (
    <div className={cn('flex items-end gap-2', className)}>
      <Select
        aria-label={t('transactions.sort.label')}
        selectedKey={sort.field}
        onSelectionChange={(key) =>
          onChange({ ...sort, field: key as LedgerSortField })
        }
        className="w-40 flex-1 md:flex-none"
      >
        {LEDGER_SORT_FIELDS.map((field) => (
          <SelectItem key={field} id={field} textValue={t(SORT_LABEL[field])}>
            {t(SORT_LABEL[field])}
          </SelectItem>
        ))}
      </Select>
      <Button
        variant="secondary"
        shape="icon"
        label={
          sort.direction === 'asc'
            ? t('action.sortDescending')
            : t('action.sortAscending')
        }
        icon={<ArrowDownUp />}
        onPress={() =>
          onChange({
            ...sort,
            direction: sort.direction === 'asc' ? 'desc' : 'asc',
          })
        }
      />
    </div>
  )
}

/** The `from`/`to` pair of a draft or of the live filters, as the picker wants it. */
function toRange(filters: LedgerFilters): RangeValue<DateValue> | null {
  return filters.from === undefined || filters.to === undefined
    ? null
    : { start: parseDate(filters.from), end: parseDate(filters.to) }
}

/** The same pair back out again, with `null` meaning "no window". */
function fromRange(range: RangeValue<DateValue> | null): LedgerFilters {
  return range === null
    ? { from: undefined, to: undefined }
    : { from: range.start.toString(), to: range.end.toString() }
}

/* -------------------------------------------------------------------------- */
/* The bar                                                                     */
/* -------------------------------------------------------------------------- */

export function FilterBar({
  filters,
  sort,
  onViewChange,
  reference,
  onCreate,
}: FilterBarProps) {
  const t = useTranslate()
  const locale = useLocale()
  const [panelDraft, setPanelDraft] = useState<LedgerFilters>(filters)
  const [sortDraft, setSortDraft] = useState<LedgerSort>(sort)

  const chips = useMemo(
    () => describeFilters({ filters, reference, t, locale }),
    [filters, locale, reference, t],
  )
  const activeCount = countActiveFilters(filters)

  const amountCurrency = asCurrencyCode(
    panelDraft.amountCurrency ?? reference.baseCurrencyCode,
  )
  const currencyOptions = useMemo(() => {
    const codes = new Set<string>([reference.baseCurrencyCode])
    for (const account of reference.accounts) {
      codes.add(account.currencyCode)
    }
    return [...codes].sort()
  }, [reference.accounts, reference.baseCurrencyCode])

  const maxDate = today(getLocalTimeZone()).add({ years: 5 })

  const update = (patch: LedgerFilters) =>
    onViewChange(prune({ ...filters, ...patch }), sort)

  const patchDraft = (patch: LedgerFilters) =>
    setPanelDraft((current) => ({ ...current, ...patch }))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <SearchField
          aria-label={t('transactions.search.placeholder')}
          placeholder={t('transactions.search.placeholder')}
          clearLabel={t('action.clear')}
          value={filters.text ?? ''}
          onChange={(value) =>
            update({ text: value.trim() === '' ? undefined : value })
          }
          className="min-w-0 flex-1 sm:min-w-56"
        />

        {/* From `md` up these two stay on the bar. Below it they are in the panel instead — see
            the module docblock — and the row is search, Filters and New, at 44px.

            The resting placeholder is passed only when *neither* bound is set, so the field can
            never say "Any date" while a one-sided range from a shared link is narrowing the list. */}
        <DateRangePicker
          aria-label={t('transactions.filter.dateRange')}
          calendarLabel={t('transactions.filter.openCalendar')}
          placeholder={
            filters.from === undefined && filters.to === undefined
              ? t('transactions.filter.anyDate')
              : undefined
          }
          value={toRange(filters)}
          maxValue={maxDate}
          onChange={(range) => update(fromRange(range))}
          className="hidden md:block"
        />

        <SortControls
          sort={sort}
          onChange={(next) => onViewChange(filters, next)}
          className="hidden md:flex"
        />

        <DialogTrigger
          onOpenChange={(open) => {
            if (open) {
              setPanelDraft(filters)
              setSortDraft(sort)
            }
          }}
        >
          <Button variant="secondary" icon={<ListFilter />}>
            {t('transactions.filter.title')}
            {activeCount === 0 ? null : (
              <Badge tone="brand" size="sm" className="ms-1">
                {activeCount}
              </Badge>
            )}
          </Button>
          <Modal placement="drawer-end" isDismissable={false}>
            <Dialog>
              {({ close }) => (
                <>
                  <DialogHeader
                    title={t('transactions.filter.title')}
                    description={t('transactions.filter.description')}
                    closeLabel={t('action.close')}
                    onClose={close}
                  />
                  <DialogBody className="flex flex-col gap-5">
                    {/* Below `md` the bar has no room for these, so this is where they live. They
                        are drafted like every other control in the panel and take effect on
                        Apply — a control that acted immediately while its neighbours waited would
                        be the panel disagreeing with itself. */}
                    <div className="flex flex-col gap-4 md:hidden">
                      <DateRangePicker
                        label={t('transactions.filter.dateRange')}
                        calendarLabel={t('transactions.filter.openCalendar')}
                        value={toRange(panelDraft)}
                        maxValue={maxDate}
                        onChange={(range) => patchDraft(fromRange(range))}
                      />
                      <div className="flex flex-col gap-2">
                        <span className="text-label font-medium text-ink-2">
                          {t('transactions.sort.label')}
                        </span>
                        <SortControls
                          sort={sortDraft}
                          onChange={setSortDraft}
                        />
                      </div>
                    </div>

                    <RadioGroup
                      label={t('transactions.filter.direction')}
                      orientation="horizontal"
                      value={panelDraft.direction ?? 'any'}
                      onChange={(value) =>
                        patchDraft({
                          direction:
                            value === 'any'
                              ? undefined
                              : (value as LedgerFilters['direction']),
                        })
                      }
                    >
                      <Radio value="any">{t('common.all')}</Radio>
                      <Radio value="income">
                        {t('transactions.direction.income')}
                      </Radio>
                      <Radio value="expense">
                        {t('transactions.direction.expense')}
                      </Radio>
                    </RadioGroup>

                    {reference.accounts.length === 0 ? null : (
                      <CheckboxPicker
                        label={t('transactions.field.account')}
                        options={reference.accounts}
                        selected={panelDraft.accountIds ?? []}
                        onChange={(next) => patchDraft({ accountIds: next })}
                      />
                    )}

                    {reference.accountGroups.length === 0 ? null : (
                      <CheckboxPicker
                        label={t('transactions.filter.accountGroup')}
                        options={reference.accountGroups}
                        selected={panelDraft.accountGroupIds ?? []}
                        onChange={(next) =>
                          patchDraft({ accountGroupIds: next })
                        }
                      />
                    )}

                    {reference.categories.length === 0 ? null : (
                      <SearchablePicker
                        label={t('transactions.field.category')}
                        options={reference.categories}
                        selected={panelDraft.categoryIds ?? []}
                        onChange={(next) => patchDraft({ categoryIds: next })}
                        placeholder={t(
                          'transactions.filter.categoryPlaceholder',
                        )}
                        emptyState={t('transactions.filter.noMatches')}
                        removeLabel={(name) =>
                          t('transactions.filter.remove', { name })
                        }
                      />
                    )}

                    {reference.payees.length === 0 ? null : (
                      <SearchablePicker
                        label={t('transactions.field.payee')}
                        options={reference.payees}
                        selected={panelDraft.payeeIds ?? []}
                        onChange={(next) => patchDraft({ payeeIds: next })}
                        placeholder={t('transactions.filter.payeePlaceholder')}
                        emptyState={t('transactions.filter.noMatches')}
                        removeLabel={(name) =>
                          t('transactions.filter.remove', { name })
                        }
                      />
                    )}

                    {reference.tags.length === 0 ? null : (
                      <SearchablePicker
                        label={t('transactions.field.tags')}
                        options={reference.tags}
                        selected={panelDraft.tagIds ?? []}
                        onChange={(next) => patchDraft({ tagIds: next })}
                        placeholder={t('transactions.filter.tagPlaceholder')}
                        emptyState={t('transactions.filter.noMatches')}
                        removeLabel={(name) =>
                          t('transactions.filter.remove', { name })
                        }
                      />
                    )}

                    <CheckboxPicker
                      label={t('transactions.field.paymentMethod')}
                      options={LEDGER_PAYMENT_METHODS.map((method) => ({
                        id: method,
                        name: t(PAYMENT_METHOD_KEY[method]),
                      }))}
                      selected={panelDraft.paymentMethods ?? []}
                      onChange={(next) =>
                        patchDraft({
                          paymentMethods:
                            next as LedgerFilters['paymentMethods'],
                        })
                      }
                    />

                    <fieldset className="flex flex-col gap-3">
                      <legend className="text-label font-medium text-ink-2">
                        {t('transactions.filter.amountRange')}
                      </legend>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <AmountField
                          label={t('transactions.filter.amountMin')}
                          currencyCode={amountCurrency}
                          value={
                            (panelDraft.amountMinMinor ?? null) as Minor | null
                          }
                          onChange={(value) =>
                            patchDraft({
                              amountMinMinor: value ?? undefined,
                              amountCurrency,
                            })
                          }
                        />
                        <AmountField
                          label={t('transactions.filter.amountMax')}
                          currencyCode={amountCurrency}
                          value={
                            (panelDraft.amountMaxMinor ?? null) as Minor | null
                          }
                          onChange={(value) =>
                            patchDraft({
                              amountMaxMinor: value ?? undefined,
                              amountCurrency,
                            })
                          }
                        />
                        <Select
                          label={t('common.currency')}
                          selectedKey={amountCurrency}
                          onSelectionChange={(key) =>
                            patchDraft({ amountCurrency: String(key) })
                          }
                        >
                          {currencyOptions.map((code) => (
                            <SelectItem key={code} id={code} textValue={code}>
                              {code}
                            </SelectItem>
                          ))}
                        </Select>
                      </div>
                    </fieldset>

                    <Select
                      label={t('transactions.filter.receipt')}
                      selectedKey={
                        panelDraft.hasAttachment === undefined
                          ? 'any'
                          : String(panelDraft.hasAttachment)
                      }
                      onSelectionChange={(key) =>
                        patchDraft({
                          hasAttachment:
                            key === 'any' ? undefined : key === 'true',
                        })
                      }
                    >
                      <SelectItem id="any" textValue={t('common.all')}>
                        {t('common.all')}
                      </SelectItem>
                      <SelectItem
                        id="true"
                        textValue={t('transactions.chip.withReceipt')}
                      >
                        {t('transactions.chip.withReceipt')}
                      </SelectItem>
                      <SelectItem
                        id="false"
                        textValue={t('transactions.chip.withoutReceipt')}
                      >
                        {t('transactions.chip.withoutReceipt')}
                      </SelectItem>
                    </Select>
                  </DialogBody>
                  <DialogFooter>
                    <Button
                      variant="ghost"
                      onPress={() => {
                        // Ordering is not a filter, so "Reset filters" does not touch it.
                        onViewChange({}, sort)
                        close()
                      }}
                    >
                      {t('transactions.filter.reset')}
                    </Button>
                    <Button
                      variant="primary"
                      onPress={() => {
                        onViewChange(prune(panelDraft), sortDraft)
                        close()
                      }}
                    >
                      {t('action.apply')}
                    </Button>
                  </DialogFooter>
                </>
              )}
            </Dialog>
          </Modal>
        </DialogTrigger>

        {/* One action, two shapes. Below `md` it is a 44px icon target on the same row as the
            search box rather than a full-width block that pushes the ledger down a screen; from
            `md` up it carries its words. Only one of the two is ever displayed, so the tab order
            gains nothing. */}
        <Button
          variant="primary"
          shape="icon"
          className="md:hidden"
          aria-label={t('transactions.create')}
          icon={<Plus />}
          onPress={onCreate}
        />
        <Button
          variant="primary"
          className="hidden md:inline-flex"
          icon={<Plus />}
          onPress={onCreate}
        >
          {t('transactions.create')}
        </Button>
      </div>

      {chips.length === 0 ? null : (
        <ul
          aria-label={t('transactions.filter.activeLabel')}
          className="flex flex-wrap items-center gap-1.5"
        >
          {chips.map((chip) => (
            <li key={chip.id}>
              <Button
                variant="subtle"
                size="sm"
                shape="pill"
                iconAfter={<X />}
                aria-label={t('transactions.filter.remove', {
                  name: chip.label,
                })}
                onPress={() => onViewChange(chip.next, sort)}
              >
                {chip.label}
              </Button>
            </li>
          ))}
          <li>
            <Button
              variant="link"
              size="sm"
              onPress={() => onViewChange({}, sort)}
            >
              {t('action.clearAll')}
            </Button>
          </li>
        </ul>
      )}
    </div>
  )
}
