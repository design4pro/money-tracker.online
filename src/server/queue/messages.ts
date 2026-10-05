/**
 * The task queue's message envelope — one union, parsed on the way out of the queue.
 *
 * A queue message is as untrusted as a request body: it crosses a process boundary, it can be
 * redelivered, and it can outlive the deploy that produced it. So the consumer parses rather than
 * casts, and an unrecognised body is reported and acknowledged instead of retried five times into
 * the dead-letter queue with no more information than the first attempt had.
 *
 * `wrangler.jsonc` describes one queue for many task kinds. A kind's shape is fixed here before its
 * handler lands (so that plan 19, 20 and 09 add a handler file and never edit the consumer), and it
 * carries no version field: a new `kind` is the versioning mechanism, and the old kind keeps its
 * handler for one release (`BACKWARD_COMPATIBILITY.md`, Queue messages).
 *
 * **What an envelope may carry** is ids, one date and one pagination cursor, and never a value that
 * is also stored in a row (an amount, a rate, a role, a status): a copy could disagree with the row
 * it names. `organizationId` and `userId` are a claim used to find a scope, not an authorisation;
 * the handler re-reads the membership and the role. `envelope.test.ts` holds the allow-list.
 */

import { z } from 'zod'

/**
 * One verified Polar delivery, waiting to be applied.
 *
 * The body carries the **event id and nothing else**: the payload is already stored in
 * `billing_events`, and a message that repeated it could disagree with the row it names. Processing
 * out of the request is what keeps the endpoint inside its response budget — a provider that times
 * out retries, and a retry into a slow handler is how one event gets applied twice.
 */
export const billingEventMessageSchema = z.strictObject({
  kind: z.literal('billing.event'),
  eventId: z.string().min(1).max(200),
})

/**
 * An id that reaches a storage key or a claim key: a bounded charset, so it can never carry a slash,
 * a space or a control character into one.
 */
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

/** A real calendar day. The round trip through `Date` refuses `2026-02-31`, which the pattern allows. */
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    )
  })

/** An opaque position in a paged listing: printable ASCII, so it is safe to log and to store. */
const cursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[\x20-\x7e]+$/)

/** Parse an uploaded import file into staged rows. */
export const importParseMessageSchema = z.strictObject({
  kind: z.literal('import.parse'),
  organizationId: idSchema,
  userId: idSchema,
  batchId: idSchema,
})

/** Commit a staged import batch. */
export const importExecuteMessageSchema = z.strictObject({
  kind: z.literal('import.execute'),
  organizationId: idSchema,
  userId: idSchema,
  batchId: idSchema,
})

/** Revert a committed import batch. */
export const importRevertMessageSchema = z.strictObject({
  kind: z.literal('import.revert'),
  organizationId: idSchema,
  userId: idSchema,
  batchId: idSchema,
})

/** Build one export archive. */
export const exportBuildMessageSchema = z.strictObject({
  kind: z.literal('export.build'),
  organizationId: idSchema,
  userId: idSchema,
  jobId: idSchema,
})

/**
 * One day's backup run. Platform-level: it carries no workspace, because the handler enumerates
 * workspaces itself, and `cursor` is where a run that did not finish resumes.
 */
export const backupRunMessageSchema = z.strictObject({
  kind: z.literal('backup.run'),
  date: daySchema,
  cursor: cursorSchema.optional(),
})

export const taskMessageSchema = z.discriminatedUnion('kind', [
  billingEventMessageSchema,
  importParseMessageSchema,
  importExecuteMessageSchema,
  importRevertMessageSchema,
  exportBuildMessageSchema,
  backupRunMessageSchema,
])

export type TaskMessage = z.infer<typeof taskMessageSchema>
export type BillingEventMessage = z.infer<typeof billingEventMessageSchema>

/** Parses a message body, or `null` when nothing in this deploy knows what it is. */
export function parseTaskMessage(body: unknown): TaskMessage | null {
  const result = taskMessageSchema.safeParse(body)
  return result.success ? result.data : null
}
