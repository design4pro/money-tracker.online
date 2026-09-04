import { useState } from 'react'
import { ExternalLink, Paperclip, Trash2 } from 'lucide-react'

import { ConfirmDeleteDialog } from '#/components/app/transactions'
import { Button, Card, EmptyState, Link, toast } from '#/components/ui'
import { formatNumber, useLocale, useTranslate } from '#/lib/i18n'
import { deleteAttachment } from '#/server/fns/attachments'

import type { Locale, MessageKey } from '#/lib/i18n'
import type { ReactNode } from 'react'

/**
 * The receipts on one transaction: a list of links, and the one destructive action they carry.
 *
 * ## A link list has to be readable out of context
 *
 * A screen reader can list every link on a page with no surrounding text, and `receipt.pdf` five
 * times over is a list of five identical, useless entries. So each link's own text is **the file
 * name, its size and its type** — `Lidl-2026-03-10.pdf · 412 kB · PDF` — which reads as one
 * sentence in place and identifies itself in a link list. Nothing about the entry is carried by an
 * icon alone.
 *
 * ## A byte size is not an amount
 *
 * {@link formatBytes} formats `byte_size`, and this file **does not import `#/lib/money`**. The two
 * look interchangeable and are not: money is an integer count of minor units at a currency's own
 * `digits`, and a file size is a count of bytes that is *meant* to be divided down to a readable
 * unit. Sharing a formatter between them ends with a currency's scale applied to a megabyte.
 * `__tests__/attachments.test.ts` asserts the absent import on this file's source.
 *
 * ## Deleting names the file
 *
 * The confirmation says which receipt is about to go, because "Delete this attachment?" on a
 * transaction with three of them is a question nobody can answer. The dialog is
 * `ConfirmDeleteDialog`, unchanged, so the destructive-choice behaviour — `alertdialog`, focus on
 * Cancel, `danger` on the confirm — is the product's one implementation rather than a second.
 */

/** What the list needs from a row. A subset of `AttachmentRow`, so a loader can pass rows straight. */
export interface AttachmentSummary {
  readonly id: string
  readonly originalName: string
  readonly contentType: string
  readonly byteSize: number
}

export interface AttachmentListProps {
  /** The stored receipts in upload order. Empty is a designed state, not a missing one. */
  readonly attachments: ReadonlyArray<AttachmentSummary>
  /**
   * The affordance that adds one — in this product, `<AttachmentDropzone />`.
   *
   * It is rendered in the empty state as its action and below the list otherwise, so the host
   * mounts the dropzone exactly once and does not have to branch on the count itself.
   */
  readonly action?: ReactNode
  /** Called after a successful delete, so the host can refetch what it loaded. */
  readonly onDeleted: () => void
}

/**
 * A byte count, scaled and formatted for the reader's locale.
 *
 * Decimal units (1 kB = 1000 B), which is what every operating system and every browser download
 * panel shows, so the number here matches the number the person sees when the file lands. The
 * division to a major unit is exactly the operation that must never happen to money, and this
 * function is the only place in the attachment surface that performs one.
 */
export function formatBytes(locale: Locale, bytes: number): string {
  if (bytes < 1000) {
    return formatNumber(locale, bytes, { style: 'unit', unit: 'byte' })
  }
  if (bytes < 1_000_000) {
    return formatNumber(locale, bytes / 1000, {
      style: 'unit',
      unit: 'kilobyte',
      maximumFractionDigits: 0,
    })
  }
  return formatNumber(locale, bytes / 1_000_000, {
    style: 'unit',
    unit: 'megabyte',
    maximumFractionDigits: 1,
  })
}

/**
 * The short name of a stored type.
 *
 * Keyed on the five types `files/upload` will store and nothing else: the value in the column came
 * out of the magic-byte sniff, so there is no sixth case to design a fallback for. An unknown value
 * would mean the row predates the allow-list, and `attachments.type.other` is what it reads as.
 */
const TYPE_KEYS: Readonly<Record<string, MessageKey>> = {
  'image/jpeg': 'attachments.type.jpeg',
  'image/png': 'attachments.type.png',
  'image/webp': 'attachments.type.webp',
  'image/heic': 'attachments.type.heic',
  'application/pdf': 'attachments.type.pdf',
}

export function AttachmentList({
  attachments,
  action,
  onDeleted,
}: AttachmentListProps) {
  const t = useTranslate()
  const locale = useLocale()

  const [pending, setPending] = useState<AttachmentSummary | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  async function confirmDelete() {
    if (pending === null) return
    setIsDeleting(true)
    try {
      await deleteAttachment({ data: { id: pending.id } })
      toast.success(t('attachments.toast.deleted'))
      setPending(null)
      onDeleted()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Card
      as="section"
      aria-labelledby="attachment-list-heading"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="attachment-list-heading"
          className="text-body font-semibold text-ink"
        >
          {t('attachments.title')}
        </h2>
        <p className="text-caption text-ink-2">
          {t('attachments.description')}
        </p>
      </div>

      {attachments.length === 0 ? (
        <EmptyState
          icon={<Paperclip />}
          title={t('attachments.empty.title')}
          description={t('attachments.empty.body')}
          action={action}
        />
      ) : (
        <>
          <ul
            aria-label={t('attachments.list.label')}
            className="flex flex-col gap-2"
          >
            {attachments.map((file) => {
              const size = formatBytes(locale, file.byteSize)
              const kind = t(
                TYPE_KEYS[file.contentType] ?? 'attachments.type.other',
              )
              return (
                <li
                  key={file.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2"
                >
                  {/*
                    `/api/files/$id` is the only read path. The href is built from the id alone —
                    there is no bucket URL to build one from, which is the point.
                  */}
                  <Link
                    href={`/api/files/${file.id}`}
                    target="_blank"
                    rel="noreferrer"
                    size="sm"
                    className="min-w-0 break-all"
                  >
                    <ExternalLink aria-hidden="true" className="size-4" />
                    <span>
                      {t('attachments.link', {
                        name: file.originalName,
                        size,
                        kind,
                      })}
                    </span>
                  </Link>

                  <Button
                    variant="ghost"
                    shape="icon"
                    icon={<Trash2 />}
                    label={t('attachments.remove', {
                      name: file.originalName,
                    })}
                    onPress={() => setPending(file)}
                  />
                </li>
              )
            })}
          </ul>
          {action}
        </>
      )}

      <ConfirmDeleteDialog
        isOpen={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={t('attachments.confirm.title')}
        body={t('attachments.confirm.body', {
          name: pending?.originalName ?? '',
        })}
        confirmLabel={t('attachments.confirm.action')}
        isPending={isDeleting}
        onConfirm={() => void confirmDelete()}
      />
    </Card>
  )
}
