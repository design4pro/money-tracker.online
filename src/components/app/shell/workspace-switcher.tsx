import { useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'

import {
  Avatar,
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from '#/components/ui'
import { organization } from '#/lib/auth-client'
import { useTranslate } from '#/lib/i18n'

import type { MessageKey } from '#/lib/i18n'
import type { ShellData, ShellWorkspace, WorkspaceRole } from './types'

const ROLE_LABEL: Readonly<Record<WorkspaceRole, MessageKey>> = {
  owner: 'app.workspace.role.owner',
  admin: 'app.workspace.role.admin',
  member: 'app.workspace.role.member',
}

export interface WorkspaceSwitcherProps {
  shell: ShellData
  /**
   * Whether the household's initials are drawn before its name. Defaults to on, for the rail.
   * The phone header turns it off: there the switcher sits inches from the account menu, whose
   * trigger is also an initials disc, and a household called "Demo Household" beside a person
   * called "Demo Household" is two identical "DH" marks with nothing to tell them apart. The
   * name, the role and the chevron are the switcher's own identity; the disc stays on the
   * account menu, where it is the only mark.
   */
  showAvatar?: boolean
}

/**
 * Which workspace the reader is looking at, and how to change it.
 *
 * ## The role is shown, always
 *
 * A household member and its owner see the same screens with different powers, and finding out
 * which you are by having an action refused is a bad way to find out. The role line is not
 * decoration: it is the answer to "why can I not delete this account".
 *
 * ## One workspace is not a menu
 *
 * With a single membership the control renders as a plain lockup rather than as a menu whose only
 * item is already selected. A pill that opens to tell you what you already knew is the kind of
 * thing this design system calls "a lie the reader only has to be told once".
 *
 * ## Switching is a document load
 *
 * `organization.setActive` rewrites the session's active workspace on the server. Every server
 * function below the shell resolves its tenant from that session, so continuing with a client-side
 * navigation would leave the current page's already-fetched data belonging to the previous
 * workspace — one household's figures under another household's name. A full load is the only way
 * the whole tree is rebuilt against the new scope at once, and it is what the sign-in path does for
 * the same reason.
 */
export function WorkspaceSwitcher({
  shell,
  showAvatar = true,
}: WorkspaceSwitcherProps) {
  const t = useTranslate()
  const [isSwitching, setSwitching] = useState(false)
  const roleLabel = t(ROLE_LABEL[shell.role])
  const avatar = showAvatar ? (
    <Avatar
      size="md"
      name={shell.workspace.name}
      src={shell.workspace.logo}
      isDecorative
    />
  ) : null

  if (shell.workspaces.length < 2) {
    return (
      <div className="flex min-w-0 items-center gap-2.5 py-1">
        {avatar}
        <WorkspaceIdentity name={shell.workspace.name} role={roleLabel} />
      </div>
    )
  }

  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        // `h-auto` rather than a size: this trigger is two stacked lines, and forcing it onto the
        // 40px control height would clip the role line at 360px.
        className="h-auto min-w-0 max-w-64 gap-2.5 px-2 py-1.5"
        isPending={isSwitching}
        aria-label={`${t('app.workspace.switch')}: ${shell.workspace.name}`}
        icon={avatar}
        iconAfter={
          <ChevronsUpDown aria-hidden="true" className="size-4 text-ink-2" />
        }
      >
        <WorkspaceIdentity name={shell.workspace.name} role={roleLabel} />
      </Button>

      <Popover placement="bottom start" className="min-w-64">
        <Menu
          aria-label={t('app.workspace.label')}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[shell.workspace.id]}
          onAction={(key) => {
            if (key === shell.workspace.id || isSwitching) return
            setSwitching(true)
            void switchWorkspace(String(key))
          }}
        >
          {shell.workspaces.map((workspace) => (
            <WorkspaceRow key={workspace.id} workspace={workspace} />
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}

/**
 * Rewrites the session's active workspace, then reloads the document.
 *
 * The reload runs whether or not the call succeeded: on success it is the point, and on failure the
 * server still holds the previous workspace, so a reload returns the reader to a consistent screen
 * rather than to a switcher stuck in its pending state.
 */
async function switchWorkspace(organizationId: string): Promise<void> {
  try {
    await organization.setActive({ organizationId })
  } finally {
    window.location.assign('/dashboard')
  }
}

function WorkspaceIdentity({ name, role }: { name: string; role: string }) {
  return (
    <span className="flex min-w-0 flex-col items-start text-start">
      <span className="w-full truncate text-label font-semibold text-ink">
        {name}
      </span>
      <span className="w-full truncate text-caption font-normal text-ink-2">
        {role}
      </span>
    </span>
  )
}

function WorkspaceRow({ workspace }: { workspace: ShellWorkspace }) {
  return (
    <MenuItem
      id={workspace.id}
      textValue={workspace.name}
      icon={
        <Avatar
          size="sm"
          name={workspace.name}
          src={workspace.logo}
          isDecorative
        />
      }
    >
      {workspace.name}
    </MenuItem>
  )
}
