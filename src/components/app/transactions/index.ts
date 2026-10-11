/**
 * The transactions surface, as one import.
 *
 * Everything here is **props in, callbacks out**. Nothing in this directory fetches, and nothing
 * imports from `src/server` — not even a type. That is the same rule `src/components/ui` keeps, one
 * layer up, and for the same reason: the ledger is the screen most worth testing, and a component
 * that only renders inside a route with a session and a D1 binding is a component nobody writes a
 * test for. The route is where a repository row becomes a {@link LedgerRow}.
 */

export {
  AmountText,
  BalanceAmount,
  ConvertedAmount,
  NetAmount,
} from './amount-text'
export type {
  AmountTextProps,
  BalanceAmountProps,
  ConvertedAmountProps,
  NetAmountProps,
} from './amount-text'

export { BulkActions } from './bulk-actions'
export type { BulkActionsProps } from './bulk-actions'

export { NO_SAVE_FAILURE, saveFailureOf } from './booking-refusal'
export type { SaveFailure } from './booking-refusal'

export { ConfirmDeleteDialog } from './confirm-delete-dialog'
export type { ConfirmDeleteDialogProps } from './confirm-delete-dialog'

export { DetailSummary } from './detail-summary'
export type { DetailSummaryProps } from './detail-summary'

export { ExpectationGroupView } from './expectation-group'
export type { ExpectationGroupProps } from './expectation-group'

export { FilterBar } from './filter-bar'
export type { FilterBarProps } from './filter-bar'

export {
  PAYMENT_METHOD_KEY,
  countActiveFilters,
  describeFilters,
  isSameFilterView,
} from './filter-chips'
export type { FilterChip } from './filter-chips'

export {
  HEADER_ROW,
  columnIndexFor,
  columnsFor,
  groupByDay,
  nextPosition,
  rowHeightFor,
  samePosition,
} from './grid-model'
export type {
  CellPosition,
  DayGrouping,
  LedgerColumn,
  NavigationKey,
} from './grid-model'

export {
  TransactionListError,
  TransactionListSkeleton,
  TransactionsEmpty,
  TransactionsNoMatch,
} from './list-states'
export type {
  NoMatchProps,
  TransactionListErrorProps,
  TransactionsEmptyProps,
} from './list-states'

export { RuleEditorSkeleton, RulesListSkeleton } from './rule-skeletons'

export { KeyboardShortcuts } from './keyboard-shortcuts'

export { ListSummary } from './list-summary'
export type { ListSummaryProps } from './list-summary'

export { TransactionsModeSwitch } from './mode-switch'
export type {
  TransactionsMode,
  TransactionsModeSwitchProps,
} from './mode-switch'

export {
  TransactionForm,
  emptyFormValues,
  validateForm,
} from './transaction-form'
export type {
  RefusedBooking,
  TransactionFormErrors,
  TransactionFormProps,
  TransactionFormValues,
} from './transaction-form'

export { TransactionList } from './transaction-list'
export type { TransactionListProps } from './transaction-list'

export { TransactionRow } from './transaction-row'
export type {
  TransactionRowActions,
  TransactionRowProps,
} from './transaction-row'

export {
  DEFAULT_LEDGER_SORT,
  LEDGER_DIRECTIONS,
  LEDGER_PAYMENT_METHODS,
  LEDGER_SORT_FIELDS,
  LEDGER_TRANSFER_KINDS,
  NO_FILTERS,
  emptyReference,
  hasExpectationContent,
  nameIndex,
} from './types'
export type {
  AccountOption,
  CategoryOption,
  ExpectationGroup,
  ExpectationRow,
  LedgerDirection,
  LedgerEntry,
  LedgerFilters,
  LedgerPaymentMethod,
  LedgerRow,
  LedgerSort,
  LedgerSortField,
  LedgerTotals,
  LedgerTransferKind,
  NamedOption,
  TransactionReference,
} from './types'
