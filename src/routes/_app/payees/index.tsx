import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Plus, X } from 'lucide-react'
import { z } from 'zod'

import { ErrorPanel } from '#/components/app/accounts'
import {
  PayeeEmptyState,
  PayeeList,
  PayeeListSkeleton,
} from '#/components/app/payees'
import {
  Button,
  Disclosure,
  Form,
  SearchField,
  TextField,
  toast,
} from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { listCategories } from '#/server/fns/categories'
import {
  addIgnoredName,
  deletePayee,
  listIgnoredNames,
  listPayees,
  removeIgnoredName,
} from '#/server/fns/payees'

import { useDataRefresh } from '../-lib/refresh'
import { ConfirmDialog } from '../accounts/-ui/confirm-dialog'
import { MergePayeesDialog } from './-ui/merge-payees-dialog'
import { PayeeFormDialog } from './-ui/payee-form-dialog'

import type { PayeeListItem } from '#/components/app/payees'
import type { PayeeRow } from '#/server/db/schema'

/**
 * `/payees` — the list, the merge, and the strings the importer must ignore.
 *
 * ## The search term lives in the address
 *
 * `?q=zabka` is a bookmark and a link somebody can send, and the back button leaves the search
 * rather than the page. `loaderDeps` ties the loader to it, so the filtering happens where the
 * normalised match key lives - in the repository - rather than in a `filter()` here that would
 * fold diacritics differently from the thing that actually resolves an import.
 *
 * ## Ignored names sit on this page, not on their own
 *
 * They are the same decision as a payee, taken in the negative: "this string is never a payee".
 * Splitting them across two screens means somebody looking for why an import keeps inventing
 * "CARD PAYMENT" has to already know the answer to find the page that explains it.
 */

const searchSchema = z.object({
  q: z.string().trim().max(200).optional(),
})

export const Route = createFileRoute('/_app/payees/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }) => {
    const [payees, categories, ignored] = await Promise.all([
      listPayees({
        data: deps.q === undefined || deps.q === '' ? {} : { search: deps.q },
      }),
      listCategories({ data: { includeArchived: false } }),
      listIgnoredNames(),
    ])
    return { payees, categories, ignored }
  },
  pendingComponent: PayeeListSkeleton,
  errorComponent: PayeesError,
  component: PayeesRoute,
})

function PayeesError({ error, reset }: { error: Error; reset: () => void }) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('payees.error.title')}
      body={t('empty.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

type Pending =
  | { kind: 'none' }
  | { kind: 'form'; payee: PayeeRow | null }
  | { kind: 'merge'; payee: PayeeRow }
  | { kind: 'delete'; payee: PayeeRow }

function PayeesRoute() {
  const t = useTranslate()
  const { payees, categories, ignored } = Route.useLoaderData()
  const { q } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  const [pending, setPending] = useState<Pending>({ kind: 'none' })
  const close = () => setPending({ kind: 'none' })
  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])

  const categoryNames = new Map(categories.map((row) => [row.id, row.name]))
  const byId = new Map(payees.map((entry) => [entry.payee.id, entry.payee]))
  const rows: ReadonlyArray<PayeeListItem> = payees.map((entry) => ({
    id: entry.payee.id,
    name: entry.payee.name,
    initials: entry.payee.logoInitials,
    color: entry.payee.logoColor,
    aliasCount: entry.aliasCount,
    mode: modeOf(entry.payee.categorizationMode),
    categoryName:
      entry.payee.defaultCategoryId === null
        ? null
        : (categoryNames.get(entry.payee.defaultCategoryId) ?? null),
  }))

  const searchTerm = q ?? ''

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title font-bold text-ink">{t('payees.title')}</h1>
          <p className="mt-1 text-body text-ink-2">{t('payees.subtitle')}</p>
        </div>
        <Button
          variant="primary"
          icon={<Plus aria-hidden="true" />}
          onPress={() => setPending({ kind: 'form', payee: null })}
        >
          {t('payees.create')}
        </Button>
      </header>

      <div className="max-w-sm">
        <SearchField
          label={t('payees.search.label')}
          placeholder={t('payees.search.placeholder')}
          clearLabel={t('action.clear')}
          value={searchTerm}
          onChange={(value) =>
            void navigate({
              search: value.trim() === '' ? {} : { q: value },
              replace: true,
            })
          }
        />
      </div>

      {rows.length === 0 ? (
        <PayeeEmptyState
          isFiltered={searchTerm !== ''}
          onCreate={() => setPending({ kind: 'form', payee: null })}
        />
      ) : (
        <PayeeList
          payees={rows}
          onOpen={(id) =>
            void navigate({ to: '/payees/$payeeId', params: { payeeId: id } })
          }
          onEdit={(id) => {
            const payee = byId.get(id)
            if (payee !== undefined) setPending({ kind: 'form', payee })
          }}
          onMerge={(id) => {
            const payee = byId.get(id)
            if (payee !== undefined) setPending({ kind: 'merge', payee })
          }}
          onDelete={(id) => {
            const payee = byId.get(id)
            if (payee !== undefined) setPending({ kind: 'delete', payee })
          }}
        />
      )}

      <IgnoredNames
        names={ignored}
        onChanged={refresh}
      />

      {pending.kind === 'form' ? (
        <PayeeFormDialog
          key={pending.payee?.id ?? 'new'}
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          payee={pending.payee}
          categoryOptions={categories.map((row) => ({
            id: row.id,
            name: row.name,
          }))}
          onSaved={(saved, mode) => {
            toast.success(
              t(
                mode === 'created'
                  ? 'payees.toast.created'
                  : 'payees.toast.updated',
                { name: saved.name },
              ),
            )
            close()
            refresh()
          }}
        />
      ) : null}

      {pending.kind === 'merge' ? (
        <MergePayeesDialog
          key={pending.payee.id}
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          from={{ id: pending.payee.id, name: pending.payee.name }}
          candidates={payees
            .filter((entry) => entry.payee.id !== pending.payee.id)
            .map((entry) => ({ id: entry.payee.id, name: entry.payee.name }))}
          onMerged={(survivingName, mergedName) => {
            toast.success(
              t('payees.toast.merged', {
                from: mergedName,
                into: survivingName,
              }),
            )
            close()
            refresh()
          }}
        />
      ) : null}

      {pending.kind === 'delete' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          isDestructive
          title={t('payees.delete.title', { name: pending.payee.name })}
          body={t('payees.delete.body')}
          confirmLabel={t('action.delete')}
          errorTitle={t('payees.error.title')}
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            const name = pending.payee.name
            await deletePayee({ data: { payeeId: pending.payee.id } })
            toast.success(t('payees.toast.deleted', { name }))
            close()
            refresh()
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * The strings the importer must never turn into a payee.
 *
 * Collapsed by default: it is a maintenance list, not the reason somebody opened this page. Each
 * row's remove button is named after the string it removes, so a screen reader's element list is
 * fourteen different buttons rather than fourteen called "Remove".
 */
function IgnoredNames({
  names,
  onChanged,
}: {
  names: ReadonlyArray<{ readonly id: string; readonly normalizedName: string }>
  onChanged: () => void
}) {
  const t = useTranslate()
  const [draft, setDraft] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  async function add() {
    setFailure(null)
    try {
      await addIgnoredName({ data: { name: draft.trim() } })
      setDraft('')
      onChanged()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Disclosure
      title={t('payees.ignored.title')}
      headingLevel={2}
      className="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        <p className="text-body text-ink-2">{t('payees.ignored.body')}</p>

        <Form
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.trim() !== '') void add()
          }}
          className="flex items-end gap-2"
        >
          <TextField
            label={t('payees.ignored.add')}
            value={draft}
            onChange={setDraft}
            maxLength={200}
            className="flex-1"
          />
          <Button type="submit" variant="secondary" isDisabled={draft.trim() === ''}>
            {t('action.add')}
          </Button>
        </Form>

        {failure === null ? null : (
          <ErrorPanel
            title={t('payees.ignored.failed')}
            body={t('empty.error.body')}
            detail={failure}
          />
        )}

        {names.length === 0 ? (
          <p className="text-body text-ink-2">{t('payees.ignored.empty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {names.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-1 rounded-full border border-border-strong bg-surface ps-3 text-caption text-ink"
              >
                <span className="truncate">{row.normalizedName}</span>
                <Button
                  variant="ghost"
                  shape="icon"
                  size="sm"
                  label={t('payees.ignored.remove', {
                    name: row.normalizedName,
                  })}
                  icon={<X aria-hidden="true" />}
                  onPress={() => {
                    void removeIgnoredName({ data: { id: row.id } }).then(
                      onChanged,
                      (error: unknown) => {
                        setFailure(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        )
                      },
                    )
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Disclosure>
  )
}

/** The stored mode, narrowed with a visible fallback rather than a cast. */
function modeOf(value: string): PayeeListItem['mode'] {
  return value === 'enforce' || value === 'off' ? value : 'hint'
}
