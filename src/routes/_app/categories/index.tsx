import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { z } from 'zod'

import { ErrorPanel } from '#/components/app/accounts'
import {
  CategoryEmptyState,
  CategoryTree,
  CategoryTreeSkeleton,
} from '#/components/app/categories'
import { Button, Switch, toast } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { CATEGORY_KINDS } from '#/server/db/schema'
import {
  archiveCategory,
  deleteCategory,
  listCategories,
  moveCategory,
  reorderCategories,
  restoreCategory,
} from '#/server/fns/categories'

import { useDataRefresh } from '../-lib/refresh'
import { ConfirmDialog } from '../accounts/-ui/confirm-dialog'
import { CategoryFormDialog } from './-ui/category-form-dialog'

import type { CategoryMove, CategoryTreeItem } from '#/components/app/categories'
import type { CategoryKind } from '#/server/db/schema'
import type { Category } from '#/server/repos/categories'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/categories` — the two-level tree.
 *
 * ## Why the archived filter is in the address
 *
 * `?status=all` is a bookmark, a back button and a link somebody can send. Held in `useState` all
 * three would lie: the back button would leave the page rather than the filter, and a reload would
 * drop the reader into a different view from the one they were reading.
 *
 * ## One move, one or two writes, and the route owns that
 *
 * The tree hands back a {@link CategoryMove} - a row, its new parent, and the complete order of the
 * run it lands in. A move inside one run is a single `reorderCategories`. A move between runs is
 * `moveCategory` followed by `reorderCategories`, because `moveCategory` re-files the row but does
 * not renumber the siblings around it, and leaving two rows sharing a position is how a list starts
 * reordering itself on reload.
 *
 * ## The depth-cap refusal is announced, not just drawn
 *
 * Every refusal lands in a `role="alert"` region above the tree as well as in a toast. A toast is
 * dismissed on a timer; the sentence that explains why a category cannot go where somebody just
 * put it has to stay until they have read it, and has to reach a screen reader without them going
 * looking for it.
 */

const searchSchema = z.object({
  status: z.enum(['active', 'all']).default('active'),
})

export const Route = createFileRoute('/_app/categories/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) =>
    listCategories({ data: { includeArchived: deps.status === 'all' } }),
  pendingComponent: CategoryTreeSkeleton,
  errorComponent: CategoriesError,
  head: ({ matches }) => pageHead(matches, (t) => t('categories.title')),
  component: CategoriesRoute,
})

function CategoriesError({ error, reset }: { error: Error; reset: () => void }) {
  const t = useTranslate()
  return (
    <ErrorPanel
      title={t('categories.error.title')}
      body={t('empty.error.body')}
      detail={error.message}
      onRetry={reset}
    />
  )
}

/** What the route is currently asking the reader to confirm, if anything. */
type Pending =
  | { kind: 'none' }
  | { kind: 'form'; category: Category | null; parentId?: string | null }
  | { kind: 'archive'; category: Category }
  | { kind: 'delete'; category: Category }

function CategoriesRoute() {
  const t = useTranslate()
  const categories = Route.useLoaderData()
  const { status } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  const [pending, setPending] = useState<Pending>({ kind: 'none' })
  // The last server refusal, in the server's own words. Cleared by the next successful write.
  const [refusal, setRefusal] = useState<string | null>(null)
  const close = () => setPending({ kind: 'none' })

  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])

  const rows = categories.map(toTreeItem)
  const parents = categories
    .filter((row) => row.parentId === null)
    .map((row) => ({ id: row.id, name: row.name }))
  const byId = new Map(categories.map((row) => [row.id, row]))

  function withRefusal(work: () => Promise<unknown>) {
    void work().then(
      () => {
        setRefusal(null)
        refresh()
      },
      (error: unknown) => {
        setRefusal(error instanceof Error ? error.message : String(error))
      },
    )
  }

  function applyMove(move: CategoryMove) {
    const current = byId.get(move.id)
    if (current === undefined) return
    withRefusal(async () => {
      if (current.parentId !== move.parentId) {
        await moveCategory({ data: { id: move.id, parentId: move.parentId } })
      }
      await reorderCategories({ data: { ids: [...move.orderedIds] } })
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title font-bold text-ink">
            {t('categories.title')}
          </h1>
          <p className="mt-1 text-body text-ink-2">{t('categories.subtitle')}</p>
        </div>
        <Button
          variant="primary"
          icon={<Plus aria-hidden="true" />}
          onPress={() => setPending({ kind: 'form', category: null })}
        >
          {t('categories.create')}
        </Button>
      </header>

      {/*
        Assertive, because it is the answer to something the reader just did, and a polite region
        would queue behind the tree's own drag announcements and arrive after they have moved on.
      */}
      <div role="alert" aria-live="assertive">
        {refusal === null ? null : (
          <ErrorPanel
            title={t('categories.move.refused')}
            body={t('categories.move.refused.body')}
            detail={refusal}
          />
        )}
      </div>

      {categories.length === 0 && status === 'active' ? (
        <CategoryEmptyState
          onCreate={() => setPending({ kind: 'form', category: null })}
        />
      ) : (
        <>
          <Switch
            isSelected={status === 'all'}
            onChange={(showArchived) =>
              void navigate({
                search: { status: showArchived ? 'all' : 'active' },
              })
            }
          >
            {t('categories.filter.showArchived')}
          </Switch>

          <CategoryTree
            categories={rows}
            onEdit={(id) => {
              const category = byId.get(id)
              if (category !== undefined) setPending({ kind: 'form', category })
            }}
            onAddChild={(id) =>
              setPending({ kind: 'form', category: null, parentId: id })
            }
            onArchive={(id) => {
              const category = byId.get(id)
              if (category !== undefined) setPending({ kind: 'archive', category })
            }}
            onRestore={(id) =>
              withRefusal(async () => {
                await restoreCategory({ data: { categoryId: id } })
                toast.success(t('categories.toast.restored'))
              })
            }
            onDelete={(id) => {
              const category = byId.get(id)
              if (category !== undefined) setPending({ kind: 'delete', category })
            }}
            onMove={applyMove}
          />
        </>
      )}

      {pending.kind === 'form' ? (
        <CategoryFormDialog
          key={pending.category?.id ?? `new-${pending.parentId ?? 'root'}`}
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          category={pending.category}
          initialParentId={pending.parentId ?? null}
          parentOptions={parents}
          onSaved={(saved, mode) => {
            toast.success(
              t(
                mode === 'created'
                  ? 'categories.toast.created'
                  : 'categories.toast.updated',
                { name: saved.name },
              ),
            )
            setRefusal(null)
            close()
            refresh()
          }}
        />
      ) : null}

      {pending.kind === 'archive' ? (
        <ConfirmDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) close()
          }}
          title={t('categories.archive.title', { name: pending.category.name })}
          body={t('categories.archive.body')}
          confirmLabel={t('action.archive')}
          errorTitle={t('categories.error.title')}
          errorBody={t('empty.error.body')}
          onConfirm={async () => {
            const name = pending.category.name
            await archiveCategory({ data: { categoryId: pending.category.id } })
            toast.success(t('categories.toast.archived', { name }))
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
          title={t('categories.delete.title', { name: pending.category.name })}
          body={t('categories.delete.body')}
          confirmLabel={t('action.delete')}
          errorTitle={t('categories.delete.refused')}
          errorBody={t('categories.delete.refused.body')}
          onConfirm={async () => {
            const name = pending.category.name
            await deleteCategory({ data: { categoryId: pending.category.id } })
            toast.success(t('categories.toast.deleted', { name }))
            close()
            refresh()
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * A stored row as the tree reads it.
 *
 * `kind` is a `text` column with a CHECK behind it rather than a typed enum, so it arrives as a
 * `string`. Narrowing it here — with a visible fallback rather than a cast — means a row written by
 * a future migration renders as an expense instead of crashing the page.
 */
function toTreeItem(row: Category): CategoryTreeItem {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    kind: isKind(row.kind) ? row.kind : 'expense',
    parentId: row.parentId,
    isSystem: row.isSystem,
    isArchived: row.archivedAt !== null,
  }
}

function isKind(value: string): value is CategoryKind {
  return (CATEGORY_KINDS as ReadonlyArray<string>).includes(value)
}
