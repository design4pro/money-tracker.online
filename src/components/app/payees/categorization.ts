import { PAYEE_CATEGORIZATION_MODES } from '#/server/db/schema'

import type { MessageKey } from '#/lib/i18n'
import type { PayeeCategorizationMode } from '#/server/db/schema'

/**
 * The three answers to "what should this payee do to a transaction's category".
 *
 * Each option ships a one-line description as well as a label, because the difference between
 * _enforce_ and _hint_ is a difference in what happens to rows the person has already recorded -
 * turning `enforce` on re-files that payee's history - and a bare word cannot say that. The
 * descriptions are in the catalogue rather than hard-coded here so the Polish reads as Polish
 * rather than as a translation of an English label.
 */
export interface CategorizationModeCopy {
  readonly mode: PayeeCategorizationMode
  readonly labelKey: MessageKey
  readonly descriptionKey: MessageKey
}

const COPY: Record<
  PayeeCategorizationMode,
  Omit<CategorizationModeCopy, 'mode'>
> = {
  enforce: {
    labelKey: 'payees.mode.enforce',
    descriptionKey: 'payees.mode.enforce.help',
  },
  hint: {
    labelKey: 'payees.mode.hint',
    descriptionKey: 'payees.mode.hint.help',
  },
  off: {
    labelKey: 'payees.mode.off',
    descriptionKey: 'payees.mode.off.help',
  },
}

/**
 * The three modes in the order the form offers them: least intrusive first.
 *
 * Written out rather than sorted from `PAYEE_CATEGORIZATION_MODES`, because the schema tuple's
 * order is a database concern and this one is a reading order. `Record<PayeeCategorizationMode, …>`
 * above is what keeps them in step: a fourth mode in the schema is a compile error here.
 */
export const CATEGORIZATION_MODES: ReadonlyArray<CategorizationModeCopy> = [
  { mode: 'off', ...COPY.off },
  { mode: 'hint', ...COPY.hint },
  { mode: 'enforce', ...COPY.enforce },
]

export function isCategorizationMode(
  value: string,
): value is PayeeCategorizationMode {
  return (PAYEE_CATEGORIZATION_MODES as ReadonlyArray<string>).includes(value)
}
