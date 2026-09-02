import { useEffect, useState } from 'react'
import { CircleHelp } from 'lucide-react'

import { Button, Popover, PopoverDialog, PopoverTrigger } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'

import type { MessageKey } from '#/lib/i18n'

/**
 * The ledger's keyboard contract, on request rather than in the way.
 *
 * It used to be the page's subtitle — a sentence reading "Arrow keys move between cells. E edits,
 * D duplicates, Delete removes, Space selects, Enter opens." set in the most valuable line of the
 * screen, under the heading, above everything a person actually came to read. It is reference
 * material: consulted once, then never again, and read by the people who already know it every
 * single visit.
 *
 * So it moves into a popover on a `?` button beside the heading, and `?` itself opens it — the
 * binding every application with a shortcut sheet uses, which is the reason a reader tries it. The
 * button stays visible and stays in the tab order, because a shortcut sheet you can only reach with
 * a shortcut helps nobody who needed it.
 */

/** One `[key cap, what it does]` pair. Order is the order they are drawn in. */
const BINDINGS: ReadonlyArray<readonly [MessageKey, MessageKey]> = [
  ['transactions.keyboard.keys.arrows', 'transactions.keyboard.move'],
  ['transactions.keyboard.keys.enter', 'transactions.keyboard.open'],
  ['transactions.keyboard.keys.space', 'transactions.keyboard.select'],
  ['transactions.keyboard.keys.edit', 'transactions.keyboard.edit'],
  ['transactions.keyboard.keys.duplicate', 'transactions.keyboard.duplicate'],
  ['transactions.keyboard.keys.delete', 'transactions.keyboard.remove'],
  ['transactions.keyboard.keys.help', 'transactions.keyboard.help'],
]

/**
 * Whether the press landed somewhere a person is composing text.
 *
 * In a search box `?` is a question mark, and a global binding that steals it turns the filter
 * field into one that silently refuses a character.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function KeyboardShortcuts() {
  const t = useTranslate()
  const [isOpen, setIsOpen] = useState(false)
  const title = t('transactions.keyboard.title')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (isTypingTarget(event.target)) {
        return
      }
      event.preventDefault()
      setIsOpen((open) => !open)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <PopoverTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button
        variant="ghost"
        size="sm"
        shape="icon"
        label={title}
        icon={<CircleHelp />}
      />
      <Popover placement="bottom start" className="max-w-xs">
        <PopoverDialog aria-label={title}>
          <h2 className="mb-2 text-label font-semibold text-ink">{title}</h2>
          <table className="w-full border-collapse text-caption">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="pb-1 pe-4 text-start text-micro tracking-label uppercase text-ink-2"
                >
                  {t('transactions.keyboard.column.key')}
                </th>
                <th
                  scope="col"
                  className="pb-1 text-start text-micro tracking-label uppercase text-ink-2"
                >
                  {t('transactions.keyboard.column.action')}
                </th>
              </tr>
            </thead>
            <tbody>
              {BINDINGS.map(([capKey, actionKey]) => (
                <tr key={capKey}>
                  <td className="py-1 pe-4 align-top whitespace-nowrap">
                    <kbd className="rounded-sm border border-border-subtle bg-surface-sunken px-1.5 py-0.5 font-mono text-micro text-ink">
                      {t(capKey)}
                    </kbd>
                  </td>
                  <td className="py-1 align-top text-ink-2">{t(actionKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PopoverDialog>
      </Popover>
    </PopoverTrigger>
  )
}
