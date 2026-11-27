import { defineAction } from "@agent-native/core/action"
import { z } from "zod"
import { RequestError } from "./ledger"
import { spendingQuestion } from "../lib/spending-chat"

const resultSchema = z.object({
  from: z.string(),
  until: z.string(),
  totals: z.array(z.object({ currency: z.string(), amountMinor: z.string() })),
})
type Spending = z.infer<typeof resultSchema>

function monthlySpending(db: D1Database, userId: string, now: Date) {
  return defineAction({
    description: "Sum expenses by currency in the current UTC calendar month.",
    readOnly: true,
    mcpTool: false,
    schema: z.strictObject({}),
    outputSchema: resultSchema,
    async run() {
      const year = now.getUTCFullYear()
      const month = now.getUTCMonth()
      const from = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)
      const until = new Date(Date.UTC(year, month + 1, 1))
        .toISOString()
        .slice(0, 10)
      const { results } = await db
        .prepare(
          `SELECT currency, CAST(amount_minor AS TEXT) AS amount_minor
         FROM ledger_transaction
         WHERE user_id = ? AND booked_on >= ? AND booked_on < ? AND amount_minor < 0
         ORDER BY currency`
        )
        .bind(userId, from, until)
        .all<{ currency: string; amount_minor: string }>()
      const totals = new Map<string, bigint>()
      for (const row of results) {
        totals.set(
          row.currency,
          (totals.get(row.currency) ?? 0n) - BigInt(row.amount_minor)
        )
      }
      return {
        from,
        until,
        totals: Array.from(totals, ([currency, amount]) => ({
          currency,
          amountMinor: String(amount),
        })),
      }
    },
  })
}

function* testProvider({ from, until, totals }: Spending) {
  yield `Spending from ${from} up to ${until} (exclusive, UTC): `
  yield totals.length
    ? totals
        .map(
          ({ currency, amountMinor }) =>
            `${amountMinor} minor units (${currency})`
        )
        .join(", ")
    : "No expenses."
}

function streamAnswer(result: Spending) {
  const id = crypto.randomUUID()
  const chunks = testProvider(result)
  const encoder = new TextEncoder()
  function* events() {
    yield {
      type: "message-start",
      message: { id, role: "assistant", content: [] },
    }
    for (const chunk of chunks) {
      yield {
        type: "message-delta",
        messageId: id,
        delta: { type: "text", text: chunk },
      }
    }
    yield { type: "done", reason: "complete" }
  }
  const output = events()
  return new Response(
    new ReadableStream({
      cancel() {
        output.return()
      },
      pull(controller) {
        const next = output.next()
        if (next.done) controller.close()
        else
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`)
          )
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
      },
    }
  )
}

export async function spendingChat(
  db: D1Database,
  userId: string,
  body: Record<string, unknown>
) {
  if (
    !z.object({ prompt: z.literal(spendingQuestion) }).safeParse(body).success
  )
    throw new RequestError("Ask about spending this month.")
  return streamAnswer(await monthlySpending(db, userId, new Date()).run({}))
}
