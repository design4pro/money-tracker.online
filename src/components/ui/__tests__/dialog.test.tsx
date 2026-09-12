import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Button } from '../button'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
  Modal,
} from '../dialog'

function Example({ isDismissable = true }: { isDismissable?: boolean }) {
  return (
    <DialogTrigger>
      <Button>Open</Button>
      <Modal isDismissable={isDismissable}>
        <Dialog>
          {({ close }) => (
            <>
              <DialogHeader
                title="Delete transaction"
                description="This cannot be undone."
                onClose={close}
              />
              <DialogBody>
                <button type="button">Inside</button>
              </DialogBody>
              <DialogFooter>
                <Button onPress={close}>Cancel</Button>
              </DialogFooter>
            </>
          )}
        </Dialog>
      </Modal>
    </DialogTrigger>
  )
}

/**
 * The controlled shape `canClose` is documented to hold for.
 *
 * `isOpen` and `onOpenChange` are the caller's, so every close React Aria
 * performs comes back through one function — which is the whole reason one
 * wrapper covers the scrim, Escape and the header's X alike.
 */
function ControlledExample({
  canClose,
  onOpenChange,
}: {
  canClose?: () => boolean
  onOpenChange?: (isOpen: boolean) => void
}) {
  const [isOpen, setOpen] = useState(true)

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(next) => {
        setOpen(next)
        onOpenChange?.(next)
      }}
      canClose={canClose}
    >
      <Dialog>
        {({ close }) => (
          <>
            <DialogHeader title="Edit account" onClose={close} />
            <DialogBody>
              <button type="button">Inside</button>
            </DialogBody>
          </>
        )}
      </Dialog>
    </Modal>
  )
}

/** The shape the issue is about: an alert dialog whose description is the consequence. */
function AlertExample() {
  return (
    <Modal isOpen>
      <Dialog role="alertdialog">
        <DialogHeader
          title="Discard changes?"
          description="This form has changes that have not been saved."
          hideClose
        />
        <DialogBody>
          <button type="button">Discard</button>
        </DialogBody>
      </Dialog>
    </Modal>
  )
}

/** The three gestures that all end in the overlay state's `close()`. */
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
] as const

describe('Modal canClose', () => {
  for (const [gesture, perform] of CLOSE_GESTURES) {
    it(`refuses ${gesture} while canClose returns false`, async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(
        <ControlledExample
          canClose={() => false}
          onOpenChange={onOpenChange}
        />,
      )

      await perform(user)

      expect(screen.getByRole('dialog', { name: 'Edit account' })).toBeTruthy()
      // Not merely still open: the caller was never told to close, so nothing
      // downstream of `onOpenChange` — a route's state, a reset — has run.
      expect(onOpenChange).not.toHaveBeenCalled()
    })

    it(`allows ${gesture} while canClose returns true`, async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(
        <ControlledExample canClose={() => true} onOpenChange={onOpenChange} />,
      )

      await perform(user)

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  }

  it('never consults canClose on the way open', async () => {
    const canClose = vi.fn(() => false)
    render(<ControlledExample canClose={canClose} />)

    expect(screen.getByRole('dialog', { name: 'Edit account' })).toBeTruthy()
    expect(canClose).not.toHaveBeenCalled()
  })
})

describe('Modal + Dialog', () => {
  it('names the dialog from its Heading slot="title"', async () => {
    const user = userEvent.setup()
    render(<Example />)

    await user.click(screen.getByRole('button', { name: 'Open' }))

    // A dialog whose title is a styled div announces as "dialog" and nothing
    // more. This is the assertion that catches that regression.
    expect(
      screen.getByRole('dialog', { name: 'Delete transaction' }),
    ).toBeTruthy()
  })

  it('describes the dialog from the header description', async () => {
    const user = userEvent.setup()
    render(<Example />)

    await user.click(screen.getByRole('button', { name: 'Open' }))

    // Resolved to its text rather than asserted as an attribute: an
    // `aria-describedby` pointing at an id nothing carries reads as no
    // description at all, and only following the reference catches that.
    const describedBy = screen
      .getByRole('dialog')
      .getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      'This cannot be undone.',
    )
  })

  it('describes an alertdialog from the header description', () => {
    render(<AlertExample />)

    // The case the gap actually cost something: an alert dialog exists to state
    // a consequence, and the description is that consequence.
    const describedBy = screen
      .getByRole('alertdialog')
      .getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)?.textContent).toBe(
      'This form has changes that have not been saved.',
    )
  })

  it('emits no aria-describedby for a header without a description', () => {
    render(<ControlledExample />)

    expect(
      screen.getByRole('dialog').getAttribute('aria-describedby'),
    ).toBeNull()
  })

  it('moves focus into the dialog and keeps it there', async () => {
    const user = userEvent.setup()
    render(<Example />)

    await user.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)

    // Tab all the way round: focus must never escape to the trigger behind the
    // scrim.
    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<Example />)

    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    // The trigger is back in the accessibility tree, so the rest of the page is
    // reachable again rather than still hidden behind the modal's aria-hidden.
    expect(screen.getByRole('button', { name: 'Open' })).toBe(trigger)
    // Focus returning to that trigger is the other half of the behaviour, and
    // jsdom cannot witness it: FocusScope's restore lands on `document.body`
    // there. It is asserted in a real browser by
    // `e2e/focus-restoration.spec.ts`.
  })

  it('closes from the close button in the header', async () => {
    const user = userEvent.setup()
    render(<Example />)

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sizes the scrim in the same viewport unit the panel is capped in', async () => {
    const user = userEvent.setup()
    render(<Example />)

    await user.click(screen.getByRole('button', { name: 'Open' }))

    // A class assertion, deliberately, and the reason is worth writing down: no
    // engine available to this repository's tests can witness the fault it
    // guards. `position: fixed` with `inset-0` and no height resolves against
    // the *initial containing block*, which on a mobile browser is the **large**
    // viewport — the one that ignores a shown URL bar. The panel is capped in
    // `dvh`, the **dynamic** viewport. Centre a `dvh`-tall panel inside an
    // `lvh`-tall box and its bottom edge lands below the fold by half the
    // toolbar, with no scroll range anywhere to reach it, because the panel is
    // shorter than the scrim. Headless Chromium and Playwright's device
    // emulation both have no dynamic toolbar, so `dvh === lvh === innerHeight`
    // there and a measured assertion would pass whether or not the bug is
    // present. What can be asserted is the invariant that was violated: the two
    // boxes name the same viewport.
    const scrim = document.querySelector('[data-scrim]')
    const panel = screen.getByRole('dialog').parentElement

    expect(scrim?.className).toMatch(/\bh-dvh\b/)
    expect(panel?.className).toMatch(/dvh/)
  })

  it.each(['center', 'drawer', 'drawer-end'] as const)(
    'hooks the %s panel for the reduced-motion transform reset',
    (placement) => {
      render(
        <Modal isOpen placement={placement}>
          <Dialog aria-label="Panel">Body</Dialog>
        </Modal>,
      )

      // Every placement animates the panel's `transform` on the way in and out
      // and rests it at the identity, which is the promise the attribute makes
      // to the reduced-motion block in `tokens.css`. The other primitives that
      // make it are held in `motion-transform.test.tsx`.
      expect(
        screen
          .getByRole('dialog')
          .parentElement?.hasAttribute('data-motion-transform'),
      ).toBe(true)
    },
  )

  it('hides the rest of the document from assistive technology while open', async () => {
    const user = userEvent.setup()
    render(<Example />)

    await user.click(screen.getByRole('button', { name: 'Open' }))

    // React Aria marks every sibling of the overlay `aria-hidden`, which is
    // what stops a screen-reader user swiping straight out of a modal into the
    // page behind it.
    const dialog = screen.getByRole('dialog')
    const trigger = screen.queryByRole('button', { name: 'Open' })
    expect(trigger).toBeNull()
    expect(dialog).toBeTruthy()
  })
})
