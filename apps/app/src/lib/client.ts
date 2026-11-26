import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient()

export async function requestJson<T>(
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(
    `/api/pilot/${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
  )
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      message?: string
    } | null
    throw new Error(error?.message ?? "Request failed. Try again.")
  }
  return response.json<T>()
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed. Try again."
}

// Format signed minor units without converting large totals through Number.
export function money(amount: string | number, currency: string) {
  const format = new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  })
  const decimals = format.resolvedOptions().maximumFractionDigits ?? 2
  const value = BigInt(amount)
  const negative = value < 0n
  const absolute = negative ? -value : value
  const divisor = 10n ** BigInt(decimals)
  const integral = absolute / divisor
  const fraction = (absolute % divisor).toString().padStart(decimals, "0")
  const formatted = format.formatToParts(
    negative ? (integral === 0n ? -0 : -integral) : integral
  )
  return formatted
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("")
}
