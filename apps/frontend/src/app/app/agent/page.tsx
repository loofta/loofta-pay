'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePrivy } from '@privy-io/react-auth'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { GradientActionButton } from '@/components/ui/GradientActionButton'
import { fetchApi } from '@/services/api/client'

interface Described {
  label: string
  requested_scopes: string[]
  requester_ip: string | null
  requester_agent: string | null
  expires_at: string
}
interface SessionRow {
  id: string
  label: string
  token_prefix: string
  scopes: string[]
  per_payment_cap_usd: number
  daily_cap_usd: number
  auto_approve_usd: number
  expires_at: string
  last_used_at: string | null
}
interface ActionView {
  id: string
  status: string
  agent: string
  total_usd: number
  private: boolean
  approval_reason?: string
  recipients: Array<{ recipient: string; amount_usd: number; status: string }>
}

const SESSIONS_KEY = ['agent-sessions']
const card = 'rounded-2xl border border-white/[0.08] bg-white/[0.03] px-6 py-6 space-y-4'
const input =
  'w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-lg text-white placeholder:text-white/30 focus:outline-none focus:border-orange-400'

export default function AgentPage() {
  const { ready, authenticated, login, getAccessToken } = usePrivy()
  const queryClient = useQueryClient()
  const params = useSearchParams()
  const approveId = params.get('approve')
  const [code, setCode] = useState(params.get('code') ?? '')
  const [described, setDescribed] = useState<Described | null>(null)
  const [perPayment, setPerPayment] = useState('25')
  const [daily, setDaily] = useState('100')
  const [autoApprove, setAutoApprove] = useState('5')
  const [days, setDays] = useState('30')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const call = async <T,>(path: string, body?: unknown) =>
    fetchApi<T>(path, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body), accessToken: await getAccessToken() })

  const run = async (fn: () => Promise<void>) => {
    setWorking(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message || 'Something went wrong. Please try again.')
    } finally {
      setWorking(false)
    }
  }

  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    enabled: ready && authenticated,
    queryFn: async () => fetchApi<SessionRow[]>('/agent/sessions', { accessToken: await getAccessToken() }),
  })
  const action = useQuery({
    queryKey: ['agent-action', approveId],
    enabled: ready && authenticated && !!approveId,
    queryFn: async () => fetchApi<ActionView>(`/agent/actions/${approveId}`, { accessToken: await getAccessToken() }),
  })

  if (!ready) return <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12]" />

  const shell = (children: React.ReactNode) => (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
      <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">{children}</div>
    </div>
  )

  if (!authenticated) {
    return shell(
      <div className={card}>
        <h1 className="text-3xl font-semibold text-white">Connect an agent</h1>
        <p className="text-lg text-slate-300">Sign in to approve an agent or a payment it asked for.</p>
        <GradientActionButton onClick={() => login()}>Sign in</GradientActionButton>
      </div>,
    )
  }

  const errorBox = error && (
    <div className="flex items-center gap-2.5 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
      <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
      <p className="text-lg text-red-300">{error}</p>
    </div>
  )

  // A payment the agent wants approved
  if (approveId) {
    const a = action.data
    return shell(
      <div className={card}>
        <h1 className="text-3xl font-semibold text-white">Approve a payment</h1>
        {action.isLoading && <p className="text-lg text-slate-300">Loading…</p>}
        {action.error && <p className="text-lg text-red-300">This request was not found.</p>}
        {done && (
          <div className="flex items-center gap-2.5 text-lg text-emerald-300">
            <CheckCircle2 className="h-5 w-5" /> {done}
          </div>
        )}
        {a && !done && (
          <>
            <p className="text-lg text-slate-300">
              {a.agent} wants to send ${a.total_usd}
              {a.private ? ' privately' : ''}:
            </p>
            <ul className="space-y-1.5 text-lg text-white">
              {a.recipients.map((r) => (
                <li key={r.recipient}>
                  {r.recipient}: ${r.amount_usd}
                </li>
              ))}
            </ul>
            {a.approval_reason && <p className="text-lg text-slate-300">{a.approval_reason}</p>}
            {a.status !== 'needs_approval' ? (
              <p className="text-lg text-slate-300">This request is already {a.status.replace('_', ' ')}.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <GradientActionButton
                  loading={working}
                  loadingText="Sending…"
                  onClick={() => run(async () => { await call(`/agent/actions/${a.id}/approve`, {}); setDone('Approved. The payment is going out.') })}
                >
                  Approve and send
                </GradientActionButton>
                <button
                  type="button"
                  disabled={working}
                  className="text-lg text-white/60 underline underline-offset-2 hover:text-white disabled:opacity-50"
                  onClick={() => run(async () => { await call(`/agent/actions/${a.id}/deny`, {}); setDone('Declined. Nothing was sent.') })}
                >
                  Decline
                </button>
              </div>
            )}
          </>
        )}
        {errorBox}
      </div>,
    )
  }

  return shell(
    <>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-white">Agents</h1>
        <p className="text-lg text-slate-300 leading-relaxed">
          Let an AI agent pay people from your wallet. Run <span className="text-white">npx @loofta/mcp login</span> in your agent, then enter the code it shows.
        </p>
      </div>

      <div className={card}>
        <h2 className="text-xl font-semibold text-white">Connect with a code</h2>
        <input className={input} placeholder="XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />
        {!described ? (
          <GradientActionButton
            loading={working}
            loadingText="Checking…"
            disabled={code.trim().length < 8}
            onClick={() => run(async () => setDescribed(await call<Described>('/agent/auth/describe', { user_code: code })))}
          >
            Continue
          </GradientActionButton>
        ) : (
          <div className="space-y-4">
            <p className="text-lg text-slate-300">
              <span className="text-white">{described.label}</span> is asking for access
              {described.requester_ip ? ` from ${described.requester_ip}` : ''}. Only continue if you started this yourself.
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
            <div className="flex flex-wrap items-center gap-4">
              <GradientActionButton
                loading={working}
                loadingText="Connecting…"
                onClick={() =>
                  run(async () => {
                    await call('/agent/auth/approve', {
                      user_code: code,
                      per_payment_cap_usd: Number(perPayment),
                      daily_cap_usd: Number(daily),
                      auto_approve_usd: Number(autoApprove),
                      expires_in_days: Math.round(Number(days)),
                    })
                    setDescribed(null)
                    setCode('')
                    setDone('Connected. You can go back to your agent.')
                    queryClient.invalidateQueries({ queryKey: SESSIONS_KEY })
                  })
                }
              >
                Allow
              </GradientActionButton>
              <button
                type="button"
                disabled={working}
                className="text-lg text-white/60 underline underline-offset-2 hover:text-white disabled:opacity-50"
                onClick={() => run(async () => { await call('/agent/auth/deny', { user_code: code }); setDescribed(null); setCode('') })}
              >
                Deny
              </button>
            </div>
          </div>
        )}
        {done && (
          <div className="flex items-center gap-2.5 text-lg text-emerald-300">
            <CheckCircle2 className="h-5 w-5" /> {done}
          </div>
        )}
        {errorBox}
      </div>

      <div className={card}>
        <h2 className="text-xl font-semibold text-white">Connected agents</h2>
        {sessions.data?.length ? (
          <ul className="space-y-4">
            {sessions.data.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-4">
                <div className="text-lg text-slate-300">
                  <div className="text-white">{s.label}</div>
                  <div>${s.per_payment_cap_usd} per payment, ${s.daily_cap_usd} a day. Ends {new Date(s.expires_at).toLocaleDateString()}.</div>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-lg text-white/60 underline underline-offset-2 hover:text-white"
                  onClick={() => run(async () => { await call(`/agent/sessions/${s.id}/revoke`, {}); queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }) })}
                >
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-lg text-slate-300">No agents connected.</p>
        )}
      </div>
    </>,
  )
}
