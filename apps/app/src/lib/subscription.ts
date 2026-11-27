import { useEffect, useState } from "react"
import { errorMessage, requestJson } from "./client"

interface Subscription {
  status: "active" | "pending" | "expired" | "stale" | "inactive"
  spendingChat?: true
  expiresAt: number | null
}

export const subscriptionLabel = {
  active: "Active",
  pending: "Awaiting confirmation",
  expired: "Expired",
  stale: "Awaiting billing refresh",
  inactive: "No active subscription",
}

export function useSubscription(returning = false) {
  const [state, setState] = useState<Subscription>()
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let checks = 0
    async function check() {
      try {
        const result = await requestJson<Subscription>("status")
        if (live) {
          setState(result)
          setError("")
          if (result.status === "active") {
            timer = setTimeout(() => void check(), 60_000)
          } else if (
            (returning ||
              result.status === "pending" ||
              result.status === "stale") &&
            ++checks < 32
          ) {
            timer = setTimeout(() => void check(), 10_000)
          }
        }
      } catch (problem) {
        if (live) {
          setError(errorMessage(problem))
          if (returning && ++checks < 32)
            timer = setTimeout(() => void check(), 10_000)
        }
      }
    }
    void check()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [attempt, returning])

  return { state, error, refresh: () => setAttempt((value) => value + 1) }
}
