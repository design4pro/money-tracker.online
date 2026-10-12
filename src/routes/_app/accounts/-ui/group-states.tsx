import { Folder, Plus } from 'lucide-react'

import { Button, EmptyState, Skeleton } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

/**
 * The groups screen before anything is in it.
 *
 * It says what a group is for and that it never touches a balance, because the likeliest reason to
 * be here is wondering whether grouping accounts changes the totals. The one button starts the
 * only way out.
 */
export function GroupEmptyState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslate()
  return (
    <EmptyState
      className="max-w-list"
      icon={<Folder aria-hidden="true" />}
      title={t('accounts.groups.empty.title')}
      description={t('accounts.groups.empty.body')}
      headingLevel={2}
      action={
        <Button
          variant="primary"
          icon={<Plus aria-hidden="true" />}
          onPress={onCreate}
        >
          {t('accounts.group.create')}
        </Button>
      }
    />
  )
}

/**
 * Three rows of grey while the groups load.
 *
 * Every `Skeleton` is `aria-hidden`; the region that owns the load says "Loading" once. The middle
 * row is indented, because a skeleton that does not resemble what replaces it makes the real tree
 * look like a layout jump, and it carries the same `max-w-list` cap for the same reason.
 */
export function GroupTreeSkeleton() {
  const t = useTranslate()
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('accounts.groups.loading')}
      className="flex max-w-list flex-col gap-1"
    >
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className={
            row === 1
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
