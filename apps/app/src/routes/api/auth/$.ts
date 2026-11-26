import { env } from "cloudflare:workers"
import { createFileRoute } from "@tanstack/react-router"
import { createAuth } from "@/server/auth"
import type { Env } from "@/server/env"

function handle({ request }: { request: Request }) {
  return createAuth(env as unknown as Env).handler(request)
}

export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: handle, POST: handle } },
})
