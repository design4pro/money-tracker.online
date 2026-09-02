import { useState } from 'react'
import { LogOut, Settings } from 'lucide-react'

import {
  Avatar,
  Button,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
} from '#/components/ui'
import { signOut } from '#/lib/auth-client'
import { useTranslate } from '#/lib/i18n'

import type { ShellUser } from './types'

export interface UserMenuProps {
  user: ShellUser
}

/**
 * The account menu.
 *
 * The trigger is the avatar and nothing else — at 360px the header has room for three icon controls
 * beside the workspace switcher, and the reader's own name is the one label a header can afford to
 * drop. It is not lost: the menu's first block states the name and the address, so "which account
 * am I signed in as" is one press away and is announced rather than inferred from initials.
 *
 * The identity block is a plain `div` inside the popover rather than a `MenuItem`, because it is
 * not an action. A non-interactive row inside a `menu` role is announced as a menu item that does
 * nothing, and a keyboard user arrows onto it and presses Enter to find out why.
 */
export function UserMenu({ user }: UserMenuProps) {
  const t = useTranslate()
  const [isSigningOut, setSigningOut] = useState(false)

  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        shape="icon"
        // The name rather than a generic "account": with two people sharing a household the avatar
        // is the only thing distinguishing two otherwise identical headers.
        aria-label={`${t('app.account.menu')}: ${user.name}`}
        isPending={isSigningOut}
        icon={
          <Avatar size="md" name={user.name} src={user.image} isDecorative />
        }
      />

      <Popover placement="bottom end" className="min-w-64">
        <div className="border-b border-border-subtle px-2.5 pb-2.5 pt-1.5">
          <p className="truncate text-label font-semibold text-ink">
            {user.name}
          </p>
          <p className="truncate text-caption text-ink-2">{user.email}</p>
        </div>

        <Menu
          aria-label={t('app.account.menu')}
          onAction={(key) => {
            if (key !== 'sign-out' || isSigningOut) return
            setSigningOut(true)
            void endSession()
          }}
        >
          <MenuItem
            id="settings"
            href="/settings"
            icon={<Settings />}
            textValue={t('nav.settings')}
          >
            {t('nav.settings')}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            id="sign-out"
            icon={<LogOut />}
            textValue={t('app.signOut')}
          >
            {t('app.signOut')}
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}

/**
 * Ends the session, then leaves for the sign-in screen with a document load.
 *
 * The navigation is in a `finally`: if the sign-out request failed the session may or may not have
 * survived, and the honest next screen either way is `/login`, which asks the server. Staying put
 * would show a shell built from a session that might no longer exist.
 */
async function endSession(): Promise<void> {
  try {
    await signOut()
  } finally {
    window.location.assign('/login')
  }
}
