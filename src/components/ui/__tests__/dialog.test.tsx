import { describe, expect, it } from 'vitest'
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
