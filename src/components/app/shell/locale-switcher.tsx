import { Languages } from 'lucide-react'

import { Button, Menu, MenuItem, MenuTrigger, Popover } from '#/components/ui'
import { SUPPORTED_LOCALES, useLocale, useTranslate } from '#/lib/i18n'
import { writeLocaleCookie } from './locale-cookie'

import type { Locale } from '#/lib/i18n'

/**
 * The language picker.
 *
 * ## Each language is named in its own language
 *
 * `English`, `Polski` — from the frozen table in `src/lib/i18n/locales.ts`, never from
 * `Intl.DisplayNames`. `Intl.DisplayNames` resolves names against the *reader's* current locale, so
 * a Polish reader would be offered "angielski" and would have to already read Polish to find
 * English. The one control whose whole job is to rescue somebody from a language they cannot read
 * must not be written in that language.
 *
 * ## Why a full document load
 *
 * The catalogue is resolved by the root loader on the server, before the first byte, so that the
 * document's `lang`, its `dir` and every string in it agree from the first paint. Switching
 * language therefore means asking the server again: the choice is written to a cookie the root
 * loader reads and the page is reloaded. A client-side swap would leave `<html lang>` stating the
 * previous language — which is what a screen reader picks its voice from — and would need every
 * catalogue in the browser bundle to do it.
 */
export function LocaleSwitcher() {
  const t = useTranslate()
  const locale = useLocale()

  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        shape="icon"
        label={t('app.language.change')}
        icon={<Languages className="size-[1.125rem]" />}
      />
      <Popover placement="bottom end">
        <Menu
          aria-label={t('app.language.label')}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[locale]}
          onSelectionChange={(keys) => {
            const next = keys === 'all' ? undefined : [...keys][0]
            if (typeof next !== 'string' || next === locale) return
            writeLocaleCookie(next as Locale)
            window.location.reload()
          }}
        >
          {SUPPORTED_LOCALES.map((descriptor) => (
            <MenuItem
              key={descriptor.tag}
              id={descriptor.tag}
              textValue={descriptor.nativeName}
            >
              {/* `lang` on the row itself, so a screen reader pronounces "Polski" with Polish
                  phonemes instead of reading it as English. */}
              <span lang={descriptor.tag}>{descriptor.nativeName}</span>
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
