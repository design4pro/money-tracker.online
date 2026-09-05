/**
 * The task queue's message envelope — one union, parsed on the way out of the queue.
 *
 * A queue message is as untrusted as a request body: it crosses a process boundary, it can be
 * redelivered, and it can outlive the deploy that produced it. So the consumer parses rather than
 * casts, and an unrecognised body is reported and acknowledged instead of retried five times into
 * the dead-letter queue with no more information than the first attempt had.
 *
 * The union is deliberately small. `wrangler.jsonc` describes one queue for many task kinds, and
 * the kinds land as the plans that own them do; a message shape invented before its handler exists
 * is a shape nobody has ever tested.
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

export const taskMessageSchema = z.discriminatedUnion('kind', [
  billingEventMessageSchema,
])

export type TaskMessage = z.infer<typeof taskMessageSchema>
export type BillingEventMessage = z.infer<typeof billingEventMessageSchema>

/** Parses a message body, or `null` when nothing in this deploy knows what it is. */
export function parseTaskMessage(body: unknown): TaskMessage | null {
  const result = taskMessageSchema.safeParse(body)
  return result.success ? result.data : null
}
