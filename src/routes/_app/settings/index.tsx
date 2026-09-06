import { createFileRoute } from '@tanstack/react-router'
import { ChevronRight, Shapes, Store } from 'lucide-react'

import { writeLocaleCookie } from '#/components/app/shell'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Link,
  Radio,
  RadioGroup,
} from '#/components/ui'
import { SUPPORTED_LOCALES, useLocale, useTranslate } from '#/lib/i18n'
import { THEME_MODES, useTheme } from '#/lib/theme'

import type { ComponentType, ReactNode } from 'react'
import type { Locale, MessageKey } from '#/lib/i18n'
import type { ThemeMode } from '#/lib/theme'

/**
 * `/settings` — where the product is configured.
 *
 * ## Why this screen exists before the settings area does
 *
 * Plan 23 builds the real settings shell: a layout route, a two-group nav, and eight screens
 * underneath it. Until then `/settings` was a link the product rendered — from the account menu in
 * every header — straight into a 404. That is the worst kind of broken, because it is the one place
 * every reader looks first and the failure is indistinguishable from the application falling over.
 *
 * So this is a real screen rather than a stub, and it costs almost nothing to be one: theme,
 * language, the account's own facts and the workspace's shared lists all already exist. It gives
 * them a home instead of inventing anything. When `23-S1` lands it replaces this file with the
 * index that redirects into `/settings/profile`, and nothing here has to be unpicked first.
 *
 * ## The scope is stated on every card
 *
 * The settings area's rule is that a control changing something *for you* and a control changing
 * something *for everyone in the workspace* never sit in the same unlabelled group. Each card
 * carries its scope as a badge under its title, which is also the grouping plan 23's nav will use.
 *
 * ## Nothing here writes to the server
 *
 * Theme is a `localStorage` key and language is a cookie the root loader reads, both per device by
 * design — see `src/lib/theme.ts` and `src/components/app/shell/locale-switcher.tsx`. There is no
 * `user_preferences` row to write to yet (`23-S1` requisitions it), so this screen has no loader,
 * no server function and no dirty state, and the two controls take effect the instant they are
 * pressed. A Save button with nothing to save would be a lie about where the value went.
 */
export const Route = createFileRoute('/_app/settings/')({
  component: SettingsRoute,
})

/** The scope each card belongs to. The badge under each title, and the reason the cards are ordered as they are. */
type Scope = 'you' | 'workspace'

const SCOPE_LABEL: Readonly<Record<Scope, MessageKey>> = {
  you: 'settings.scope.you',
  workspace: 'settings.scope.workspace',
}

const THEME_LABEL: Readonly<Record<ThemeMode, MessageKey>> = {
  light: 'app.theme.light',
  dark: 'app.theme.dark',
  system: 'app.theme.system',
}

function SettingsRoute() {
  const t = useTranslate()
  const { shell } = Route.useRouteContext()

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-bold text-ink">{t('nav.settings')}</h1>
        <p className="max-w-[68ch] text-body text-ink-2">
          {t('settings.subtitle')}
        </p>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <AppearanceCard />
        <LanguageCard />

        <SettingsCard
          scope="you"
          title={t('settings.account.title')}
          description={t('settings.account.description')}
        >
          <dl className="flex flex-col gap-4">
            <Fact label={t('common.name')} value={shell.user.name} />
            <Fact label={t('auth.field.email')} value={shell.user.email} />
          </dl>
        </SettingsCard>

        <SettingsCard
          scope="workspace"
          title={t('app.workspace.label')}
          description={t('settings.workspace.description')}
        >
          <dl className="flex flex-col gap-4">
            <Fact
              label={t('settings.workspace.name')}
              value={shell.workspace.name}
            />
          </dl>

          <ul className="mt-5 flex flex-col border-t border-border-subtle">
            <li className="border-b border-border-subtle last:border-b-0">
              <RecordLink
                href="/categories"
                Icon={Shapes}
                label={t('nav.categories')}
                description={t('settings.categories.description')}
              />
            </li>
            <li className="border-b border-border-subtle last:border-b-0">
              <RecordLink
                href="/payees"
                Icon={Store}
                label={t('nav.payees')}
                description={t('settings.payees.description')}
              />
            </li>
          </ul>
        </SettingsCard>
      </div>
    </div>
  )
}

/**
 * Light, dark, or follow the device.
 *
 * A radio group rather than the header's menu: on a settings screen the three states should be
 * readable without opening anything, and the group is one tab stop with arrow keys inside it, which
 * is the WAI-ARIA pattern for exactly this choice.
 *
 * The group is named by `aria-label` rather than a visible `Label`, because the card's own heading
 * already carries that word and two identical labels in a row is noise for a screen reader and
 * clutter for everyone else.
 */
function AppearanceCard() {
  const t = useTranslate()
  const { mode, setMode } = useTheme()

  return (
    <SettingsCard
      scope="you"
      title={t('app.theme.label')}
      description={t('settings.appearance.description')}
    >
      <RadioGroup
        aria-label={t('app.theme.label')}
        value={mode}
        onChange={(next) => setMode(next as ThemeMode)}
      >
        {THEME_MODES.map((themeMode) => (
          <Radio key={themeMode} value={themeMode}>
            {t(THEME_LABEL[themeMode])}
          </Radio>
        ))}
      </RadioGroup>
    </SettingsCard>
  )
}

/**
 * The language, named in its own language.
 *
 * `Polski`, not `Polish` — from the frozen table in `src/lib/i18n/locales.ts`, and with `lang` on
 * the row so a screen reader pronounces it with Polish phonemes. The reasoning, and why
 * `Intl.DisplayNames` may not be used for it, is in `locale-switcher.tsx`.
 *
 * Choosing writes the cookie the root loader reads and reloads the document, because the catalogue
 * is resolved on the server before the first byte: a client-side swap would leave `<html lang>`
 * stating the previous language, which is what a screen reader picks its voice from.
 */
function LanguageCard() {
  const t = useTranslate()
  const locale = useLocale()

  return (
    <SettingsCard
      scope="you"
      title={t('app.language.label')}
      description={t('settings.language.description')}
    >
      <RadioGroup
        aria-label={t('app.language.label')}
        value={locale}
        onChange={(next) => {
          if (next === locale) return
          writeLocaleCookie(next as Locale)
          window.location.reload()
        }}
      >
        {SUPPORTED_LOCALES.map((descriptor) => (
          <Radio key={descriptor.tag} value={descriptor.tag}>
            <span lang={descriptor.tag}>{descriptor.nativeName}</span>
          </Radio>
        ))}
      </RadioGroup>
    </SettingsCard>
  )
}

interface SettingsCardProps {
  scope: Scope
  title: string
  description: string
  children: ReactNode
}

/** One card: the scope, the heading, the sentence that explains it, and the controls. */
function SettingsCard({
  scope,
  title,
  description,
  children,
}: SettingsCardProps) {
  const t = useTranslate()

  return (
    <Card padding="lg">
      <CardHeader
        headingLevel={2}
        title={title}
        description={
          <>
            <Badge tone="info" size="sm">
              {t(SCOPE_LABEL[scope])}
            </Badge>
            <span className="mt-2 block">{description}</span>
          </>
        }
      />
      <CardBody>{children}</CardBody>
    </Card>
  )
}

/** One `<dt>`/`<dd>` pair. A fact the server resolved, shown rather than edited. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-micro tracking-label uppercase text-ink-2">
        {label}
      </dt>
      <dd className="truncate text-body text-ink">{value}</dd>
    </div>
  )
}

interface RecordLinkProps {
  href: string
  Icon: ComponentType<{ className?: string }>
  label: string
  description: string
}

/**
 * A row that leads to one of the workspace's shared lists.
 *
 * The whole row is the link, so the 44px target is the row rather than the four words in it, and
 * the description is inside the link's accessible name — "Payees, who money went to…" is what makes
 * two adjacent rows distinguishable in a list of links.
 */
function RecordLink({ href, Icon, label, description }: RecordLinkProps) {
  return (
    <Link
      href={href}
      variant="unstyled"
      className="target-min-h flex w-full items-center gap-3 rounded-md px-2 py-3 data-[hovered]:bg-hover"
    >
      <Icon className="size-[1.125rem] shrink-0 text-ink-2" />
      <span className="min-w-0 flex-1">
        <span className="block text-label font-medium text-ink">{label}</span>
        <span className="block text-caption text-ink-2">{description}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
    </Link>
  )
}
