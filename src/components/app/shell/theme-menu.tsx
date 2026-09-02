import { Monitor, Moon, Sun } from 'lucide-react'

import { Button, Menu, MenuItem, MenuTrigger, Popover } from '#/components/ui'
import { useTranslate } from '#/lib/i18n'
import { THEME_MODES, useTheme } from '#/lib/theme'

import type { ComponentType } from 'react'
import type { MessageKey } from '#/lib/i18n'
import type { ThemeMode } from '#/lib/theme'

interface ThemeOption {
  readonly Icon: ComponentType<{ className?: string }>
  readonly label: MessageKey
}

const OPTIONS: Readonly<Record<ThemeMode, ThemeOption>> = {
  light: { Icon: Sun, label: 'app.theme.light' },
  dark: { Icon: Moon, label: 'app.theme.dark' },
  system: { Icon: Monitor, label: 'app.theme.system' },
}

/**
 * Light / dark / follow-the-system, as a three-way menu rather than a two-way toggle.
 *
 * A toggle cannot express "follow the system", and dropping that option is not a simplification —
 * it is the difference between an app that goes dark with the rest of the phone at sunset and one
 * that has to be told twice a day. The three states are also why this is a menu with
 * `selectionMode="single"` and not a button that cycles: a cycling control gives a screen-reader
 * user no way to learn what the current state is without activating it and listening to what
 * changed.
 *
 * The trigger's glyph shows the **chosen mode**, not the resolved one, so `system` reads as
 * `system` rather than silently as whatever the OS happens to be doing.
 */
export function ThemeMenu() {
  const t = useTranslate()
  const { mode, setMode } = useTheme()
  const { Icon } = OPTIONS[mode]

  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        shape="icon"
        label={t('app.theme.label')}
        icon={<Icon className="size-[1.125rem]" />}
      />
      <Popover placement="bottom end">
        <Menu
          aria-label={t('app.theme.label')}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[mode]}
          onSelectionChange={(keys) => {
            // `Set` rather than `all`, because the menu is single-select and never sends `all`.
            const next = keys === 'all' ? undefined : [...keys][0]
            if (typeof next === 'string') setMode(next as ThemeMode)
          }}
        >
          {THEME_MODES.map((themeMode) => {
            const option = OPTIONS[themeMode]
            return (
              <MenuItem
                key={themeMode}
                id={themeMode}
                icon={<option.Icon />}
                textValue={t(option.label)}
              >
                {t(option.label)}
              </MenuItem>
            )
          })}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
