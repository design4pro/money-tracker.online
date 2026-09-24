import { useId, useState } from 'react'
import { DropZone } from 'react-aria-components/DropZone'
import { FileTrigger } from 'react-aria-components/FileTrigger'
import { isFileDropItem } from 'react-aria-components/useDragAndDrop'
import { useNavigate } from '@tanstack/react-router'
import { Upload } from 'lucide-react'

import { Button, Select, SelectItem } from '#/components/ui'
import { formatNumber, useLocale, useTranslate } from '#/lib/i18n'
import { uploadImport } from '#/server/fns/imports'

import { rememberParsedFile } from '../-lib/flow'
import { Notice } from './notice'

import type { DropZoneProps } from 'react-aria-components'
import type { Locale } from '#/lib/i18n'
import type { ImportSourceOption } from '../-server/sources'

/**
 * Choosing an account and handing over one file.
 *
 * ## The format is worked out, never asked for
 *
 * `uploadImport` needs a `source`, and a person does not know whether their bank wrote OFX or QFX.
 * So the file's own ending is matched against the extensions `-server/sources.ts` read out of the
 * parser registry, and the match is what is posted. A file whose ending nothing claims is refused
 * here with the reason, rather than uploaded to be refused by a registry that would have to guess.
 *
 * The **list is the registry's**, which is why this component takes `options` rather than holding
 * one: a format landing in a later stage appears in the `accept` attribute and in the probe below
 * without this file being edited.
 *
 * ## A button first, a drop target second
 *
 * `FileTrigger` renders a real button over a hidden `<input type="file">`, and the `DropZone` around
 * it is the enhancement for whoever has a file manager open. §2 clause 7: a drag affordance never
 * stands alone. The order here is the same one `attachment-dropzone.tsx` argues for at length.
 *
 * ## Nothing here is timed
 *
 * The chosen file waits until the person presses the button. There is no auto-submit on drop: an
 * upload that starts because a file grazed a rectangle is an upload nobody chose.
 */

/** What the picker needs to name an account. The route hands rows straight through. */
export interface UploadAccountOption {
  readonly id: string
  readonly name: string
}

export interface UploadCardProps {
  readonly accounts: ReadonlyArray<UploadAccountOption>
  /** The formats of **this** provenance group, as the registry reported them. */
  readonly options: ReadonlyArray<ImportSourceOption>
  /** `IMPORT_MAX_BYTES`, so the hint under the control cannot state a stale ceiling. */
  readonly maxBytes: number
}

type DroppedItems = Parameters<NonNullable<DropZoneProps['onDrop']>>[0]

/** The upload's own three states. `sniffing` is the wait between the bytes landing and the answer. */
type UploadPhase = 'idle' | 'uploading' | 'sniffing'

/**
 * A ceiling in megabytes, formatted for the reader.
 *
 * A byte count is not an amount: it is *meant* to be divided down to a readable unit, which is the
 * one operation money never permits. `attachment-list.tsx` makes the same argument for its own
 * copy; sharing one formatter across two routes would be a shared dependency for four lines.
 */
function formatMegabytes(locale: Locale, bytes: number): string {
  return formatNumber(locale, bytes / 1_000_000, {
    style: 'unit',
    unit: 'megabyte',
    maximumFractionDigits: 0,
  })
}

/** `'statement.CSV'` → `'.csv'`, and `''` for a name with no ending at all. */
function extensionOf(fileName: string): string {
  const at = fileName.lastIndexOf('.')
  return at === -1 ? '' : fileName.slice(at).toLowerCase()
}

export function UploadCard({ accounts, options, maxBytes }: UploadCardProps) {
  const t = useTranslate()
  const locale = useLocale()
  const navigate = useNavigate()
  const hintId = useId()

  const [accountId, setAccountId] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [error, setError] = useState<string | null>(null)

  const extensions = [
    ...new Set(options.flatMap((option) => option.extensions)),
  ]

  async function send() {
    setError(null)
    if (accountId === null) {
      setError(t('import.upload.error.account'))
      return
    }
    if (file === null) {
      setError(t('import.upload.error.file'))
      return
    }
    // The registry's answer, matched on the file's own ending. First match wins: within one
    // provenance group two formats never claim the same ending.
    const source = options.find((option) =>
      option.extensions.includes(extensionOf(file.name)),
    )
    if (source === undefined) {
      setError(t('import.upload.error.extension', { name: file.name }))
      return
    }
    if (file.size > maxBytes) {
      setError(
        t('import.upload.error.tooLarge', {
          name: file.name,
          size: formatMegabytes(locale, maxBytes),
        }),
      )
      return
    }

    const form = new FormData()
    form.set('accountId', accountId)
    form.set('source', source.source)
    form.set('file', file, file.name)

    setPhase('uploading')
    try {
      // One request stores the bytes **and** answers with what they turned out to be, so the two
      // phases below are one round trip: `sniffing` is what the person is waiting on once the
      // upload itself is over, and there is no second call to make.
      setPhase('sniffing')
      const upload = await uploadImport({ data: form })
      rememberParsedFile(upload)
      await navigate({
        to: '/import/$batchId',
        params: { batchId: upload.batch.id },
        search: { step: 'upload' },
      })
    } catch (cause) {
      setPhase('idle')
      setError(
        t('import.upload.error.failed', {
          reason: cause instanceof Error ? cause.message : file.name,
        }),
      )
    }
  }

  async function onDrop(event: DroppedItems) {
    const dropped = await Promise.all(
      event.items.filter(isFileDropItem).map((item) => item.getFile()),
    )
    // One file per batch, by definition: a batch has one `file_r2_key`, one mapping and one undo.
    const first = dropped.at(0)
    if (first !== undefined) {
      setFile(first)
      setError(null)
    }
  }

  const busy = phase !== 'idle'

  return (
    <div className="flex flex-col gap-4">
      <Select
        label={t('import.upload.account.label')}
        placeholder={t('import.upload.account.placeholder')}
        selectedKey={accountId}
        onSelectionChange={(key) => setAccountId(String(key))}
        isDisabled={busy}
        isRequired
      >
        {accounts.map((account) => (
          <SelectItem key={account.id} id={account.id} textValue={account.name}>
            {account.name}
          </SelectItem>
        ))}
      </Select>

      <DropZone
        aria-label={t('import.upload.dropzone')}
        aria-describedby={hintId}
        isDisabled={busy}
        onDrop={(event) => void onDrop(event)}
        className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong/60 px-6 py-8 text-center data-[drop-target]:border-accent data-[drop-target]:bg-accent/5"
      >
        <Upload aria-hidden="true" className="size-5 text-ink-2" />
        <p className="text-caption text-ink-2">{t('import.upload.dropzone')}</p>
        <FileTrigger
          acceptedFileTypes={extensions}
          onSelect={(chosen) => {
            const first = chosen === null ? null : Array.from(chosen).at(0)
            if (first !== undefined && first !== null) {
              setFile(first)
              setError(null)
            }
          }}
        >
          <Button variant="secondary" isDisabled={busy}>
            {t('import.upload.choose')}
          </Button>
        </FileTrigger>
        <p id={hintId} className="text-caption text-ink-2">
          {t('import.upload.accepts', {
            extensions: extensions.join(', '),
            size: formatMegabytes(locale, maxBytes),
          })}
        </p>
      </DropZone>

      {file === null ? null : (
        <p className="text-caption text-ink">
          {t('import.upload.selected', { name: file.name })}
        </p>
      )}

      {/*
        The wait is announced rather than only drawn: the upload and the sniff are one request and
        the person is told which half they are in. `polite` because nothing is being interrupted.
      */}
      <p aria-live="polite" className="text-caption text-ink-2">
        {phase === 'uploading' && file !== null
          ? t('import.upload.state.uploading', { name: file.name })
          : null}
        {phase === 'sniffing' ? t('import.upload.state.sniffing') : null}
      </p>

      {error === null ? null : <Notice tone="problem">{error}</Notice>}

      <div>
        <Button onPress={() => void send()} isPending={busy}>
          {t('import.upload.submit')}
        </Button>
      </div>
    </div>
  )
}
