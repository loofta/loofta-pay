'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { usePrivy } from '@privy-io/react-auth'
import { AlertCircle } from 'lucide-react'
import { GradientActionButton } from '@/components/ui/GradientActionButton'
import { fetchApi } from '@/services/api/client'

const card = 'rounded-2xl border border-white/[0.08] bg-white/[0.03] px-6 py-6 space-y-4'
const input =
  'w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-lg text-white placeholder:text-white/30 focus:outline-none focus:border-orange-400'

/** The consent screen an MCP client (Claude, ChatGPT...) sends people to when connecting to Loofta. */
function Authorize() {
  const { ready, authenticated, login, getAccessToken } = usePrivy()
  const q = useSearchParams()
  const clientId = q.get('client_id') ?? ''
  const redirectUri = q.get('redirect_uri') ?? ''
  const state = q.get('state') ?? ''
  const challenge = q.get('code_challenge') ?? ''
  const method = q.get('code_challenge_method') ?? 'S256'
  const [perPayment, setPerPayment] = useState('25')
  const [daily, setDaily] = useState('100')
  const [autoApprove, setAutoApprove] = useState('5')
  const [days, setDays] = useState('30')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const client = useQuery({
    queryKey: ['agent-oauth-client', clientId, redirectUri],
    enabled: ready && authenticated && !!clientId && !!redirectUri,
    retry: false,
    queryFn: async () =>
      fetchApi<{ client_name: string }>('/agent/oauth/describe', {
        method: 'POST',
        body: JSON.stringify({ client_id: clientId, redirect_uri: redirectUri }),
        accessToken: await getAccessToken(),
      }),
  })

  const shell = (children: React.ReactNode) => (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
      <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">{children}</div>
    </div>
  )

  if (!ready) return shell(null)
  if (!clientId || !redirectUri || !challenge) {
    return shell(<p className="text-lg text-slate-300">This link is incomplete. Start the connection again from your agent.</p>)
  }
  if (!authenticated) {
    return shell(
      <div className={card}>
        <h1 className="text-3xl font-semibold text-white">Connect to Loofta</h1>
        <p className="text-lg text-slate-300">Sign in to let an agent pay from your wallet, with limits you set.</p>
        <GradientActionButton onClick={() => login()}>Sign in</GradientActionButton>
      </div>,
    )
  }

  const goBack = (params: Record<string, string>) => {
    const url = new URL(redirectUri)
    Object.entries(params).forEach(([k, v]) => v && url.searchParams.set(k, v))
    window.location.href = url.toString()
  }

  const allow = async () => {
    setWorking(true)
    setError(null)
    try {
      const res = await fetchApi<{ redirect_to: string }>('/agent/oauth/approve', {
        method: 'POST',
        accessToken: await getAccessToken(),
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: challenge,
          code_challenge_method: method,
          state,
          per_payment_cap_usd: Number(perPayment),
          daily_cap_usd: Number(daily),
          auto_approve_usd: Number(autoApprove),
          expires_in_days: Math.round(Number(days)),
        }),
      })
      window.location.href = res.redirect_to
    } catch (e) {
      setError((e as Error).message || 'Something went wrong. Please try again.')
      setWorking(false)
    }
  }

  return shell(
    <div className={card}>
      <h1 className="text-3xl font-semibold text-white">Connect an agent</h1>
      {client.isLoading && <p className="text-lg text-slate-300">Loading…</p>}
      {client.error && <p className="text-lg text-red-300">This connection request is not valid. Start it again from your agent.</p>}
      {client.data && (
        <>
          <p className="text-lg text-slate-300 leading-relaxed">
            <span className="text-white">{client.data.client_name}</span> wants to see your balance and pay people from your Loofta wallet. Only continue if you started this yourself.
          </p>
          <label className="block space-y-1.5">
            <span className="text-lg text-white/70">Max per payment (USD)</span>
            <input className={input} inputMode="decimal" value={perPayment} onChange={(e) => setPerPayment(e.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-lg text-white/70">Max per day (USD)</span>
            <input className={input} inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-lg text-white/70">Sends without asking me up to (USD)</span>
            <input className={input} inputMode="decimal" value={autoApprove} onChange={(e) => setAutoApprove(e.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-lg text-white/70">Access lasts (days)</span>
            <input className={input} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <p className="text-lg text-slate-300">Payments to someone new, or above the amount you set, wait for your approval. You can disconnect any time on the Agents page.</p>
          <div className="flex flex-wrap items-center gap-4">
            <GradientActionButton onClick={allow} loading={working} loadingText="Connecting…">
              Allow
            </GradientActionButton>
            <button type="button" disabled={working} className="text-lg text-white/60 underline underline-offset-2 hover:text-white disabled:opacity-50" onClick={() => goBack({ error: 'access_denied', state })}>
              Deny
            </button>
          </div>
        </>
      )}
      {error && (
        <div className="flex items-center gap-2.5 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
          <p className="text-lg text-red-300">{error}</p>
        </div>
      )}
    </div>,
  )
}

export default function AuthorizePage() {
  return (
    <Suspense fallback={null}>
      <Authorize />
    </Suspense>
  )
}
