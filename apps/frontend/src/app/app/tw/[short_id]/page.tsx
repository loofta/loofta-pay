'use client'

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { usePrivy, useLinkAccount } from '@privy-io/react-auth'
import { useAuthStore } from '@/store/auth'
import { motion } from 'framer-motion'
import { Loader2, ArrowDown, Lock, AlertCircle, CheckCircle2, ArrowRight, Mail } from 'lucide-react'
import { GradientActionButton } from '@/components/ui/GradientActionButton'
import { IncognitoModeToggle } from '@/components/IncognitoModeToggle'
import confetti from 'canvas-confetti'

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.263 5.632L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  )
}

interface TwitterPaymentRequest {
  short_id: string
  sender_twitter: string
  recipient_twitter: string
  amount_usd: number
  status: 'pending_funding' | 'funded' | 'expired' | 'cancelled'
  payment_id: string | null
  payment_status: string | null
  payment_short_id: string | null
  is_devnet: boolean
  expires_at: string
}

function getLinkedTwitterHandle(user: ReturnType<typeof usePrivy>['user']): string | null {
  const account = user?.linkedAccounts?.find((a: any) =>
    ['twitter_oauth', 'twitter_oauth2', 'twitter', 'x'].includes((a.type ?? '').toLowerCase()),
  ) as any
  return account?.username?.replace(/^@/, '').toLowerCase() ?? null
}

export default function TwitterPaymentPage({ params }: { params: Promise<{ short_id: string }> }) {
  const { short_id } = React.use(params)
  const router = useRouter()
  const { ready, authenticated, login, user, getAccessToken } = usePrivy()
  const { linkEmail } = useLinkAccount({})
  const networkMode = useAuthStore((s) => s.networkMode)
  const setNetworkMode = useAuthStore((s) => s.setNetworkMode)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Default true — preserves the prior always-private behavior for anyone who doesn't touch
  // the toggle, matching the pattern already proven on c/[id]/page.tsx.
  const [isPrivateMode, setIsPrivateMode] = useState(true)

  const hasEmail = user?.linkedAccounts?.some((a: any) => a.type === 'email' || a.type === 'google' || a.type === 'apple')

  const { data: request, isLoading } = useQuery<TwitterPaymentRequest>({
    queryKey: ['twitter-payment', short_id],
    queryFn: async () => {
      const res = await fetch(`/api/twitter-payments/${short_id}`)
      if (!res.ok) throw new Error('Not found')
      return res.json()
    },
  })

  const linkedHandle = getLinkedTwitterHandle(user)
  const isSender = !!linkedHandle && linkedHandle === request?.sender_twitter
  const isRecipient = !!linkedHandle && linkedHandle === request?.recipient_twitter
  const isPaid = request?.payment_status?.toUpperCase() === 'SUCCESS' ||
    request?.payment_status?.toUpperCase() === 'PRIVATE_TRANSFER_PENDING'

  const confettiFired = useRef(false)
  useEffect(() => {
    if (!isPaid || confettiFired.current) return
    confettiFired.current = true
    const end = Date.now() + 2200
    const colors = ['#FF1301', '#EAB308', '#22c55e', '#a855f7', '#3b82f6']
    ;(function frame() {
      confetti({ particleCount: 6, angle: 60, spread: 55, origin: { x: 0 }, colors })
      confetti({ particleCount: 6, angle: 120, spread: 55, origin: { x: 1 }, colors })
      if (Date.now() < end) requestAnimationFrame(frame)
    })()
  }, [isPaid])

  async function handleSend() {
    if (!request) return
    setSending(true)
    setError(null)
    try {
      const token = await getAccessToken()
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'
      const res = await fetch(`${backendUrl}/twitter-payments/${short_id}/fund`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_private: isPrivateMode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Failed to create payment')
      const path = data.payment_link ? new URL(data.payment_link).pathname : `/c/${data.payment_id}`
      router.push(path)
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong')
      setSending(false)
    }
  }

  const amountDisplay = !request ? '' :
    request.amount_usd % 1 === 0 ? `$${request.amount_usd}` : `$${request.amount_usd.toFixed(2)}`

  const paymentPath = request?.payment_short_id
    ? `/c/${request.payment_short_id}`
    : request?.payment_id ? `/c/${request.payment_id}` : null

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading || !ready) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-7 w-7 animate-spin text-white/30" />
      </div>
    )
  }

  if (!request) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 px-6 text-center">
        <p className="text-white font-semibold text-lg">Link not found</p>
        <p className="text-white/40 text-base">This payment link may have expired or been cancelled.</p>
        <Link href="/" className="text-base text-white/50 hover:text-white underline underline-offset-2 mt-2">Go to Loofta Pay</Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center px-4 pt-6 pb-16 min-h-[calc(100vh-64px)]">
      <motion.div
        className="w-full max-w-sm space-y-4"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {/* Mainnet warning */}
        {networkMode === 'mainnet' && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <p className="text-sm text-amber-300">Twitter payments run on devnet</p>
            </div>
            <button
              onClick={() => setNetworkMode('devnet')}
              className="shrink-0 text-sm font-semibold text-amber-300 hover:text-amber-200 underline underline-offset-2"
            >
              Switch
            </button>
          </div>
        )}

        {/* Card */}
        <div className={`rounded-2xl border overflow-hidden ${isPaid ? 'border-emerald-500/20 bg-emerald-500/[0.03]' : 'border-white/[0.08] bg-white/[0.03]'}`}>

          {/* Header strip */}
          <div className="flex items-center justify-center gap-2 border-b border-white/[0.06] px-5 py-4">
            {isPaid ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <XLogo className="h-4 w-4 text-white/60" />
            )}
            <span className="text-base font-semibold text-white">
              {isPaid ? (isRecipient ? 'Payment received' : 'Payment sent') : isPrivateMode ? 'Pay privately on X' : 'Pay on X'}
            </span>
          </div>

          {/* Transfer visual — vertical */}
          <div className="flex flex-col items-center gap-2 px-6 py-7">
            <span className="text-xl font-bold text-white">@{request.sender_twitter}</span>

            <div className="flex flex-col items-center gap-1.5 py-2">
              <ArrowDown className={`h-4 w-4 ${isPaid ? 'text-emerald-500/40' : 'text-white/20'}`} />
              <span className={`text-5xl font-bold tracking-tight ${isPaid ? 'text-emerald-400' : 'text-white'}`}>
                {amountDisplay}
              </span>
              <span className="text-sm text-white/30 font-medium tracking-widest uppercase">USDC</span>
              <ArrowDown className={`h-4 w-4 ${isPaid ? 'text-emerald-500/40' : 'text-white/20'}`} />
            </div>

            <span className="text-xl font-bold text-white">@{request.recipient_twitter}</span>
          </div>

          {/* Privacy note — only when the sender has private mode on (or the payment already
              settled privately); a regular payment shouldn't claim a privacy guarantee it didn't use. */}
          {(isPrivateMode || (isPaid && request.payment_status?.toUpperCase() === 'PRIVATE_TRANSFER_PENDING')) && (
            <div className="flex items-center justify-center gap-1.5 border-t border-white/[0.06] px-5 py-3">
              <Lock className="h-3.5 w-3.5 text-white/25" />
              <span className="text-sm text-white/30">End-to-end private via MagicBlock</span>
            </div>
          )}
        </div>

        {/* CTA card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-5 space-y-4">

          {/* ── PAID state — shown to everyone ── */}
          {isPaid && paymentPath && (
            <GradientActionButton onClick={() => router.push(paymentPath)}>
              {request.payment_status?.toUpperCase() === 'PRIVATE_TRANSFER_PENDING' ? 'Claim payment' : 'View payment'} <ArrowRight className="h-4 w-4" />
            </GradientActionButton>
          )}

          {/* ── UNPAID states (only shown when not paid) ── */}
          {!isPaid && (
            <>
              {/* Sender already initiated — come back to finish */}
              {isSender && request.payment_id && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <p className="text-sm text-emerald-300">Payment created — finish sending it</p>
                  </div>
                  <GradientActionButton onClick={handleSend} loading={sending} loadingText="Loading payment…" disabled={networkMode === 'mainnet'}>
                    Proceed to payment <ArrowRight className="h-4 w-4" />
                  </GradientActionButton>
                </div>
              )}

              {/* Recipient — payment not initiated yet */}
              {isRecipient && !request.payment_id && (
                <div className="space-y-3">
                  <div className="text-center space-y-1.5 py-1">
                    <p className="text-base font-medium text-white">You&apos;ll receive {amountDisplay}</p>
                    <p className="text-sm text-white/40">
                      Waiting for @{request.sender_twitter} to send it. Come back once it&apos;s done.
                    </p>
                  </div>
                  {hasEmail ? (
                    <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/[0.08] px-3 py-2.5">
                      <Mail className="h-4 w-4 text-white/30 shrink-0" />
                      <p className="text-sm text-white/40">You&apos;ll get an email notification when it arrives.</p>
                    </div>
                  ) : (
                    <button
                      onClick={() => linkEmail()}
                      className="w-full flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/[0.08] px-3 py-2.5 hover:bg-white/[0.07] transition-colors text-left"
                    >
                      <Mail className="h-4 w-4 text-white/40 shrink-0" />
                      <p className="text-sm text-white/50">Add your email to be notified when it&apos;s on its way.</p>
                    </button>
                  )}
                </div>
              )}

              {/* Not logged in */}
              {!authenticated && (
                <div className="space-y-3">
                  <p className="text-center text-base text-white/50">
                    Are you <span className="text-white font-semibold">@{request.sender_twitter}</span> on X?
                  </p>
                  <GradientActionButton onClick={login}>
                    <XLogo className="h-4 w-4" />
                    Log in to send
                  </GradientActionButton>
                </div>
              )}

              {/* Correct sender — not yet initiated */}
              {isSender && !request.payment_id && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <p className="text-sm text-emerald-300">Logged in as @{linkedHandle}</p>
                  </div>
                  <IncognitoModeToggle checked={isPrivateMode} onCheckedChange={setIsPrivateMode} />
                  <GradientActionButton onClick={handleSend} loading={sending} loadingText="Setting up payment…" disabled={networkMode === 'mainnet'}>
                    Send {amountDisplay} to @{request.recipient_twitter}
                  </GradientActionButton>
                </div>
              )}

              {/* Wrong user */}
              {authenticated && !isSender && !isRecipient && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                    <p className="text-base font-medium text-amber-300">Wrong account</p>
                  </div>
                  <p className="text-sm text-white/50">
                    You&apos;re @{linkedHandle}. This payment is for @{request.sender_twitter} to send to @{request.recipient_twitter}.
                  </p>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2.5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}
