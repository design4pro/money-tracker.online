import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useDragAndDrop } from 'react-aria-components'

import { ErrorPanel } from '#/components/app/accounts'
import {
  Badge,
  Button,
  EmptyState,
  GridList,
  GridListItem,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  Switch,
  toast,
} from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import {
  deleteRule,
  loadRules,
  reorderRules,
  setRuleActive,
  updateRule,
} from '#/server/fns/rules'
import {
  readPausedReason,
  replaceRuleReference,
} from '#/server/rules/integrity'

import { useDataRefresh } from '../../-lib/refresh'
import { ConfirmDialog } from '../../accounts/-ui/confirm-dialog'
import { loadTransactionReference } from '../-server/list'
import { ruleSentence } from './-lib/sentence'
import { PausedBanner } from './-ui/paused-banner'

import type { Rule } from '#/server/repos/rules'
import { pageHead } from '#/routes/-lib/page-title'
import type { PausedRefType } from './-ui/paused-banner'

/**
 * `/transactions/rules` — every rule, in the order it runs.
 *
 * ---------------------------------------------------------------------------
 * ORDER IS THE DATA, SO REORDERING HAS TWO PATHS AND NEITHER IS THE FALLBACK
 * ---------------------------------------------------------------------------
 *
 * Rules apply cumulatively and the later one wins, so the order of this list decides outcomes more
 * directly than any other ordering in the product. A drag-only reorder is unusable with a keyboard,
 * unreachable with a switch and painful on a phone — so every gesture the pointer can perform is
 * also a menu item: _Move up_, _Move down_, _Move to top_, _Move to bottom_. Both paths send the
 * **whole order** through `reorderRules`, never a single-step move: two concurrent single-step moves
 * can interleave into an order neither person asked for. `category-tree.tsx` solves the same problem
 * the same way and this follows it deliberately rather than inventing a second pattern.
 *
 * A menu item that would change nothing is **disabled**, which is also what tells somebody at the
 * top of the list that they are at the top of the list.
 *
 * ---------------------------------------------------------------------------
 * EACH ROW READS AS ITS OWN SENTENCE
 * ---------------------------------------------------------------------------
 *
 * A rule's name is what its author called it, which is not the same thing as what it does. The row
 * carries both: the name, and underneath it the same sentence the editor renders, built by the same
 * `-lib/sentence.ts`. Six rules whose names are all "Groceries 2" are still tellable apart.
 *
 * ---------------------------------------------------------------------------
 * THE EMPTY STATE HAS TWO BRANCHES AND THE SERVER PICKS
 * ---------------------------------------------------------------------------
 *
 * `OPEN-1` — whether automation is a paid module — is unresolved, and the plan resolver is not
 * installed yet: `repos/base.ts` ships a permissive default and there is no read of an entitlement
 * anywhere in the product. So this screen does not guess at one. The empty state offers the rule
 * that is very probably allowed, and the **create route** carries the locked branch, shown when
 * `createRule` answers `FEATURE_LOCKED` — the only place the answer actually exists today. That is
 * the honest half of the plan's *ship both branches*: the copy is written, in both locales, and it
 * appears the moment a resolver is installed that refuses. What is deliberately **not** here is a
 * disabled button that explains nothing.
 */
export const Route = createFileRoute('/_app/transactions/rules/')({
  loader: async () => {
    const [rules, reference] = await Promise.all([
      loadRules(),
      loadTransactionReference(),
    ])
    return { rules, reference }
  },
  errorComponent: RulesListError,
  head: ({ matches }) => pageHead(matches, (t) => t('rules.title')),
  component: RulesListRoute,
})

function RulesListError({
  error,
  reset,
}: {
  readonly error: Error
  readonly reset: () => void
}) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('rules.error.title')}
      body={t('rules.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

function RulesListRoute() {
  const t = useTranslate()
  const locale = useLocale()
  const { rules, reference } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  const [pendingDelete, setPendingDelete] = useState<Rule | null>(null)
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null)

  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  /** The live rows a paused reference can be pointed at, by the kind it was. */
  function replacementsFor(refType: PausedRefType) {
    switch (refType) {
      case 'account':
        return reference.accounts
      case 'account_group':
        return reference.accountGroups
      case 'category':
        return reference.categories
      case 'tag':
        return reference.tags
      case 'payee':
        return reference.payees
    }
  }

  async function repair(
    rule: Rule,
    refType: PausedRefType,
    fromId: string,
    toId: string,
  ) {
    setBusyRuleId(rule.id)
    try {
      const next = replaceRuleReference(
        {
          name: rule.name,
          matchMode: rule.matchMode,
          // `Rule` holds these frozen; `RuleDefinition` wants them mutable. Copying is the
          // honest conversion — casting the readonly away would let a later edit mutate the row
          // this list is still rendering from.
          conditions: [...rule.conditions],
          actions: [...rule.actions],
          runOn: [...rule.runOn],
        },
        refType,
        fromId,
        toId,
      )
      await updateRule({ data: { ruleId: rule.id, patch: next } })
      toast.success(t('rules.paused.resumed'))
      refresh()
    } catch {
      toast.error(t('rules.toast.failed'))
    } finally {
      setBusyRuleId(null)
    }
  }

  async function removePaused(ruleId: string) {
    setBusyRuleId(ruleId)
    try {
      await deleteRule({ data: { ruleId } })
      toast.success(t('rules.toast.deleted'))
      refresh()
    } catch {
      toast.error(t('rules.toast.failed'))
    } finally {
      setBusyRuleId(null)
    }
  }

  const names = {
    accounts: new Map(reference.accounts.map((o) => [o.id, o.name])),
    accountGroups: new Map(reference.accountGroups.map((o) => [o.id, o.name])),
    categories: new Map(reference.categories.map((o) => [o.id, o.name])),
    tags: new Map(reference.tags.map((o) => [o.id, o.name])),
    payees: new Map(reference.payees.map((o) => [o.id, o.name])),
  }

  async function applyOrder(orderedIds: ReadonlyArray<string>) {
    try {
      await reorderRules({ data: { ids: [...orderedIds] } })
      toast.success(t('rules.toast.reordered'))
      refresh()
    } catch {
      toast.error(t('rules.toast.failed'))
    }
  }

  const { dragAndDropHooks } = useDragAndDrop({
    // The payload is the id and nothing else: a drop means "this rule went there", and a richer
    // payload would be a second source of truth about a row the list already holds.
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    getDropOperation: () => 'move',
    onReorder(event) {
      const id = [...event.keys].map(String)[0]
      const target = String(event.target.key)
      const without = rules
        .map((rule) => rule.id)
        .filter((candidate) => candidate !== id)
      const at = without.indexOf(target)
      if (at === -1) return
      const index = event.target.dropPosition === 'before' ? at : at + 1
      void applyOrder([...without.slice(0, index), id, ...without.slice(index)])
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        {/* The heading states its own measure, so the actions decide the wrap rather than
            the subtitle's ideal line - see `recurring/index.tsx`. */}
        <div className="min-w-0 grow basis-72">
          <h1 className="text-title font-bold text-ink">{t('rules.title')}</h1>
          <p className="mt-1 text-body text-ink-2">{t('rules.subtitle')}</p>
        </div>
        <Button
          variant="primary"
          icon={<Plus aria-hidden="true" />}
          onPress={() => void navigate({ to: '/transactions/rules/new' })}
        >
          {t('rules.new')}
        </Button>
      </header>

      {/*
        The paused-rule banners sit above the list and below the heading, so a person meets the
        explanation before the row it is about. One banner per paused rule rather than one summary:
        each pause has its own cause and its own repair, and a combined banner could only link to
        the list it is already sitting on.

        Replacing is one write. `updateRule` clears `paused_reason` unconditionally, because the
        edit that rewrote the dead reference *is* the resolution — so this does not clear the pause
        itself, and there is no window where the reference is fixed and the warning still shows.

        `readPausedReason` and `replaceRuleReference` both come from `server/rules/integrity`, which
        owns the stored blob's shape and knows where an id can hide in a definition. Neither is
        re-implemented here; a second parser or a second traversal is a second thing to get wrong.
      */}
      {rules.map((rule) => {
        const paused = readPausedReason(rule.pausedReason)
        if (paused === null) return null
        return (
          <PausedBanner
            key={rule.id}
            ruleId={rule.id}
            ruleName={rule.name}
            refType={paused.ref_type}
            label={paused.label}
            pausedAt={paused.at}
            timeZone={timeZone}
            locale={locale}
            t={t}
            replacements={replacementsFor(paused.ref_type)}
            isBusy={busyRuleId === rule.id}
            onReplace={(_ruleId, replacementId) => {
              void repair(rule, paused.ref_type, paused.ref_id, replacementId)
            }}
            onDelete={(ruleId) => void removePaused(ruleId)}
          />
        )
      })}

      {rules.length === 0 ? (
        <EmptyState
          title={t('rules.empty.title')}
          description={t('rules.empty.body')}
          action={
            <Button
              variant="primary"
              icon={<Plus aria-hidden="true" />}
              onPress={() => void navigate({ to: '/transactions/rules/new' })}
            >
              {t('rules.new')}
            </Button>
          }
        />
      ) : (
        <GridList
          aria-label={t('rules.list.label')}
          selectionMode="none"
          items={rules}
          dragAndDropHooks={dragAndDropHooks}
          dependencies={[rules]}
        >
          {(rule: Rule) => (
            <GridListItem
              id={rule.id}
              textValue={rule.name}
              actions={
                <RuleRowMenu
                  rule={rule}
                  rules={rules}
                  onEdit={() =>
                    void navigate({
                      to: '/transactions/rules/$ruleId',
                      params: { ruleId: rule.id },
                    })
                  }
                  onDelete={() => setPendingDelete(rule)}
                  onOrder={applyOrder}
                />
              }
            >
              {/*
                The match count and the switch take a second line before they take the name's
                width. Both are `shrink-0` and the name is not, so on a phone the row spent its
                whole deficit on the one thing that identifies the rule and printed `Paliwo n…`
                beside a `Matches:` label that reads the same on every row. `basis-48` is the
                measure the name asks for; where it does not fit beside them, they wrap.
              */}
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
                <Button
                  slot="drag"
                  variant="ghost"
                  shape="icon"
                  size="sm"
                  label={t('rules.drag.label', { name: rule.name })}
                  icon={<GripVertical aria-hidden="true" />}
                />
                <div className="min-w-0 flex-1 basis-48">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-label text-ink">
                      {rule.name}
                    </span>
                    {rule.pausedReason === null ? null : (
                      <Badge tone="warning" size="sm">
                        {t('rules.row.paused')}
                      </Badge>
                    )}
                    {rule.isActive ? null : (
                      <Badge tone="neutral" size="sm">
                        {t('rules.row.off')}
                      </Badge>
                    )}
                    {rule.runOn.length === 0 ? (
                      <Badge tone="neutral" size="sm">
                        {t('rules.row.inert')}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-caption text-ink-2">
                    {ruleSentence(rule, { t, locale, names })}
                  </p>
                </div>
                <span className="shrink-0 text-caption tabular text-ink-2">
                  {t('rules.row.matches', { count: rule.matchCount })}
                </span>
                <Switch
                  aria-label={t('rules.row.active', { name: rule.name })}
                  isSelected={rule.isActive}
                  onChange={async (isActive) => {
                    try {
                      await setRuleActive({
                        data: { ruleId: rule.id, isActive },
                      })
                      toast.success(
                        t(
                          isActive
                            ? 'rules.toast.activated'
                            : 'rules.toast.deactivated',
                        ),
                      )
                      refresh()
                    } catch {
                      toast.error(t('rules.toast.failed'))
                    }
                  }}
                />
              </div>
            </GridListItem>
          )}
        </GridList>
      )}

      {pendingDelete === null ? null : (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null)
          }}
          title={t('rules.confirm.delete.title')}
          body={t('rules.confirm.delete.body')}
          confirmLabel={t('rules.confirm.delete.action')}
          isDestructive
          errorTitle={t('rules.toast.failed')}
          errorBody={t('rules.error.body')}
          onConfirm={async () => {
            await deleteRule({ data: { ruleId: pendingDelete.id } })
            toast.success(t('rules.toast.deleted'))
            setPendingDelete(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}

/**
 * The per-row menu: edit, the four ordering items, delete.
 *
 * The trigger is named after its rule — "Actions for Groceries" — because a list of identically
 * named "More" buttons makes a screen reader's element list unnavigable. Each ordering item sends
 * the whole order, computed here from the list the screen is already holding.
 */
function RuleRowMenu({
  rule,
  rules,
  onEdit,
  onDelete,
  onOrder,
}: {
  readonly rule: Rule
  readonly rules: ReadonlyArray<Rule>
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly onOrder: (ids: ReadonlyArray<string>) => Promise<void>
}) {
  const t = useTranslate()
  const ids = rules.map((row) => row.id)
  const index = ids.indexOf(rule.id)

  const steps = [
    { at: index - 1, label: t('action.moveUp'), icon: ChevronUp },
    { at: index + 1, label: t('action.moveDown'), icon: ChevronDown },
    { at: 0, label: t('rules.move.top'), icon: ArrowUpToLine },
    {
      at: ids.length - 1,
      label: t('rules.move.bottom'),
      icon: ArrowDownToLine,
    },
  ] as const

  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        shape="icon"
        size="sm"
        label={t('rules.row.actions', { name: rule.name })}
        icon={<MoreHorizontal aria-hidden="true" />}
      />
      <Popover placement="bottom end">
        <Menu>
          <MenuItem
            icon={<Pencil aria-hidden="true" />}
            onAction={onEdit}
            textValue={t('action.edit')}
          >
            {t('action.edit')}
          </MenuItem>

          <MenuSeparator />

          {steps.map(({ at, label, icon: Icon }) => (
            <MenuItem
              key={label}
              icon={<Icon aria-hidden="true" />}
              isDisabled={at < 0 || at >= ids.length || at === index}
              onAction={() => {
                const without = ids.filter((candidate) => candidate !== rule.id)
                void onOrder([
                  ...without.slice(0, at),
                  rule.id,
                  ...without.slice(at),
                ])
              }}
              textValue={label}
            >
              {label}
            </MenuItem>
          ))}

          <MenuSeparator />

          <MenuItem
            icon={<Trash2 aria-hidden="true" />}
            isDestructive
            onAction={onDelete}
            textValue={t('action.delete')}
          >
            {t('action.delete')}
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
