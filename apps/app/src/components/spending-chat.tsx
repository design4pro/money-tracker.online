import { Dialog } from "@base-ui/react/dialog"
import { MessageCircle, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { spendingEndpoint, spendingQuestion } from "@/lib/spending-chat"
import { Button } from "./ui/button"

type Turn = {
  status: "pending" | "complete" | "cancelled" | "denied" | "error"
  text: string
}

class ChatDenied extends Error {}

export function SpendingChat() {
  const [turn, setTurn] = useState<Turn>()
  const active = useRef<AbortController | null>(null)
  const askButton = useRef<HTMLButtonElement>(null)

  useEffect(() => () => active.current?.abort(), [])

  function stop() {
    active.current?.abort()
    active.current = null
    setTurn({ status: "cancelled", text: "Response stopped." })
    askButton.current?.focus()
  }

  async function ask() {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setTurn({ status: "pending", text: "" })
    let text = ""
    try {
      const { createHttpAgentChatRuntime } =
        await import("@agent-native/core/client/agent-chat")
      controller.signal.throwIfAborted()
      const runtime = createHttpAgentChatRuntime({
        endpoint: spendingEndpoint,
        credentials: "same-origin",
        mapRequest: ({ turn: request }) => ({ prompt: request.prompt }),
        fetch: async (input, init) => {
          const response = await fetch(input, init)
          if (response.status === 401)
            throw new ChatDenied("Sign in with a verified email to use chat.")
          if (response.status === 403)
            throw new ChatDenied(
              "An active subscription is required to use chat."
            )
          if (
            !response.ok ||
            !response.headers
              .get("content-type")
              ?.startsWith("text/event-stream")
          )
            throw new Error("Chat response unavailable")
          return response
        },
      })
      const session = await runtime.createSession()
      const response = await session.startTurn({
        prompt: spendingQuestion,
        abortSignal: controller.signal,
      })
      let complete = false
      for await (const event of response.events) {
        if (controller.signal.aborted) return
        if (event.type === "message-delta" && event.delta.type === "text") {
          text += event.delta.text
          setTurn({ status: "pending", text })
        }
        if (event.type === "error") throw new Error("Chat stream failed")
        if (event.type === "done") complete = event.reason === "complete"
      }
      if (!complete || !text) throw new Error("Chat response incomplete")
      if (!controller.signal.aborted) setTurn({ status: "complete", text })
    } catch (error) {
      if (!controller.signal.aborted) {
        setTurn(
          error instanceof ChatDenied
            ? { status: "denied", text: error.message }
            : {
                status: "error",
                text: "Chat is temporarily unavailable. Try again.",
              }
        )
      }
    } finally {
      if (active.current === controller) active.current = null
    }
  }

  const pending = turn?.status === "pending"
  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) {
          active.current?.abort()
          active.current = null
          setTurn(undefined)
        }
      }}
    >
      <Dialog.Trigger
        render={<Button variant="outline" />}
        className="spending-chat-entry h-11 rounded-lg sm:h-10"
      >
        <MessageCircle aria-hidden="true" /> Ask Money Tracker
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Popup
          initialFocus={askButton}
          className="spending-chat fixed inset-0 z-50 flex flex-col border-[#e5e5e5] bg-[#fafafa] text-[#0a0a0a] shadow-xl sm:left-auto sm:w-[min(28rem,100vw)] sm:border-l"
        >
          <header className="flex items-center justify-between gap-3 border-b border-[#e5e5e5] bg-white px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 sm:px-6">
            <div>
              <Dialog.Title className="text-lg font-semibold tracking-tight">
                Ask Money Tracker
              </Dialog.Title>
              <Dialog.Description className="text-sm text-[#6b6b6b]">
                Monthly spending from your ledger
              </Dialog.Description>
            </div>
            <Dialog.Close
              render={<Button variant="ghost" size="icon" />}
              className="size-11 rounded-lg"
              aria-label="Close chat"
            >
              <X aria-hidden="true" />
            </Dialog.Close>
          </header>
          <div className="flex-1 space-y-3 overflow-auto p-4 text-sm sm:p-6">
            {turn && (
              <p className="ml-auto w-fit rounded-xl bg-[#171717] px-4 py-3 text-white">
                {spendingQuestion}
              </p>
            )}
            <div role="status" aria-atomic="true" className="sr-only">
              {pending
                ? "Checking your spending…"
                : turn?.status === "complete" || turn?.status === "cancelled"
                  ? turn.text
                  : ""}
            </div>
            {pending && (
              <p aria-hidden="true" className="text-[#6b6b6b]">
                Checking your spending…
              </p>
            )}
            {turn?.text && (
              <p
                role={
                  turn.status === "denied" || turn.status === "error"
                    ? "alert"
                    : undefined
                }
                className="rounded-xl border border-[#e5e5e5] bg-white px-4 py-3 leading-relaxed wrap-anywhere"
              >
                {turn.text}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-[#e5e5e5] bg-white px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
            <Button
              ref={askButton}
              aria-disabled={pending}
              className="h-11 max-w-full rounded-lg bg-[#171717] text-white hover:bg-[#404040] aria-disabled:opacity-50"
              onClick={() => void ask()}
            >
              {spendingQuestion}
            </Button>
            {pending && (
              <Button
                variant="outline"
                className="h-11 rounded-lg"
                onClick={stop}
              >
                Stop response
              </Button>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
