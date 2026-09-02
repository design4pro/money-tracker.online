import { FolderTree } from 'lucide-react'

import { Button, EmptyState, Skeleton } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The category list before anything is in it.
 *
 * A workspace with no categories is a workspace that cannot answer "where did the money go", so
 * this is the first screen of real work rather than a notice about absence. The sentence names
 * what a category is for and the one button starts the only path out.
 */
export function CategoryEmptyState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslate()
  return (
    <EmptyState
      icon={<FolderTree aria-hidden="true" />}
      title={t('categories.empty.title')}
      description={t('categories.empty.body')}
      headingLevel={2}
      action={
        <Button variant="primary" onPress={onCreate}>
          {t('categories.create')}
        </Button>
      }
    />
  )
}

/**
 * Eight rows' worth of grey while the tree loads.
 *
 * Every `Skeleton` is `aria-hidden`; the region that owns the load says "Loading" once. Two of the
 * eight are indented, because a skeleton that does not resemble the thing it stands in for makes
 * the real content look like a layout jump when it arrives.
 */
export function CategoryTreeSkeleton() {
  const t = useTranslate()
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('categories.loading')}
      className="flex flex-col gap-1"
    >
      {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
        <div
          key={row}
          className={
            row % 4 === 1 || row % 4 === 2
              ? 'ms-6 flex items-center gap-3 rounded-md border border-border-subtle bg-surface px-3 py-3.5'
              : 'flex items-center gap-3 rounded-md border border-border-subtle bg-surface px-3 py-3.5'
          }
        >
          <Skeleton shape="circle" className="size-4" />
          <Skeleton shape="text" className="w-40" />
        </div>
      ))}
    </div>
  )
}
