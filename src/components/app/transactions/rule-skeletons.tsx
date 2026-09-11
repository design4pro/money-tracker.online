import { Card, Skeleton } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The loading pictures for the three rule screens.
 *
 * All three declared nothing, and all three wait on `loadTransactionReference` — every account,
 * category, payee and tag in the workspace — so they are among the slowest loaders in the product
 * and the ones most likely to be reached by somebody who has just pressed a link from the list.
 *
 * They live here rather than beside the routes for one practical reason: `vitest.config.ts` gives
 * the `server` project only the `.ts` tests under `src/routes`, and `ui` only `src/components` and
 * `src/lib` — so a component written under `src/routes` cannot be asserted at all. Here the `ui`
 * project renders them, which is what makes the announcement contract in
 * `docs/STATE-INVENTORY.md` §4 — one `status` region, one sentence, every bar `aria-hidden` — a
 * test rather than a convention.
 */

const RULE_ROWS = 5

/**
 * The `/transactions/rules` pending view: the heading and its action, then five rule rows.
 *
 * Each row reserves what a rule row actually carries — the drag handle, the name, the match count
 * and the enabled switch — because this list is reorderable by dragging, and a list that changes
 * height as it loads moves the row somebody was aiming at.
 */
export function RulesListSkeleton() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {t('rules.list.loading')}
      </p>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 grow basis-72 space-y-2">
          <Skeleton shape="block" className="h-8 w-32 rounded-md" />
          <Skeleton shape="text" className="h-3 w-full max-w-prose" />
        </div>
        <Skeleton shape="block" className="h-10 w-28 rounded-md" />
      </div>

      <ul className="rounded-lg border border-border-subtle bg-surface">
        {Array.from({ length: RULE_ROWS }, (_, index) => (
          <li
            key={index}
            className="flex items-center gap-2.5 border-b border-border-subtle px-3 py-3 last:border-b-0"
          >
            <Skeleton className="size-5 shrink-0 rounded-sm" />
            <Skeleton className="h-3.5 min-w-0 flex-1 basis-48" />
            <Skeleton className="h-3 w-20 shrink-0" />
            <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The `/transactions/rules/new` and `/transactions/rules/$ruleId` pending view.
 *
 * The editor's own frame: the title beside cancel and save, the sentence card that says the rule in
 * words, then the form. The sentence card is drawn even though it will be empty on `/new`, because
 * it is present on both screens the moment the editor renders.
 */
export function RuleEditorSkeleton() {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {t('rules.editor.loading')}
      </p>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <Skeleton shape="block" className="h-8 w-48 rounded-md" />
        <div className="flex items-center gap-2">
          <Skeleton shape="block" className="h-10 w-24 rounded-md" />
          <Skeleton shape="block" className="h-10 w-28 rounded-md" />
        </div>
      </div>

      <Card className="flex flex-col gap-1">
        <Skeleton shape="text" className="h-3 w-24" />
        <Skeleton shape="text" className="h-4 w-full max-w-prose" />
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Skeleton shape="block" className="h-16 flex-1 rounded-md" />
          <Skeleton shape="block" className="h-16 flex-1 rounded-md" />
        </div>
        <Skeleton shape="block" className="h-24 w-full rounded-md" />
        <Skeleton shape="block" className="h-24 w-full rounded-md" />
      </Card>
    </div>
  )
}
