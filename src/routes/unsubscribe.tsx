import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/unsubscribe')({
  component: UnsubscribePage,
  head: () => ({
    meta: [
      { title: 'Unsubscribe — Lumify' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
})

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; email?: string }
  | { kind: 'used' }
  | { kind: 'invalid' }
  | { kind: 'submitting' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

function UnsubscribePage() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const t = new URL(window.location.href).searchParams.get('token')
    if (!t) {
      setState({ kind: 'invalid' })
      return
    }
    setToken(t)
    fetch(`/email/unsubscribe?token=${encodeURIComponent(t)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (r.ok && data?.valid) setState({ kind: 'ready', email: data.email })
        else if (data?.reason === 'used') setState({ kind: 'used' })
        else setState({ kind: 'invalid' })
      })
      .catch(() => setState({ kind: 'invalid' }))
  }, [])

  async function confirm() {
    if (!token) return
    setState({ kind: 'submitting' })
    try {
      const r = await fetch('/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!r.ok) throw new Error('Failed')
      setState({ kind: 'done' })
    } catch (e: any) {
      setState({ kind: 'error', message: e?.message ?? 'Something went wrong' })
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground grid place-items-center px-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold mb-2">Unsubscribe from Lumify emails</h1>

        {state.kind === 'loading' && (
          <p className="text-sm text-muted-foreground">Checking your link…</p>
        )}

        {state.kind === 'ready' && (
          <>
            <p className="text-sm text-muted-foreground mb-6">
              {state.email
                ? `Unsubscribe ${state.email} from Lumify emails?`
                : 'Unsubscribe from Lumify emails?'}
            </p>
            <button
              onClick={confirm}
              className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium hover:opacity-90"
            >
              Confirm unsubscribe
            </button>
          </>
        )}

        {state.kind === 'submitting' && (
          <p className="text-sm text-muted-foreground">Unsubscribing…</p>
        )}

        {state.kind === 'done' && (
          <p className="text-sm">
            You've been unsubscribed. You will no longer receive emails from Lumify.
          </p>
        )}

        {state.kind === 'used' && (
          <p className="text-sm text-muted-foreground">
            This link has already been used. You are already unsubscribed.
          </p>
        )}

        {state.kind === 'invalid' && (
          <p className="text-sm text-destructive">
            This unsubscribe link is invalid or expired.
          </p>
        )}

        {state.kind === 'error' && (
          <p className="text-sm text-destructive">{state.message}</p>
        )}
      </div>
    </div>
  )
}
