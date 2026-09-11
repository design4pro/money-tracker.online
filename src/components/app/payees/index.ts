/**
 * The payee surface's presentational half.
 *
 * Nothing here fetches. The list takes rows and reports what was pressed; the route is the only
 * place that knows a server function exists.
 */

export { PayeeAvatar } from './payee-avatar'
export type { PayeeAvatarProps } from './payee-avatar'

export { CATEGORIZATION_MODES, isCategorizationMode } from './categorization'
export type { CategorizationModeCopy } from './categorization'

export { PayeeList } from './payee-list'
export type { PayeeListItem, PayeeListProps } from './payee-list'

export {
  PayeeDetailSkeleton,
  PayeeEmptyState,
  PayeeListSkeleton,
} from './payee-states'
