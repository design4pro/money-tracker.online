import { Link, useNavigate } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { useState } from "react"
import { authClient, errorMessage } from "@/lib/client"
import { Button } from "./ui/button"

export function Session({
  children,
}: {
  children: (name: string, userId: string) => ReactNode
}) {
  const session = authClient.useSession()
  const navigate = useNavigate()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function signOut() {
    setBusy(true)
    setError("")
    try {
      const result = await authClient.signOut()
      if (result.error) throw new Error(result.error.message)
      await navigate({ to: "/login" })
    } catch (problem) {
      setError(errorMessage(problem))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell py-9 sm:py-12">
      {session.isPending ? (
        <p role="status">Checking your session…</p>
      ) : session.error ? (
        <section className="panel">
          <p role="alert">Your session could not be checked.</p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => void session.refetch()}
          >
            Try again
          </Button>
        </section>
      ) : session.data?.user.emailVerified ? (
        <>
          <div className="mb-5 flex justify-end">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          </div>
          {error && (
            <p role="alert" className="mb-3 text-destructive">
              {error}
            </p>
          )}
          {children(session.data.user.name, session.data.user.id)}
        </>
      ) : (
        <section className="panel mx-auto max-w-xl">
          <h1 className="text-2xl font-semibold">Your private workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with a verified email to manage your finances and
            subscription.
          </p>
          <div className="mt-5 flex gap-5 text-sm">
            <Link to="/login">Sign in</Link>
            <Link to="/register">Create an account</Link>
          </div>
        </section>
      )}
    </main>
  )
}
