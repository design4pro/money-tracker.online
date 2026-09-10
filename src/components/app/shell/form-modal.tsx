import { useRef, useState } from 'react'

import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { isSameShallow } from '#/lib/shallow-equal'

import type { ModalProps } from '#/components/ui'

/**
 * The owner module of the unsaved-changes guard.
 *
 * `components/ui/dialog` owns the mechanism — `canClose`, "may I close" — and
 * stays free of copy, of state and of any opinion about what a refusal means.
 * The precedent for that boundary is `DialogHeader`'s `closeLabel`, a prop
 * whose comment reads _"Localised by the caller"_. So the answer to a refusal
 * lives here, one layer up, where the catalogue is.
 *
 * ## Why dirtiness is the caller's to state
 *
 * The obvious design detects "touched" centrally, from `input` and `change`
 * events captured on the panel, and costs nothing at any call site. It does not
 * work, and it fails silently. A React Aria `Select`, `ComboBox` or
 * `DatePicker` renders its listbox or calendar in a `Popover` portalled
 * **outside** the panel, and commits through `state.setSelectedKey` rather than
 * by dispatching a `change` at the DOM. `account-form-dialog` alone puts
 * category, currency and the opening date behind exactly those three
 * components, so a user who changed only the currency would be read as pristine
 * and lose the change to a scrim press — the precise data loss this guard
 * exists to prevent. A guard whose failure mode is "silently stops guarding" is
 * worse than the wall it replaced.
 *
 * So `isDirty` is a prop, computed by the caller from state the caller already
 * owns. That also buys the thing that makes the success paths work: a dialog
 * can say _the work is saved, I am no longer dirty_, and a control that has
 * just committed does not ask.
 */
export interface FormModalProps extends Omit<
  ModalProps,
  'canClose' | 'isOpen' | 'onOpenChange'
> {
  /**
   * Required, unlike on `Modal`: `canClose` can only hold for a controlled
   * overlay. Inside a `DialogTrigger` the open state is React Aria's own and
   * closes whatever the guard returns, so the prop types make that case
   * unwritable rather than quietly unguarded.
   */
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  /**
   * Whether the form holds work that closing would discard.
   *
   * A value that *differs from the one the dialog opened with*, not a control
   * that has been touched: a field changed and changed back has nothing to
   * lose, and a memory of the trip would only produce a false ask.
   */
  readonly isDirty: boolean
}

/**
 * A `Modal` that refuses to discard a form with work in it.
 *
 * Every close React Aria routes through `close()` meets the guard — the scrim,
 * Escape, the header's X and every footer button wired to the render-prop
 * `close`. They are one code path, and a press whose label the user may have
 * mistaken is exactly the press worth asking about.
 *
 * A control that has just **committed** the work is the exception, and it is
 * the caller's to arrange: either it closes through the route's own
 * `onOpenChange(false)` — which is this component's prop, not the guarded one —
 * or the state it committed makes `isDirty` false.
 */
export function FormModal({
  isDirty,
  isOpen,
  onOpenChange,
  children,
  ...props
}: FormModalProps) {
  const t = useTranslate()
  const [isAsking, setAsking] = useState(false)

  return (
    <>
      <Modal
        {...props}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        canClose={() => {
          if (!isDirty) return true
          setAsking(true)
          return false
        }}
      >
        {children}
      </Modal>

      {/*
        A second overlay rather than a branch inside the first: React Aria's own
        nesting, where the inner takes the focus trap and the outer stays
        mounted and keeps every value the form holds.

        No dismissable scrim and no X, because an alert with a dismiss control
        has three answers and only two of them are labelled. Escape means
        "keep editing", which is the non-destructive one.
      */}
      <Modal
        size="sm"
        isOpen={isAsking}
        onOpenChange={setAsking}
        isDismissable={false}
      >
        <Dialog role="alertdialog">
          <DialogHeader
            title={t('dialog.unsaved.title')}
            description={t('dialog.unsaved.body')}
            hideClose
          />
          <DialogBody />
          <DialogFooter>
            <Button
              variant="secondary"
              autoFocus
              onPress={() => {
                setAsking(false)
              }}
            >
              {t('dialog.unsaved.keepEditing')}
            </Button>
            <Button
              variant="danger"
              onPress={() => {
                setAsking(false)
                onOpenChange(false)
              }}
            >
              {t('dialog.unsaved.discard')}
            </Button>
          </DialogFooter>
        </Dialog>
      </Modal>
    </>
  )
}

/**
 * Whether a draft object still holds the values it was first rendered with.
 *
 * Six of this product's form dialogs keep one `draft` object with a `patch()`
 * setter, and for those this is the whole of the `isDirty` expression. The
 * snapshot is taken on first render, which is correct precisely because those
 * routes mount the dialog only while it is open and key it by the row being
 * edited: a fresh open is a fresh component, so first render *is* the open.
 *
 * **Value contract.** {@link isSameShallow} compares a list by its members and
 * everything else with `Object.is`, so a value that is neither must be
 * referentially stable while unchanged. That holds for every draft in this
 * repository today — `CalendarDate` and the minor-unit integers are replaced,
 * never mutated — and a violation over-reports rather than under-reports: the
 * guard asks about a form nobody edited, which is a nuisance rather than lost
 * work. The list case is not a nicety: a `CheckboxGroup` replaces its value
 * wholesale on every toggle, so `budget-form-dialog`'s thresholds and
 * `series-form-dialog`'s reminders would otherwise read as permanently dirty
 * after a tick that was undone.
 *
 * It is **not** the hook for a dialog whose state outlives its own open;
 * `filter-bar` is one, and supplies its own expression against a baseline
 * re-taken at each open.
 */
export function useIsDirty<T extends object>(draft: T): boolean {
  const openedWith = useRef(draft)

  return !isSameShallow(draft, openedWith.current)
}
