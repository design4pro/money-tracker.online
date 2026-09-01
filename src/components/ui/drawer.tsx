import { Modal } from './dialog'

import type { ModalProps } from './dialog'

export {
  Dialog as DrawerDialog,
  DialogBody as DrawerBody,
  DialogFooter as DrawerFooter,
  DialogHeader as DrawerHeader,
  DialogTrigger as DrawerTrigger,
} from './dialog'

export interface DrawerProps extends Omit<ModalProps, 'placement'> {
  /**
   * `bottom` docks to the bottom edge (the mobile sheet); `end` docks to the
   * reading-end edge — right in English and Polish, and automatically left in
   * any RTL locale, because the class is a logical `ms-auto` rather than a
   * physical `ml-auto`.
   */
  side?: 'bottom' | 'end'
}

/**
 * A Drawer is a `Modal`, not a separate primitive.
 *
 * It shares the focus trap, the scroll lock, the `inert` on the background, the
 * Escape handler and the focus restore, because those are the parts that have
 * to be right and a second implementation of them is a second place to be
 * wrong. The only difference is where the panel is docked and which transform
 * it enters with — both of which are cva variants on the same component.
 *
 * There is deliberately **no drag-to-dismiss gesture**. A swipe has no keyboard
 * equivalent, so shipping it as the only close affordance would break the rule
 * this directory is built on; and shipping it *alongside* the close button buys
 * a gesture that costs an extra library, a scroll-conflict heuristic and a
 * class of "the sheet closed while I was scrolling it" bugs. The close button
 * and Escape are the whole interface.
 */
export function Drawer({ side = 'bottom', ...props }: DrawerProps) {
  return (
    <Modal {...props} placement={side === 'bottom' ? 'drawer' : 'drawer-end'} />
  )
}
