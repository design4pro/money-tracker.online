import { useMemo } from 'react'
import { useDragAndDrop } from 'react-aria-components/useDragAndDrop'
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  FolderInput,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'

import {
  Badge,
  Button,
  GridList,
  GridListItem,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  SubmenuTrigger,
} from '#/components/ui'
import {
  dropMove,
  hasChildren,
  reparentMove,
  stepMove,
} from '#/components/app/tree'
import { useTranslate } from '#/lib/i18n'

import { CategoryIcon } from './icons'
import { CategorySwatch } from './category-swatch'

import type { ComponentType } from 'react'
import type { Key } from 'react-aria-components'
import type { Translate } from '#/lib/i18n'
import type { MoveStep } from '#/components/app/tree'

import type { CategoryMove, CategoryTreeItem } from './types'

/**
 * The two-level category tree, reorderable by drag **and** by keyboard.
 *
 * ## Both paths ship together, and neither is the fallback
 *
 * A drag-only reorder is unusable with a keyboard, unreachable with a switch and painful on a
 * phone. So every gesture the pointer can perform is also a menu item: _Move up_, _Move down_,
 * _Move to top_, _Move to bottom_ and _Move to…_, the last of which re-parents. Both paths produce
 * the same {@link CategoryMove} through the same pure functions in `#/components/app/tree`, so they cannot drift
 * apart - and a menu item that would change nothing is **disabled** rather than enabled and
 * silently doing nothing.
 *
 * React Aria's own drag and drop is used rather than a pointer library: it ships the keyboard drag
 * mode, the drop indicators and the live-region announcements, which is exactly the work that gets
 * skipped when a deadline arrives.
 *
 * ## One flat grid, indented, rather than nested lists
 *
 * The tree is two deep by construction, so a nested collection would buy a little visual structure
 * and cost the reader a second navigation model. One `GridList` in reading order - each parent
 * followed by its own children - keeps arrow-key travel linear, and a child row carries both a
 * visual indent and an explicit "inside <parent>" in its accessible name, so the structure survives
 * being read aloud.
 *
 * ## Colour sits beside the name, never behind it
 *
 * See {@link CategorySwatch}. The row is ordinary surface ink at 7:1 and the hue is a bounded shape
 * whose accessible name is the colour's word.
 */
export interface CategoryTreeProps {
  /** In tree order - each parent followed by its own children, as `listCategories` returns it. */
  readonly categories: ReadonlyArray<CategoryTreeItem>
  readonly onEdit: (id: string) => void
  readonly onAddChild: (id: string) => void
  readonly onArchive: (id: string) => void
  readonly onRestore: (id: string) => void
  readonly onDelete: (id: string) => void
  /** Applied by the route, which owns the server calls a move costs. */
  readonly onMove: (move: CategoryMove) => void
}

export function CategoryTree({
  categories,
  onEdit,
  onAddChild,
  onArchive,
  onRestore,
  onDelete,
  onMove,
}: CategoryTreeProps) {
  const t = useTranslate()

  const parents = useMemo(
    () => categories.filter((row) => row.parentId === null),
    [categories],
  )

  const { dragAndDropHooks } = useDragAndDrop({
    // The payload is the id and nothing else. A drop means "this row went there"; a richer payload
    // would be a second source of truth about a row the list is already holding.
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    // Between rows only. A drop *onto* a row would have to mean "nest inside it", and a target that
    // means two different things a few pixels apart is a gesture people fire by accident.
    getDropOperation: () => 'move',
    onReorder(event) {
      // One row moves at a time: the list has no selection mode, so a drag carries exactly the
      // row it started on.
      const id = [...event.keys].map(String)[0]
      const move = dropMove(
        categories,
        id,
        String(event.target.key),
        event.target.dropPosition === 'before' ? 'before' : 'after',
      )
      if (move !== null) onMove(move)
    },
  })

  return (
    <GridList
      aria-label={t('categories.tree.label')}
      selectionMode="none"
      items={categories}
      dragAndDropHooks={dragAndDropHooks}
      dependencies={[categories]}
    >
      {(row) => (
        <GridListItem
          id={row.id}
          textValue={accessibleName(row, categories, t)}
          className={row.parentId === null ? undefined : 'ms-6'}
          actions={
            <CategoryRowMenu
              row={row}
              categories={categories}
              parents={parents}
              onEdit={onEdit}
              onAddChild={onAddChild}
              onArchive={onArchive}
              onRestore={onRestore}
              onDelete={onDelete}
              onMove={onMove}
            />
          }
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <Button
              slot="drag"
              variant="ghost"
              shape="icon"
              size="sm"
              label={t('categories.drag.label', { name: row.name })}
              icon={<GripVertical aria-hidden="true" />}
            />
            {row.parentId === null ? null : (
              <CornerDownRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-ink-2"
              />
            )}
            <CategoryIcon
              name={row.icon}
              className="size-4 shrink-0 text-ink-2"
            />
            <CategorySwatch color={row.color} />
            <span className="truncate text-label text-ink">{row.name}</span>
            {/*
              The kind yields to the name on a phone. A `Badge` is `shrink-0` and a text span is
              not, so on a 328px row the seven fixed-width elements keep their size and the one
              element carrying the row's subject absorbs the whole deficit - which is how a child
              category comes to render as `C.`. `MONEY OUT` is also the same word on most of the
              column, so it is the cheapest thing on the row to stop painting. It is still
              *spoken*: the visually-hidden copy below `sm` keeps the fact in the accessibility
              tree at every width, and only one of the two is ever in the tree at once.
            */}
            <span className="sr-only sm:hidden">
              {t(KIND_LABELS[row.kind])}
            </span>
            <Badge tone="neutral" size="sm" className="max-sm:hidden">
              {t(KIND_LABELS[row.kind])}
            </Badge>
            {row.isSystem ? (
              <Badge tone="info" size="sm">
                {t('categories.badge.system')}
              </Badge>
            ) : null}
            {row.isArchived ? (
              <Badge tone="warning" size="sm">
                {t('common.archived')}
              </Badge>
            ) : null}
          </div>
        </GridListItem>
      )}
    </GridList>
  )
}

/** Each kind reads as a word, because income and expense are not a colour difference. */
const KIND_LABELS = {
  expense: 'categories.kind.expense',
  income: 'categories.kind.income',
  both: 'categories.kind.both',
} as const

/**
 * What the row is called when it is read aloud.
 *
 * A child row says which parent it is inside, because the indent that carries that fact visually
 * carries nothing at all to a screen reader, and "Groceries" alone in a list of forty is not a
 * location.
 */
function accessibleName(
  row: CategoryTreeItem,
  categories: ReadonlyArray<CategoryTreeItem>,
  t: Translate,
): string {
  if (row.parentId === null) return row.name
  const parent = categories.find(
    (candidate) => candidate.id === row.parentId,
  )?.name
  if (parent === undefined) return row.name
  return t('categories.tree.childOf', { name: row.name, parent })
}

interface RowMenuProps {
  readonly row: CategoryTreeItem
  readonly categories: ReadonlyArray<CategoryTreeItem>
  readonly parents: ReadonlyArray<CategoryTreeItem>
  readonly onEdit: (id: string) => void
  readonly onAddChild: (id: string) => void
  readonly onArchive: (id: string) => void
  readonly onRestore: (id: string) => void
  readonly onDelete: (id: string) => void
  readonly onMove: (move: CategoryMove) => void
}

/** The submenu key that means "no parent". A reserved string, never a category id. */
const TOP_LEVEL = '__top_level__'

/**
 * The per-row menu: edit, add a child, the four ordering items, _Move to…_, archive and delete.
 *
 * The trigger is named after its category - "Actions for Groceries" - because forty identically
 * named "More" buttons make a screen reader's element list unnavigable. Each ordering item is
 * disabled when it would change nothing, which is also what tells somebody at the top of a run that
 * they are at the top of a run.
 */
function CategoryRowMenu({
  row,
  categories,
  parents,
  onEdit,
  onAddChild,
  onArchive,
  onRestore,
  onDelete,
  onMove,
}: RowMenuProps) {
  const t = useTranslate()

  const steps: ReadonlyArray<{
    readonly step: MoveStep
    readonly label: string
    readonly icon: ComponentType<{ 'aria-hidden': 'true' }>
  }> = [
    { step: 'up', label: t('action.moveUp'), icon: ChevronUp },
    { step: 'down', label: t('action.moveDown'), icon: ChevronDown },
    { step: 'top', label: t('categories.move.top'), icon: ArrowUpToLine },
    {
      step: 'bottom',
      label: t('categories.move.bottom'),
      icon: ArrowDownToLine,
    },
  ]

  // A parent that still holds children cannot be nested inside another parent: the repository
  // refuses it, and offering a control that can only ever fail is worse than not offering it.
  const canBeNested = !hasChildren(categories, row.id)
  const destinations = parents.filter((candidate) => candidate.id !== row.id)

  function applyReparent(key: Key) {
    const move = reparentMove(
      categories,
      row.id,
      key === TOP_LEVEL ? null : String(key),
    )
    if (move !== null) onMove(move)
  }

  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        shape="icon"
        size="sm"
        label={t('categories.actions.label', { name: row.name })}
        icon={<MoreHorizontal aria-hidden="true" />}
      />
      <Popover placement="bottom end">
        <Menu>
          <MenuItem
            icon={<Pencil aria-hidden="true" />}
            onAction={() => onEdit(row.id)}
            textValue={t('action.edit')}
          >
            {t('action.edit')}
          </MenuItem>
          {row.parentId === null ? (
            <MenuItem
              icon={<Plus aria-hidden="true" />}
              onAction={() => onAddChild(row.id)}
              textValue={t('categories.createChild')}
            >
              {t('categories.createChild')}
            </MenuItem>
          ) : null}

          <MenuSeparator />

          {steps.map(({ step, label, icon: Icon }) => (
            <MenuItem
              key={step}
              icon={<Icon aria-hidden="true" />}
              isDisabled={stepMove(categories, row.id, step) === null}
              onAction={() => {
                const move = stepMove(categories, row.id, step)
                if (move !== null) onMove(move)
              }}
              textValue={label}
            >
              {label}
            </MenuItem>
          ))}

          <SubmenuTrigger>
            <MenuItem
              icon={<FolderInput aria-hidden="true" />}
              hasSubmenu
              textValue={t('action.moveTo')}
            >
              {t('action.moveTo')}
            </MenuItem>
            <Popover placement="end top">
              <Menu onAction={applyReparent}>
                <MenuItem
                  id={TOP_LEVEL}
                  isDisabled={row.parentId === null}
                  textValue={t('categories.parent.none')}
                >
                  {t('categories.parent.none')}
                </MenuItem>
                {destinations.map((parent) => (
                  <MenuItem
                    key={parent.id}
                    id={parent.id}
                    isDisabled={!canBeNested || row.parentId === parent.id}
                    textValue={parent.name}
                  >
                    {parent.name}
                  </MenuItem>
                ))}
              </Menu>
            </Popover>
          </SubmenuTrigger>

          <MenuSeparator />

          {row.isArchived ? (
            <MenuItem
              icon={<ArchiveRestore aria-hidden="true" />}
              onAction={() => onRestore(row.id)}
              textValue={t('action.unarchive')}
            >
              {t('action.unarchive')}
            </MenuItem>
          ) : (
            <MenuItem
              icon={<Archive aria-hidden="true" />}
              onAction={() => onArchive(row.id)}
              textValue={t('action.archive')}
            >
              {t('action.archive')}
            </MenuItem>
          )}
          <MenuItem
            icon={<Trash2 aria-hidden="true" />}
            isDestructive
            isDisabled={row.isSystem}
            onAction={() => onDelete(row.id)}
            textValue={t('action.delete')}
          >
            {t('action.delete')}
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
