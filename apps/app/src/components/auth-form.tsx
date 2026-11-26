import { Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import type { FormEvent } from "react"
import { authClient, errorMessage } from "@/lib/client"
import { Button } from "./ui/button"

type Mode = "login" | "register" | "forgot" | "reset"

const labels = {
  login: "Sign in",
  register: "Create your account",
  forgot: "Request a password reset",
  reset: "Set a new password",
}

export function AuthForm({ mode, token }: { mode: Mode; token?: string }) {
  const navigate = useNavigate()
  const [feedback, setFeedback] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const email = String(fields.get("email") ?? "")
    const password = String(fields.get("password") ?? "")
    setBusy(true)
    setFeedback("")
    setError("")
    try {
      if (mode === "register") {
        const result = await authClient.signUp.email({
          email,
          password,
          name: String(fields.get("name")),
          callbackURL: "/login",
        })
        if (result.error) throw new Error(result.error.message)
        setFeedback("Check your inbox for a verification link, then sign in.")
      } else if (mode === "login") {
        const result = await authClient.signIn.email({
          email,
          password,
          callbackURL: "/",
        })
        if (result.error?.code === "EMAIL_NOT_VERIFIED") {
          setFeedback(
            "Verify your email using the link in your inbox, then sign in."
          )
        } else {
          if (result.error) throw new Error(result.error.message)
          await navigate({ to: "/" })
        }
      } else if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({
          email,
          redirectTo: "/reset-password",
        })
        if (result.error) throw new Error(result.error.message)
        setFeedback(
          "If there is an account for that email, a reset link will arrive shortly."
        )
      } else {
        const result = await authClient.resetPassword({
          newPassword: password,
          token,
        })
        if (result.error) throw new Error(result.error.message)
        setFeedback("Password updated. You can now sign in.")
      }
    } catch (problem) {
      setError(errorMessage(problem))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="shell grid flex-1 place-items-center py-12">
      <section className="panel w-full max-w-md">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight">
          {labels[mode]}
        </h1>
        {mode === "register" && (
          <p className="mb-5 text-sm text-muted-foreground">
            Verify your email to access your private dashboard.
          </p>
        )}
        {mode === "reset" && !token ? (
          <p role="alert">
            This reset link is invalid or expired.{" "}
            <Link to="/forgot-password">Request a new link</Link>.
          </p>
        ) : (
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => void submit(event)}
          >
            {mode === "register" && (
              <label>
                Name
                <input
                  name="name"
                  required
                  maxLength={80}
                  autoComplete="name"
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                />
              </label>
            )}
            {mode !== "forgot" && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={mode === "login" ? undefined : 12}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                />
                {mode !== "login" && (
                  <span className="text-xs text-muted-foreground">
                    At least 12 characters
                  </span>
                )}
              </label>
            )}
            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? "Working…" : labels[mode]}
            </Button>
          </form>
        )}
        {error && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {feedback && (
          <p className="mt-4 text-sm" role="status">
            {feedback}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-4 text-sm">
          {mode === "login" ? (
            <>
              <Link to="/register">Create an account</Link>
              <Link to="/forgot-password">Forgot password?</Link>
            </>
          ) : (
            <Link to="/login">Back to sign in</Link>
          )}
        </div>
      </section>
    </main>
  )
}
