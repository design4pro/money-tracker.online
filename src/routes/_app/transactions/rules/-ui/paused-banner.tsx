import { AlertTriangle, Trash2 } from 'lucide-react'

import { Badge, Button, Card, Select, SelectItem } from '#/components/ui'
import { formatDateTime } from '#/lib/i18n'

import type { Key } from 'react-aria-components'
import type { Locale, MessageKey, Translate } from '#/lib/i18n'

/**
 * The banner a paused rule wears, and the one screen on which it is resolved.
 *
 * ## A banner that only says "paused" is worse than no banner
 *
 * A rule pauses because something it named — a category, a tag, a payee, an account, an account
 * group — was deleted (`#/server/rules/integrity`). Telling somebody that and stopping there makes
 * them open the editor, read ten conditions and work out which id no longer resolves. So this says
 * three things and offers two actions: **what broke** (the kind, and the deleted row's own name,
 * captured at pause time because the row is gone by the time this renders), **when**, and then
 * **pick a replacement** — which resumes the rule in one step — or **delete this rule**.
 *
 * ## Warning, not danger
 *
 * The `warning` family, deliberately. A paused rule is recoverable and nothing has been lost;
 * spending the danger colour on it is how the danger colour stops meaning anything on the screen
 * where something really is about to be destroyed. The single `danger` control here is the delete.
 *
 * ## `role="status"`, not `role="alert"`
 *
 * On load this is not new information — the rule paused days ago — and an assertive live region
 * that interrupts a screen reader on every page load to re-announce old news is the fastest way to
 * teach somebody to ignore live regions. `status` is polite: it is announced when a banner appears
 * during the session (a rule pausing live), and it waits its turn on load.
 *
 * The replacement `Select` is labelled **with the rule's name**, so three paused rules give three
 * distinguishable controls rather than three fields all called "Replacement".
 *
 * ## It is self-contained
 *
 * No data fetching, no server import, no router. Everything it renders arrives as a prop and both
 * actions are callbacks, so the list route owns *what* a replacement means (rewriting the
 * condition or the action that named the missing row, which clears `paused_reason` because
 * `updateRule` clears it) and this owns saying so.
 */

/** The five kinds of row a rule can name. Mirrors `paused_reason.ref_type`. */
export type PausedRefType =
  'account' | 'account_group' | 'category' | 'payee' | 'tag'

/** One live row of the same kind, offered as the replacement. */
export interface PausedReplacementOption {
  readonly id: string
  readonly name: string
}

export interface PausedBannerProps {
  /** The paused rule. Passed back to both callbacks so a list can render many banners. */
  readonly ruleId: string
  /** The rule's own name. It labels the `Select`, so three banners are three named controls. */
  readonly ruleName: string
  /** What kind of row went missing. */
  readonly refType: PausedRefType
  /** The missing row's name as it was at pause time. The sweep records the id when it has no name. */
  readonly label: string
  /** `paused_reason.at` — an ISO-8601 instant. */
  readonly pausedAt: string
  /** The reader's timezone, so "when" is in the frame they live in. */
  readonly timeZone: string
  readonly locale: Locale
  readonly t: Translate
  /** Live rows of `refType` this rule could use instead. Empty is a state, not an error. */
  readonly replacements: ReadonlyArray<PausedReplacementOption>
  /** Both controls are disabled while the host is saving. */
  readonly isBusy?: boolean
  /** A replacement was chosen. The host rewrites the reference, which resumes the rule. */
  readonly onReplace: (ruleId: string, replacementId: string) => void
  readonly onDelete: (ruleId: string) => void
}

/**
 * One message per kind rather than one sentence with the kind slotted in.
 *
 * Polish inflects the adjective for the noun's gender — _usunięta kategoria_, _usunięty tag_,
 * _usunięte konto_ — so a shared sentence plus a translated noun cannot be written correctly in
 * both locales. Five keys is the honest cost of that.
 */
const MISSING_KEY: Readonly<Record<PausedRefType, MessageKey>> = {
  account: 'rules.paused.missing.account',
  account_group: 'rules.paused.missing.accountGroup',
  category: 'rules.paused.missing.category',
  payee: 'rules.paused.missing.payee',
  tag: 'rules.paused.missing.tag',
}

export function PausedBanner({
  ruleId,
  ruleName,
  refType,
  label,
  pausedAt,
  timeZone,
  locale,
  t,
  replacements,
  isBusy = false,
  onReplace,
  onDelete,
}: PausedBannerProps) {
  const pausedAtMs = Date.parse(pausedAt)

  return (
    <Card
      role="status"
      variant="plain"
      padding="sm"
      className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning-soft"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          tone="warning"
          size="sm"
          icon={<AlertTriangle aria-hidden="true" />}
        >
          {t('rules.paused.badge')}
        </Badge>
        <p className="text-label font-semibold text-ink">
          {t('rules.paused.title', { name: ruleName })}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-caption text-ink-2">{t('rules.paused.body')}</p>
        {/* The kind and the captured name — the sentence that saves opening the editor. */}
        <p className="text-caption font-medium text-warning">
          {t(MISSING_KEY[refType], { label })}
        </p>
        {/* An unparseable instant renders nothing rather than "Invalid Date": the pause is the
            message, and the timestamp is the detail. */}
        {Number.isNaN(pausedAtMs) ? null : (
          <p className="text-caption text-ink-2">
            {t('rules.paused.at', {
              when: formatDateTime(locale, pausedAtMs, timeZone, 'medium'),
            })}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Select
          className="sm:flex-1"
          label={t('rules.paused.replace.label', { name: ruleName })}
          placeholder={t('rules.paused.replace.placeholder')}
          // Nothing is preselected: there is no replacement yet, and a Select that opens on the
          // first option would let one keystroke resume a rule against a row nobody chose.
          selectedKey={null}
          isDisabled={isBusy || replacements.length === 0}
          description={
            replacements.length === 0
              ? t('rules.paused.replace.empty')
              : undefined
          }
          onSelectionChange={(key: Key | null) => {
            if (key === null) return
            onReplace(ruleId, String(key))
          }}
        >
          {replacements.map((option) => (
            <SelectItem key={option.id} id={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </Select>

        <Button
          variant="danger"
          size="sm"
          isDisabled={isBusy}
          onPress={() => {
            onDelete(ruleId)
          }}
        >
          <Trash2 aria-hidden="true" />
          {t('rules.paused.delete')}
        </Button>
      </div>
    </Card>
  )
}
