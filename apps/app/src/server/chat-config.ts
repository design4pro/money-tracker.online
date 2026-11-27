import type { Env } from "./env"

export function spendingChatEnabled(env: Env) {
  return (
    env.LOCAL_CHAT_PROOF === "1" &&
    env.APP_ORIGIN === "http://localhost:3000" &&
    env.POLAR_ENVIRONMENT === "sandbox"
  )
}
