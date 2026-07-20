'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { usePrivy, useLinkAccount } from '@privy-io/react-auth'
import { useAuthStore } from '@/store/auth'
import { motion } from 'framer-motion'
import { Loader2, ArrowDown, Lock, AlertCircle, CheckCircle2, ArrowRight, Mail, LogIn } from 'lucide-react'
import { GradientActionButton } from '@/components/ui/GradientActionButton'
import { SocialPlatformIcon, type SocialIconPlatform } from '@/components/SocialPlatformIcon'
import confetti from 'canvas-confetti'

interface SharePaymentPreview {
  short_id: string
  sender_username: string | null
  recipient_username: string | null
  /** Set instead of recipient_username when the payment is addressed to a Discord/GitHub/Telegram handle. */
  recipient_social_platform: string | null
  recipient_social_handle: string | null
  amount_usd: number
  status: string
  is_devnet: boolean
  is_private: boolean
}

const PAID_STATUSES = new Set(['SUCCESS', 'PRIVATE_TRANSFER_PENDING', 'CLAIMED', 'FUNDED']);

/** Public preview of an existing payment, keyed by its own share `short_id` — the same code used
 *  in `/c/:short_id` links. Shows Loofta usernames (not Twitter handles) for sender/recipient and
 *  never exposes email or wallet address; once logged in as a party to it, the CTA hands off to
 *  the real `/c/:short_id` page, which owns all pay/claim logic. Mirrors `/tw/[short_id]`'s UI. */
export default function ShareClient({ short_id }: { short_id: string }) {
  const router = useRouter()
  const { ready, authenticated, login, user } = usePrivy()
  const { linkEmail } = useLinkAccount({})
  const networkMode = useAuthStore((s) => s.networkMode)
  const setNetworkMode = useAuthStore((s) => s.setNetworkMode)
  const myUsername = useAuthStore((s) => s.username ?? null)

  const hasEmail = user?.linkedAccounts?.some((a: any) => a.type === 'email' || a.type === 'google' || a.type === 'apple')

  const { data: request, isLoading } = useQuery<SharePaymentPreview>({
    queryKey: ['share-payment', short_id],
    queryFn: async () => {
      const res = await fetch(`/api/share/${short_id}`)
      if (!res.ok) throw new Error('Not found')
      return res.json()
    },
  })

  const isSender = !!myUsername && !!request?.sender_username && myUsername.toLowerCase() === request.sender_username.toLowerCase()
  const isRecipient = !!myUsername && !!request?.recipient_username && myUsername.toLowerCase() === request.recipient_username.toLowerCase()
  const isPaid = !!request && PAID_STATUSES.has(request.status)
  const isWrongNetwork = !!request && networkMode !== (request.is_devnet ? 'devnet' : 'mainnet')

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

  const amountDisplay = !request ? '' :
    request.amount_usd % 1 === 0 ? `$${request.amount_usd}` : `$${request.amount_usd.toFixed(2)}`

  const senderLabel = request?.sender_username ? `@${request.sender_username}` : 'Someone'
  const recipientHandle = request?.recipient_username
    ? `@${request.recipient_username}`
    : request?.recipient_social_handle
      ? `@${request.recipient_social_handle}`
      : 'someone'
  const recipientPlatform = !request?.recipient_username ? (request?.recipient_social_platform as SocialIconPlatform | null | undefined) : null
  const RecipientTag = ({ className }: { className?: string }) => (
    <span className={`inline-flex items-center gap-1.5 align-middle ${className ?? ''}`}>
      {recipientPlatform && <SocialPlatformIcon platform={recipientPlatform} className="h-[0.85em] w-[0.85em] shrink-0" />}
      {recipientHandle}
    </span>
  )

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
        {/* Network warning */}
        {isWrongNetwork && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <p className="text-base md:text-sm text-amber-300">This payment is on {request.is_devnet ? 'devnet' : 'mainnet'}</p>
            </div>
            <button
              onClick={() => setNetworkMode(request.is_devnet ? 'devnet' : 'mainnet')}
              className="shrink-0 text-base md:text-sm font-semibold text-amber-300 hover:text-amber-200 underline underline-offset-2"
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
              <Lock className="h-4 w-4 text-white/60" />
            )}
            <span className="text-base font-semibold text-white">
              {isPaid ? (isRecipient ? 'Payment received' : 'Payment sent') : 'Payment on Loofta'}
            </span>
          </div>

          {/* Transfer visual — vertical */}
          <div className="flex flex-col items-center gap-2 px-6 py-7">
            <span className="text-xl font-bold text-white">{senderLabel}</span>

            <div className="flex flex-col items-center gap-1.5 py-2">
              <ArrowDown className={`h-4 w-4 ${isPaid ? 'text-emerald-500/40' : 'text-white/20'}`} />
              <span className={`text-5xl font-bold tracking-tight ${isPaid ? 'text-emerald-400' : 'text-white'}`}>
                {amountDisplay}
              </span>
              <span className="text-base md:text-sm text-white/30 font-medium tracking-widest uppercase">USDC</span>
              <ArrowDown className={`h-4 w-4 ${isPaid ? 'text-emerald-500/40' : 'text-white/20'}`} />
            </div>

            <RecipientTag className="text-xl font-bold text-white" />
          </div>

          {/* Privacy note */}
          {request.is_private && (
            <div className="flex items-center justify-center gap-1.5 border-t border-white/[0.06] px-5 py-3">
              <Lock className="h-3.5 w-3.5 text-white/25" />
              <span className="text-base md:text-sm text-white/30">End-to-end private via MagicBlock</span>
            </div>
          )}
        </div>

        {/* CTA card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-5 space-y-4">

          {/* ── PAID state — shown to everyone ── */}
          {isPaid && (
            <GradientActionButton onClick={() => router.push(`/c/${request.short_id}`)}>
              {request.status === 'PRIVATE_TRANSFER_PENDING' ? 'Claim payment' : 'View payment'} <ArrowRight className="h-4 w-4" />
            </GradientActionButton>
          )}

          {/* ── UNPAID states (only shown when not paid) ── */}
          {!isPaid && (
            <>
              {/* Sender — payment still needs to be sent */}
              {isSender && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <p className="text-base md:text-sm text-emerald-300">Logged in as @{myUsername}</p>
                  </div>
                  <GradientActionButton onClick={() => router.push(`/c/${request.short_id}`)}>
                    Continue payment <ArrowRight className="h-4 w-4" />
                  </GradientActionButton>
                </div>
              )}

              {/* Recipient — waiting for sender */}
              {isRecipient && (
                <div className="space-y-3">
                  <div className="text-center space-y-1.5 py-1">
                    <p className="text-base font-medium text-white">You&apos;ll receive {amountDisplay}</p>
                    <p className="text-base md:text-sm text-white/40">
                      Waiting for {senderLabel} to send it. Come back once it&apos;s done.
                    </p>
                  </div>
                  {hasEmail ? (
                    <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/[0.08] px-3 py-2.5">
                      <Mail className="h-4 w-4 text-white/30 shrink-0" />
                      <p className="text-base md:text-sm text-white/40">You&apos;ll get an email notification when it arrives.</p>
                    </div>
                  ) : (
                    <button
                      onClick={() => linkEmail()}
                      className="w-full flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/[0.08] px-3 py-2.5 hover:bg-white/[0.07] transition-colors text-left"
                    >
                      <Mail className="h-4 w-4 text-white/40 shrink-0" />
                      <p className="text-base md:text-sm text-white/50">Add your email to be notified when it&apos;s on its way.</p>
                    </button>
                  )}
                </div>
              )}

              {/* Not logged in */}
              {!authenticated && (
                <div className="space-y-3">
                  <p className="text-center text-base text-white/50">
                    Are you <span className="text-white font-semibold">{senderLabel}</span> or{' '}
                    <RecipientTag className="text-white font-semibold" /> on Loofta?
                  </p>
                  <GradientActionButton onClick={login}>
                    <LogIn className="h-4 w-4" />
                    Log in to continue
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
                  <p className="text-base md:text-sm text-white/50">
                    You&apos;re @{myUsername}. This payment is between {senderLabel} and <RecipientTag />.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}
