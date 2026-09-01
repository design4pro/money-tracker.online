/**
 * What the guarded shell renders from.
 *
 * Declared here rather than beside the loader that produces it, because the shell components are
 * the consumers and this keeps them free of any import that leads to `src/server`. The loader in
 * `src/routes/_app.tsx` imports these types and is checked against them; the components take the
 * data as props and can therefore be rendered in a test with a literal.
 *
 * Every field is what the **server** resolved from the session and the `member` row. Nothing here
 * was chosen by the client, and nothing here may be written back from a component — the workspace
 * a reader is in is a fact about their membership, not a piece of UI state.
 */

/** The workspace role dictionary. Never mixed with the platform one (`admin | curator | user`). */
export type WorkspaceRole = 'owner' | 'admin' | 'member'

export interface ShellUser {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly image: string | null
}

export interface ShellWorkspace {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly logo: string | null
}

export interface ShellData {
  readonly user: ShellUser
  /** The workspace the session is pinned to. Always one of {@link ShellData.workspaces}. */
  readonly workspace: ShellWorkspace
  /** The caller's role **in that workspace**, re-read from `member` on this request. */
  readonly role: WorkspaceRole
  /** Every workspace the caller is a member of, for the switcher. Never empty. */
  readonly workspaces: ReadonlyArray<ShellWorkspace>
}
