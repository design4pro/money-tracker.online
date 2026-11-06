import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Members-settings toasts name the action (and the member) rather than printing only the
 * failure-kind sentence (#721).
 */

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../members.tsx'),
  'utf8',
)

describe('members settings failure toasts', () => {
  it('does not toast the kind sentence alone', () => {
    expect(source).not.toMatch(
      /toast\.error\(\s*t\(failureOf\(error\)\.message\.key\)\s*\)/,
    )
  })

  it('names the role change, resend and revoke, with the member', () => {
    expect(source).toContain('members.toast.roleFailed')
    expect(source).toContain('members.toast.resendFailed')
    expect(source).toContain('members.toast.revokeFailed')
    expect(source).toContain('name: person.name')
    expect(source).toContain('email: invitation.email')
  })
})
