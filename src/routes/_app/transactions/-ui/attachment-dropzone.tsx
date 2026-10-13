import { useId, useState } from 'react'
import { DropZone } from 'react-aria-components/DropZone'
import { FileTrigger } from 'react-aria-components/FileTrigger'
import { isFileDropItem } from 'react-aria-components/useDragAndDrop'
import { Paperclip } from 'lucide-react'

import { Button, ProgressBar } from '#/components/ui'
import { failureOf } from '#/lib/failure'
import { useTranslate } from '#/lib/i18n'
import { uploadAttachment } from '#/server/fns/attachments'

import type { DropZoneProps } from 'react-aria-components'

/**
 * Attaching a receipt: a button first, a drop target second.
 *
 * ## The button is the feature; the drop area is the enhancement
 *
 * `FileTrigger` renders a real `<button>` wired to a hidden `<input type="file">`, so choosing a
 * file is keyboard-operable, has an accessible name and works with every assistive technology that
 * can press a button. The `DropZone` around it adds dragging for people who have a mouse and a
 * file manager open. That order is not a preference: §2 clause 7 requires a non-drag path beside
 * every drag-and-drop affordance, and a dropzone that *replaces* the button is a feature only some
 * people can use.
 *
 * ## A failure is per file, never a banner
 *
 * Dropping five files and being told "the upload failed" is being told nothing. Each file keeps its
 * own row — its name, its progress bar while it is in flight, and, if it is refused, the reason for
 * *that* file. The rows persist after the batch so somebody can read why one of five did not land.
 *
 * ## What is checked here, and what is only checked on the server
 *
 * The size and the declared type are checked before the request, purely so an obvious mistake is
 * answered instantly and without a round trip. **Neither check is the authority.** The declared
 * type is a claim the browser makes on the strength of the file extension, and the real decision is
 * `files/upload`'s magic-byte sniff on the server — a renamed executable passes everything this
 * component can see and fails there. That is why a server refusal is rendered as its own row state
 * rather than treated as impossible.
 *
 * ## Progress is indeterminate, and that is deliberate
 *
 * `11-S3` asks for a determinate bar per file. `fetch` — which is what a server function is called
 * through — exposes no upload progress event, so a determinate bar here could only ever display a
 * number this component invented. `ProgressBar`'s own docblock states the codebase's position: an
 * omitted `value` drops `aria-valuenow` rather than reporting a fake zero, which is the difference
 * between "working" and "0% done" to a screen reader. A fabricated percentage is worse than an
 * honest sweep, so the bar is indeterminate and the file name beside it carries the identity.
 */

/**
 * The allow-list and the ceiling, repeated rather than imported.
 *
 * `#/server/files/upload` is a server module — it reaches `zod` and the repository error family —
 * and this component is in the browser bundle. `src/routes/(auth)/-lib/schemas.ts` makes the same
 * copy for the same reason. The copy is not left to drift: `attachments.test.ts` reads this file
 * and fails if either value disagrees with the server's.
 */
const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const

const MAX_BYTES = 10 * 1024 * 1024

/**
 * What `DropZone`'s `onDrop` is handed.
 *
 * Read off the component's own prop type rather than imported: `react-aria-components` re-exports
 * the guards (`isFileDropItem`) but not the event type, and a hand-written shape here would be a
 * second declaration to keep in step with the library.
 */
type DroppedItems = Parameters<NonNullable<DropZoneProps['onDrop']>>[0]

export interface AttachmentDropzoneProps {
  /** The transaction the receipts belong to. */
  readonly transactionId: string
  /** Called after each file that lands, so the host can refetch the list. */
  readonly onUploaded: () => void
  /** Set while the host is busy with something that must not race the upload. */
  readonly isDisabled?: boolean
}

/** One file's state for as long as the panel is mounted. */
interface FileState {
  readonly key: string
  readonly name: string
  readonly status: 'uploading' | 'error'
  /** Present only on `error`. The already-translated reason for **this** file. */
  readonly message?: string
}

export function AttachmentDropzone({
  transactionId,
  onUploaded,
  isDisabled = false,
}: AttachmentDropzoneProps) {
  const t = useTranslate()
  const listId = useId()
  const [files, setFiles] = useState<ReadonlyArray<FileState>>([])

  function replace(key: string, next: FileState | null) {
    setFiles((current) =>
      next === null
        ? current.filter((row) => row.key !== key)
        : current.map((row) => (row.key === key ? next : row)),
    )
  }

  /**
   * Uploads one file, sequentially with the rest.
   *
   * One request per file, because the server function takes one file and answers about one file.
   * Sequential rather than parallel so a dropped folder cannot open twenty connections and so the
   * quota is asserted against a storage figure that is not being changed by a sibling request.
   */
  async function upload(file: File, key: string) {
    if (file.size > MAX_BYTES) {
      replace(key, {
        key,
        name: file.name,
        status: 'error',
        message: t('attachments.error.size'),
      })
      return
    }
    if (!(ACCEPTED_TYPES as ReadonlyArray<string>).includes(file.type)) {
      replace(key, {
        key,
        name: file.name,
        status: 'error',
        message: t('attachments.error.type'),
      })
      return
    }

    const form = new FormData()
    form.set('transactionId', transactionId)
    form.set('file', file, file.name)

    try {
      await uploadAttachment({ data: form })
      // The row goes only when the file is actually stored: a list that empties on failure is a
      // list that hides the failure.
      replace(key, null)
      onUploaded()
    } catch (error) {
      replace(key, {
        key,
        name: file.name,
        status: 'error',
        message: t(failureOf(error).message.key),
      })
    }
  }

  async function accept(chosen: ReadonlyArray<File>) {
    if (chosen.length === 0) return

    const queued = chosen.map((file, index) => ({
      file,
      state: {
        key: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        status: 'uploading' as const,
      },
    }))
    setFiles((current) => [...current, ...queued.map((item) => item.state)])

    for (const item of queued) {
      await upload(item.file, item.state.key)
    }
  }

  async function onDrop(event: DroppedItems) {
    const dropped = await Promise.all(
      event.items.filter(isFileDropItem).map((item) => item.getFile()),
    )
    await accept(dropped)
  }

  return (
    <div className="flex flex-col gap-3">
      <DropZone
        aria-label={t('attachments.dropzone.label')}
        // Only when the list is on the page: `aria-describedby` pointing at an id that does not
        // exist is an axe `serious` in its own right, and an empty dropzone has nothing to describe.
        aria-describedby={files.length === 0 ? undefined : listId}
        isDisabled={isDisabled}
        getDropOperation={() => 'copy'}
        onDrop={(event) => void onDrop(event)}
        className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong/60 px-4 py-6 text-center outline-none data-[drop-target]:border-accent data-[drop-target]:bg-surface-sunken data-[focus-visible]:ring-2 data-[focus-visible]:ring-accent"
      >
        <p className="text-caption text-ink-2">
          {t('attachments.dropzone.hint')}
        </p>
        <FileTrigger
          acceptedFileTypes={[...ACCEPTED_TYPES]}
          allowsMultiple
          onSelect={(list) => void accept(list === null ? [] : [...list])}
        >
          <Button
            variant="secondary"
            icon={<Paperclip />}
            isDisabled={isDisabled}
          >
            {t('attachments.attach')}
          </Button>
        </FileTrigger>
        <p className="text-caption text-ink-2">
          {t('attachments.dropzone.limits')}
        </p>
      </DropZone>

      {files.length === 0 ? null : (
        <ul
          id={listId}
          aria-label={t('attachments.progress.label')}
          className="flex flex-col gap-2"
        >
          {files.map((file) => (
            <li key={file.key}>
              {file.status === 'uploading' ? (
                <ProgressBar
                  isIndeterminate
                  label={t('attachments.progress.file', { name: file.name })}
                  hideValue
                />
              ) : (
                /*
                  The reason belongs to this file and is rendered beside its name. `role="alert"`
                  so it is announced when it appears — a person who has just dropped five files is
                  not looking at this row.
                */
                <p role="alert" className="text-caption text-negative">
                  {t('attachments.error.file', {
                    name: file.name,
                    reason: file.message ?? t('attachments.error.failed'),
                  })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
