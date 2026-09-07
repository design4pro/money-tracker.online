import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Pencil, X } from 'lucide-react'

import { ErrorPanel } from '#/components/app/accounts'
import { PayeeAvatar } from '#/components/app/payees'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Form,
  Link,
  TextField,
  toast,
} from '#/components/ui'
import { useLocale, useTranslate } from '#/lib/i18n'
import { listCategories } from '#/server/fns/categories'
import { addAlias, getPayee, removeAlias } from '#/server/fns/payees'

import { useDataRefresh } from '../-lib/refresh'
import { PayeeFormDialog } from './-ui/payee-form-dialog'

import type { MessageKey } from '#/lib/i18n'
import { pageHead } from '#/routes/-lib/page-title'

/**
 * `/payees/$payeeId` — one payee and every string that resolves to it.
 *
 * ## Why aliases get a whole screen
 *
 * An alias is the only thing standing between a bank statement that says
 * `ZABKA NANO 4471 WARSZAWA` and a ledger row that says Żabka. When an import files something
 * wrongly, this list is the answer, and it has to be somewhere a person can find without knowing
 * the word "alias" in advance - so the page says what one is, in a sentence, above the list.
 *
 * ## The stored form is shown, not the typed form
 *
 * `addAlias` normalises before it stores: case folded, diacritics folded, reference numbers and
 * noise words dropped. Showing the typed string back would promise a match this product does not
 * actually make. Showing the normalised key is honest about what is being compared.
 */
export const Route = createFileRoute('/_app/payees/$payeeId')({
  loader: async ({ params }) => {
    const [detail, categories] = await Promise.all([
      getPayee({ data: { payeeId: params.payeeId } }),
      listCategories({ data: { includeArchived: true } }),
    ])
    return { detail, categories }
  },
  errorComponent: PayeeDetailError,
  head: ({ matches, loaderData }) =>
    pageHead(
      matches,
      (t) => loaderData?.detail.payee.name ?? t('payees.title'),
    ),
  component: PayeeDetailRoute,
})

function PayeeDetailError({ error }: { error: Error }) {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <ErrorPanel
        title={t('payees.detail.notFound.title')}
        body={t('payees.detail.notFound.body')}
        detail={error.message}
      />
    </div>
  )
}

function BackLink() {
  const t = useTranslate()
  return (
    <Link href="/payees" className="inline-flex items-center gap-1.5">
      <ArrowLeft aria-hidden="true" className="size-4" />
      {t('payees.detail.back')}
    </Link>
  )
}

const MODE_LABELS: Record<string, MessageKey> = {
  enforce: 'payees.mode.enforce',
  hint: 'payees.mode.hint',
  off: 'payees.mode.off',
}

function PayeeDetailRoute() {
  const t = useTranslate()
  const locale = useLocale()
  const { detail, categories } = Route.useLoaderData()
  const router = useRouter()
  const refreshCaches = useDataRefresh()

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const refresh = () => void Promise.all([router.invalidate(), refreshCaches()])
  const { payee, aliases } = detail
  const categoryName =
    payee.defaultCategoryId === null
      ? null
      : (categories.find((row) => row.id === payee.defaultCategoryId)?.name ??
        null)

  function report(error: unknown) {
    setFailure(error instanceof Error ? error.message : String(error))
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <PayeeAvatar
            name={payee.name}
            locale={locale}
            initials={payee.logoInitials}
            color={payee.logoColor}
            size="lg"
          />
          <div>
            <h1 className="text-title font-bold text-ink">{payee.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-body text-ink-2">
              <Badge
                tone={payee.categorizationMode === 'off' ? 'neutral' : 'info'}
                size="sm"
              >
                {t(MODE_LABELS[payee.categorizationMode] ?? 'payees.mode.hint')}
              </Badge>
              {categoryName === null
                ? t('payees.detail.noCategory')
                : t('payees.defaultCategory.summary', { name: categoryName })}
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          icon={<Pencil aria-hidden="true" />}
          onPress={() => setIsEditing(true)}
        >
          {t('action.edit')}
        </Button>
      </header>

      {payee.note === null || payee.note.trim() === '' ? null : (
        <Card>
          <CardHeader title={t('common.note')} />
          <CardBody>
            <p className="text-body text-ink-2">{payee.note}</p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title={t('payees.aliases.title')}
          description={t('payees.aliases.body')}
        />
        <CardBody className="flex flex-col gap-4">
          <Form
            onSubmit={(event) => {
              event.preventDefault()
              if (draft.trim() === '') return
              setFailure(null)
              void addAlias({
                data: { payeeId: payee.id, name: draft.trim() },
              }).then(() => {
                setDraft('')
                toast.success(t('payees.aliases.added'))
                refresh()
              }, report)
            }}
            className="flex items-end gap-2"
          >
            <TextField
              label={t('payees.aliases.add')}
              description={t('payees.aliases.add.help')}
              value={draft}
              onChange={setDraft}
              maxLength={200}
              className="flex-1"
            />
            <Button
              type="submit"
              variant="secondary"
              isDisabled={draft.trim() === ''}
            >
              {t('action.add')}
            </Button>
          </Form>

          {failure === null ? null : (
            <ErrorPanel
              title={t('payees.aliases.failed')}
              body={t('empty.error.body')}
              detail={failure}
            />
          )}

          {aliases.length === 0 ? (
            <p className="text-body text-ink-2">{t('payees.aliases.empty')}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {aliases.map((alias) => (
                <li
                  key={alias.id}
                  className="flex items-center gap-1 rounded-sm border border-border-strong bg-surface ps-3 text-caption text-ink"
                >
                  <span className="truncate">{alias.normalizedName}</span>
                  <Button
                    variant="ghost"
                    shape="icon"
                    size="sm"
                    label={t('payees.aliases.remove', {
                      name: alias.normalizedName,
                    })}
                    icon={<X aria-hidden="true" />}
                    onPress={() => {
                      setFailure(null)
                      void removeAlias({ data: { id: alias.id } }).then(
                        refresh,
                        report,
                      )
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {isEditing ? (
        <PayeeFormDialog
          key={payee.id}
          isOpen
          onOpenChange={setIsEditing}
          payee={payee}
          categoryOptions={categories
            .filter((row) => row.archivedAt === null)
            .map((row) => ({ id: row.id, name: row.name }))}
          onSaved={(saved) => {
            toast.success(t('payees.toast.updated', { name: saved.name }))
            setIsEditing(false)
            refresh()
          }}
        />
      ) : null}
    </div>
  )
}
