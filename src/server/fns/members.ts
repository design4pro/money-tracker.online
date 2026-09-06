/**
 * The workspace-sharing server functions: the members screen, and the invitation a person accepts.
 *
 * Three things happen here and nothing else does — the same three as every other module in this
 * directory: the input is validated with Zod, the caller is authorised with a guard, and the work
 * is done by `#/server/repos/members`, which authorises *again* against the role it re-read.
 *
 * The one shape worth calling out is which guard each function uses:
 *
 * - everything about a workspace's own membership takes `requireOrg()`, so it acts inside the
 *   caller's workspace and nowhere else;
 * - {@link loadInvitation} and {@link acceptInvitation} take `requireUser()`, because the person
 *   holding an invitation is by definition not a member of the workspace yet. They are authorised
 *   by the invitation's id **and** by the address it was issued to, and the repository is where
 *   that is decided.
 *
 * The invitation email is sent from here rather than from the repository, for the reason
 * `#/server/goals/reached` gives about notifications: a repository that talks to an email provider
 * is a repository that fails a database write because a mail API was slow. A failed send is
 * reported in the return value, never thrown — the invitation exists either way, and the screen
 * says whether the letter went.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { appUrl, emailDelivery } from '#/server/auth/env'
import { createAuthEmailer } from '#/server/auth/email'
import { requireOrg, requireUser } from '#/server/auth/guards'
import { resolveLimits } from '#/server/billing/resolve-limits'
import { loggerFromEnv } from '#/server/observability/logger'
import {
  acceptInvitation as acceptInvitationRow,
  changeMemberRole as changeMemberRoleRow,
  getInvitationView,
  inviteMember as inviteMemberRow,
  inviteSchema,
  leaveWorkspace as leaveWorkspaceRow,
  listInvitations,
  listMembers,
  removeMember as removeMemberRow,
  renewInvitation,
  revokeInvitation as revokeInvitationRow,
  workspaceName,
} from '#/server/repos/members'

import type { AuthEmailOutcome } from '#/server/auth/email'
import type { WorkspaceRole } from '#/components/app/shell'
import type {
  InvitationView,
  WorkspaceInvitation,
  WorkspaceMember,
} from '#/server/repos/members'

const idSchema = z.strictObject({
  invitationId: z.string().trim().min(1).max(64),
})

const memberIdSchema = z.strictObject({
  memberId: z.string().trim().min(1).max(64),
  role: z.enum(['owner', 'admin', 'member']),
})

/** Everything `/settings/members` draws, including the seat figures it must not recount. */
export interface MembersView {
  readonly members: ReadonlyArray<WorkspaceMember>
  readonly invitations: ReadonlyArray<WorkspaceInvitation>
  /** Memberships **plus** pending invitations, and the plan's ceiling for them. */
  readonly seatsUsed: number
  readonly seatLimit: number
  readonly role: WorkspaceRole
}

export const loadMembers = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MembersView> => {
    const scope = await requireOrg()
    const [members, invitations, effective] = await Promise.all([
      listMembers(scope),
      listInvitations(scope),
      resolveLimits(scope),
    ])

    return {
      members,
      invitations,
      // Read from the resolver rather than counted here: the number the screen shows and the number
      // the invite path enforces against have to be the same one.
      seatsUsed: effective.usage.members,
      seatLimit: effective.limits.members,
      role: scope.ctx.role,
    }
  },
)

export interface InviteResult {
  readonly email: string
  /** `sent`, or an honest `skipped-no-provider` on a deployment with no mail credentials. */
  readonly delivery: AuthEmailOutcome
}

export const inviteMember = createServerFn({ method: 'POST' })
  .inputValidator(inviteSchema)
  .handler(async ({ data }): Promise<InviteResult> => {
    const scope = await requireOrg()
    const invitation = await inviteMemberRow(scope, data)
    return {
      email: invitation.email,
      delivery: await sendInvitationEmail({
        invitationId: invitation.id,
        email: invitation.email,
        workspace: await workspaceName(scope),
      }),
    }
  })

export const resendInvitation = createServerFn({ method: 'POST' })
  .inputValidator(idSchema)
  .handler(async ({ data }): Promise<InviteResult> => {
    const scope = await requireOrg()
    const invitation = await renewInvitation(scope, data.invitationId)
    return {
      email: invitation.email,
      delivery: await sendInvitationEmail({
        invitationId: invitation.id,
        email: invitation.email,
        workspace: await workspaceName(scope),
      }),
    }
  })

export const revokeInvitation = createServerFn({ method: 'POST' })
  .inputValidator(idSchema)
  .handler(async ({ data }): Promise<void> => {
    await revokeInvitationRow(await requireOrg(), data.invitationId)
  })

export const changeMemberRole = createServerFn({ method: 'POST' })
  .inputValidator(memberIdSchema)
  .handler(async ({ data }): Promise<void> => {
    await changeMemberRoleRow(await requireOrg(), data)
  })

export const removeMember = createServerFn({ method: 'POST' })
  .inputValidator(
    z.strictObject({ memberId: z.string().trim().min(1).max(64) }),
  )
  .handler(async ({ data }): Promise<void> => {
    await removeMemberRow(await requireOrg(), data.memberId)
  })

export const leaveWorkspace = createServerFn({ method: 'POST' }).handler(
  async (): Promise<void> => {
    await leaveWorkspaceRow(await requireOrg())
  },
)

/* -------------------------------------------------------------------------- */
/* The invitation a person is holding                                          */
/* -------------------------------------------------------------------------- */

export const loadInvitation = createServerFn({ method: 'GET' })
  .inputValidator(idSchema)
  .handler(async ({ data }): Promise<InvitationView> => {
    const user = await requireUser()
    const { getDb } = await import('#/server/auth/db')
    return getInvitationView(getDb(), {
      invitationId: data.invitationId,
      viewer: { userId: user.id, email: user.email },
    })
  })

export const acceptInvitation = createServerFn({ method: 'POST' })
  .inputValidator(idSchema)
  .handler(async ({ data }): Promise<{ organizationId: string }> => {
    const user = await requireUser()
    const { getDb } = await import('#/server/auth/db')
    return acceptInvitationRow(getDb(), {
      invitationId: data.invitationId,
      viewer: { userId: user.id, email: user.email },
    })
  })

/**
 * Sends the invitation letter.
 *
 * The URL matches the one Better Auth's own `sendInvitationEmail` hook builds, because both routes
 * lead to the same screen and a household should not be able to tell which path sent their link.
 */
async function sendInvitationEmail(input: {
  readonly invitationId: string
  readonly email: string
  readonly workspace: string
}): Promise<AuthEmailOutcome> {
  const { env } = await import('cloudflare:workers')
  const logger = loggerFromEnv(env, {
    context: { component: 'members', route: 'invite' },
  })
  const emailer = createAuthEmailer({ delivery: emailDelivery(), logger })

  return emailer.send({
    kind: 'organization-invitation',
    to: input.email,
    url: `${appUrl()}/invite/${input.invitationId}`,
    organizationName: input.workspace,
  })
}
