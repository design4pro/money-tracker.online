/**
 * `notify()` — the one way an occasion becomes something a person is told about.
 *
 * ---------------------------------------------------------------------------
 * WHY IT NEVER THROWS
 * ---------------------------------------------------------------------------
 *
 * Every caller is downstream of a write that has already committed: a budget sweep whose crossings
 * are real, a contribution that has already moved the goal. Letting a notification failure
 * propagate would turn "we could not tell you" into "your money did not save", which is the wrong
 * trade in a finance app. So `notify` returns an outcome and the caller decides — the two cron
 * adapters escalate a `'failed'`, because a permanently broken channel must be loud somewhere, and
 * the goals adapter does not, because it sits inside a request.
 *
 * ---------------------------------------------------------------------------
 * THE MEMBERSHIP CHECK IS NOT THE CALLER'S TO SKIP
 * ---------------------------------------------------------------------------
 *
 * The adapters already fan out over `listMembers`, so in practice every `userId` reaching here is a
 * member and the check answers `true`. It stays anyway. A row in `notifications` is addressed to a
 * person **inside a workspace**, and the pair is what the reader's query trusts; a caller that
 * passes a stale id after somebody left would otherwise write a row nobody can ever open and
 * nothing would say so. One indexed lookup is the price of that not depending on every future
 * caller getting it right.
 *
 * ---------------------------------------------------------------------------
 * WHAT `suppressEmail` IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 *
 * It is one-way. A recurring series carries `notifyEmail`, which says whether *that series* wants
 * reminders — a different question from whether *this person* wants `recurring.*` by email. The two
 * compose as an AND, so a producer can only ever turn the email leg off. If it could turn it on,
 * a series flag would silently override somebody's preference, and a preference that a producer can
 * widen is not a preference.
 */

import { isMember } from '#/server/repos/members'
import {
  insertNotification,
  listPrefsFor,
  resolvePrefs,
} from '#/server/repos/notifications'

import { enqueueNotificationEmail } from './email'
import { NOTIFICATION_KINDS } from './kinds'

import type { NotificationKind } from '#/lib/enums'
import type { TenantScope } from '#/server/repos/scope'
import type { NotificationPayload } from './kinds'

/**
 * - `'written'` — a row landed, and the email leg ran if it was wanted.
 * - `'deduped'` — this workspace has already told this person this. The ordinary answer to a retry.
 * - `'skipped'` — nothing to do: not a member, or every channel is off for this kind.
 * - `'failed'` — something threw. The caller decides whether that is worth escalating.
 */
export type NotifyOutcome = 'written' | 'deduped' | 'skipped' | 'failed'

export interface NotifyArgs<TKind extends NotificationKind> {
  readonly userId: string
  readonly kind: TKind
  readonly payload: NotificationPayload<TKind>
  /**
   * What makes two offers of the same occasion one notification. The producers already build
   * theirs; `./dedupe` has the one this stage had to invent.
   */
  readonly dedupeKey: string
  /** Producer-level opt-out for the email leg only. Never widens a preference. */
  readonly suppressEmail?: boolean
}

export async function notify<TKind extends NotificationKind>(
  scope: TenantScope,
  args: NotifyArgs<TKind>,
  now: Date = new Date(),
): Promise<NotifyOutcome> {
  try {
    if (!(await isMember(scope, args.userId))) return 'skipped'

    const entry = NOTIFICATION_KINDS[args.kind]
    const stored = (await listPrefsFor(scope, args.userId)).get(args.kind)
    const channels = resolvePrefs(stored, entry.defaults)

    // Every channel off for this kind is the person saying they do not want to hear it. Nothing is
    // written: a row nobody asked for is still a row a future reader has to explain.
    if (!channels.inApp && !channels.email && !channels.digest) return 'skipped'

    // **The row is written whenever any channel wants the occasion, including when `inApp` is off.**
    // It is the record that this happened — what the email is *about*, and what `21-S2`'s nightly
    // digest selects from. `inApp` is a question about the badge and the list, and both are the
    // reader's, which is `21-S3`: filtering there costs a `WHERE`, whereas not writing the row here
    // would mean a person with email on and in-app off gets an email referring to nothing.
    // Parsed, not merely typed. The registry's schema is what `21-S2` and `21-S3` will read these
    // rows back through, and a stored row outlives the code that wrote it: a `v` that is not `1` or
    // a four-letter currency code is a row nothing can ever render, and it is unfixable once
    // written. The types catch a producer with the wrong shape; this catches one with the wrong
    // value, and a throw here becomes `'failed'`, which the cron adapters already escalate.
    const payload = entry.payload.parse(
      args.payload,
    ) as NotificationPayload<TKind>

    const row = await insertNotification(
      scope,
      {
        userId: args.userId,
        kind: args.kind,
        payloadJson: JSON.stringify(payload),
        dedupeKey: args.dedupeKey,
      },
      now,
    )

    // A repeat is a repeat on every channel: emailing again about an occasion whose row is already
    // there is the duplicate the dedupe key exists to prevent.
    if (row === null) return 'deduped'

    // A digestible kind waits for `21-S2`'s nightly sweep, which reads the rows themselves. Only an
    // immediate one is handed over now.
    const wantsEmail =
      channels.email && args.suppressEmail !== true && !entry.digestible

    if (wantsEmail) {
      try {
        await enqueueNotificationEmail(scope, {
          userId: args.userId,
          notificationId: row.id,
          kind: args.kind,
          payload,
        })
      } catch {
        // `'written'`, not `'failed'`: the row is committed and the person will see it. Reporting
        // failure would make a cron adapter escalate — and a retried tick would find the dedupe key
        // taken, write nothing, and escalate again, forever. The in-app half of this notification
        // succeeded, and that is what the outcome is about.
      }
    }

    return 'written'
  } catch {
    // Swallowed here and reported as an outcome, because this tree injects loggers per call site
    // and `notify` has none: the seams it is installed into are `(scope, event)` functions. The
    // adapters in `./adapters` turn a `'failed'` into a throw, which lands in the cron's own catch
    // — the nearest place that does have a logger and a workspace to name.
    return 'failed'
  }
}
