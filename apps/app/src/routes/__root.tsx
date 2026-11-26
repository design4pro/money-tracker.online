import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { Wallet } from "lucide-react"
import appCss from "../styles.css?url"
import type { Env } from "@/server/env"

const sourceOffer = createServerFn({ method: "GET" }).handler(async () => {
  const { env } = await import("cloudflare:workers")
  const sha = (env as unknown as Env).SOURCE_SHA
  const repo = "https://github.com/design4pro/money-tracker.online"
  return sha && /^[a-f0-9]{40}$/i.test(sha) ? `${repo}/tree/${sha}` : repo
})

export const Route = createRootRoute({
  loader: () => sourceOffer(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "referrer", content: "no-referrer" },
      { title: "Money Tracker" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  notFoundComponent: () => (
    <main className="shell py-16">
      <h1>Page unavailable</h1>
      <Link to="/">Go to your dashboard</Link>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const source = Route.useLoaderData()
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="flex min-h-screen flex-col">
          <header className="border-b bg-card">
            <div className="shell flex min-h-16 flex-wrap items-center justify-between gap-4 py-3">
              <Link
                to="/"
                className="flex items-center gap-2 font-semibold tracking-tight"
              >
                <span className="rounded-lg bg-primary p-2 text-primary-foreground">
                  <Wallet size={19} aria-hidden="true" />
                </span>
                Money Tracker
              </Link>
              <nav
                aria-label="Main"
                className="flex items-center gap-5 text-sm"
              >
                <Link
                  to="/"
                  activeOptions={{ exact: true }}
                  activeProps={{ className: "text-primary" }}
                >
                  Dashboard
                </Link>
                <Link to="/billing" activeProps={{ className: "text-primary" }}>
                  Billing
                </Link>
              </nav>
            </div>
          </header>
          {children}
          <footer className="mt-auto border-t text-sm text-muted-foreground">
            <div className="shell flex flex-wrap justify-between gap-3 py-5">
              <span>Money Tracker</span>
              <a className="underline underline-offset-4" href={source}>
                Source code
              </a>
            </div>
          </footer>
        </div>
        <Scripts />
      </body>
    </html>
  )
}
