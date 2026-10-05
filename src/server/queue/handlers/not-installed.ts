/**
 * The handler a kind has until the plan that owns it installs its own.
 *
 * The envelope knows the kind, so a message of that kind parses; no code can process it yet. It must
 * not be acknowledged (the job would be lost) and it must not be silently dropped, so the handler
 * throws, the dispatcher retries with an `error` log, and the retry limit moves the message to the
 * dead-letter queue where it waits for a deploy that installs the handler.
 */

import type { TaskHandler, TaskKind } from '../dispatch'

/** A message of a known kind reached a registry entry that has no handler behind it. */
export class HandlerNotInstalledError extends Error {
  constructor(kind: string) {
    super(`no handler is installed for ${kind}`)
    this.name = 'HandlerNotInstalledError'
  }
}

export function notInstalled<K extends TaskKind>(kind: K): TaskHandler<K> {
  return () => Promise.reject(new HandlerNotInstalledError(kind))
}
