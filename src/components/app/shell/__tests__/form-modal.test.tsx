import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Button, Dialog, DialogBody, DialogHeader } from '#/components/ui'
import { I18nProvider } from '#/lib/i18n'
import en from '#/lib/i18n/messages/en'

import { FormModal, useIsDirty } from '../form-modal'

/**
 * The guard, asserted on the two things that make it worth having.
 *
 * A pristine dialog closes like any other overlay — that is the half the blanket
 * `isDismissable={false}` got wrong, and it is why an empty form opened by mistake used to be as
 * unclosable as a half-filled one.
 *
 * A dirty one refuses, keeps every value, and offers two labelled answers. The failure mode that
 * matters is the silent one: a dialog wrongly read as pristine discards work on a scrim press, so
 * the "refuses" cases assert both that the dialog is still there *and* that the caller's
 * `onOpenChange` was never told to close.
 */

function Harness({
  isDirty,
  onOpenChange,
}: {
  isDirty: boolean
  onOpenChange?: (isOpen: boolean) => void
}) {
  const [isOpen, setOpen] = useState(true)

  return (
    <I18nProvider locale="en" messages={en}>
      <FormModal
        isOpen={isOpen}
        onOpenChange={(next) => {
          setOpen(next)
          onOpenChange?.(next)
        }}
        isDirty={isDirty}
      >
        <Dialog>
          {({ close }) => (
            <>
              <DialogHeader title="New account" onClose={close} />
              <DialogBody>
                <input aria-label="Account name" defaultValue="Bank" />
                <Button onPress={close}>Cancel</Button>
              </DialogBody>
            </>
          )}
        </Dialog>
      </FormModal>
    </I18nProvider>
  )
}

/** The gestures that all end in the overlay state's `close()`. */
const CLOSE_GESTURES = [
  [
    'a press on the scrim',
    async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(document.querySelector('[data-scrim]') as HTMLElement)
    },
  ],
  [
    'Escape',
    async (user: ReturnType<typeof userEvent.setup>) => {
      await user.keyboard('{Escape}')
    },
  ],
  [
    'the close button in the header',
    async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: 'Close' }))
    },
  ],
  [
    'a footer button wired to the render-prop close',
    async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
    },
  ],
] as const

describe('FormModal', () => {
  for (const [gesture, perform] of CLOSE_GESTURES) {
    it(`closes on ${gesture} while the form is pristine`, async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(<Harness isDirty={false} onOpenChange={onOpenChange} />)

      await perform(user)

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it(`asks on ${gesture} while the form is dirty`, async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(<Harness isDirty onOpenChange={onOpenChange} />)

      await perform(user)

      expect(
        screen.getByRole('alertdialog', { name: en['dialog.unsaved.title'] }),
      ).toBeTruthy()
      // The form is still mounted behind the alert, so nothing it holds has
      // been thrown away while the question is being asked.
      expect(screen.getByLabelText('Account name')).toHaveProperty(
        'value',
        'Bank',
      )
      expect(onOpenChange).not.toHaveBeenCalled()
    })
  }

  it('opens the alert focused on the non-destructive answer', async () => {
    const user = userEvent.setup()
    render(<Harness isDirty />)

    await user.keyboard('{Escape}')

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: en['dialog.unsaved.keepEditing'] }),
    )
  })

  it('keeps editing closes only the alert', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Harness isDirty onOpenChange={onOpenChange} />)

    await user.keyboard('{Escape}')
    await user.click(
      screen.getByRole('button', { name: en['dialog.unsaved.keepEditing'] }),
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'New account' })).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('Escape on the alert answers keep editing', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Harness isDirty onOpenChange={onOpenChange} />)

    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeTruthy()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'New account' })).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('discard changes closes both and tells the caller', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Harness isDirty onOpenChange={onOpenChange} />)

    await user.keyboard('{Escape}')
    await user.click(
      screen.getByRole('button', { name: en['dialog.unsaved.discard'] }),
    )

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('useIsDirty', () => {
  it('reports a draft that still holds the values it opened with as pristine', () => {
    const { result, rerender } = renderHook(
      (draft: { name: string; amount: number }) => useIsDirty(draft),
      { initialProps: { name: 'Bank', amount: 0 } },
    )

    expect(result.current).toBe(false)

    // A new object with the same values is not a change. This is the case a
    // reference comparison on the draft itself would get wrong on every render.
    rerender({ name: 'Bank', amount: 0 })
    expect(result.current).toBe(false)
  })

  it('reports a changed value, and reports it pristine again once reverted', () => {
    const { result, rerender } = renderHook(
      (draft: { name: string; amount: number }) => useIsDirty(draft),
      { initialProps: { name: 'Bank', amount: 0 } },
    )

    rerender({ name: 'Savings', amount: 0 })
    expect(result.current).toBe(true)

    // A value comparison has no memory of the trip, so an edit-and-revert has
    // nothing to lose and the guard must not ask about it.
    rerender({ name: 'Bank', amount: 0 })
    expect(result.current).toBe(false)
  })

  it('compares per key rather than by identity, so one changed field is enough', () => {
    const { result, rerender } = renderHook(
      (draft: { name: string; amount: number }) => useIsDirty(draft),
      { initialProps: { name: 'Bank', amount: 0 } },
    )

    rerender({ name: 'Bank', amount: 125 })
    expect(result.current).toBe(true)
  })

  // Two of the six dialogs hold list state: `budget-form-dialog`'s thresholds and
  // categories, `series-form-dialog`'s reminders. A `CheckboxGroup` replaces its
  // value wholesale on every toggle, so ticking one off and back on hands the hook
  // a new array holding the same members — an identity comparison would call the
  // form dirty for the rest of its life over an edit that undid itself.
  it('compares an array value by its members, not by its identity', () => {
    const { result, rerender } = renderHook(
      (draft: { name: string; thresholds: ReadonlyArray<number> }) =>
        useIsDirty(draft),
      { initialProps: { name: 'Groceries', thresholds: [80, 100] } },
    )

    expect(result.current).toBe(false)

    rerender({ name: 'Groceries', thresholds: [80] })
    expect(result.current).toBe(true)

    rerender({ name: 'Groceries', thresholds: [80, 100] })
    expect(result.current).toBe(false)
  })

  it('reads a reordered list as a change, because order is something the user chose', () => {
    const { result, rerender } = renderHook(
      (draft: { remindBefore: ReadonlyArray<number> }) => useIsDirty(draft),
      { initialProps: { remindBefore: [1, 3] } },
    )

    rerender({ remindBefore: [3, 1] })
    expect(result.current).toBe(true)
  })
})
