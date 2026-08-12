'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePrivy, useSigners } from '@privy-io/react-auth'
import { useWallets } from '@privy-io/react-auth/solana'
import { Tweet } from 'react-tweet'
import { Loader2, AlertCircle, CheckCircle2, ShieldCheck, Mail, AtSign, Link2, Wallet } from 'lucide-react'
import { GradientActionButton } from '@/components/ui/GradientActionButton'
import { deriveSolanaEmbeddedAddress } from '@/lib/privySolanaEmbeddedAddress'

import 'react-tweet/theme.css'

const DEMO_TWEET_ID = '2054549887178432847' // x.com/looftaxyz/status/2054549887178432847

// Set once the authorization key + policy exist in Privy's dashboard (see the plan doc —
// this is still a manual setup step, not something the app can provision itself).
const BOT_SIGNER_ID = process.env.NEXT_PUBLIC_LOOFTA_BOT_SIGNER_ID
const BOT_POLICY_ID = process.env.NEXT_PUBLIC_LOOFTA_BOT_POLICY_ID

interface AutopayStatus {
  isAdmin: boolean
  twitterHandle: string | null
  enrolled: boolean
  signerGranted: boolean
}

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.263 5.632L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  )
}

export default function TwitterBotPage() {
  const { ready, authenticated, login, user, getAccessToken } = usePrivy()
  const { addSigners, removeSigners } = useSigners()
  const { wallets: solanaWallets } = useWallets()
  const queryClient = useQueryClient()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const solanaAddress = deriveSolanaEmbeddedAddress(user) ?? solanaWallets[0]?.address ?? null
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'

  const { data: status, isLoading } = useQuery<AutopayStatus>({
    queryKey: ['twitter-autopay-status'],
    queryFn: async () => {
      const token = await getAccessToken()
      const res = await fetch(`${backendUrl}/twitter-autopay/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load status')
      return res.json()
    },
    enabled: authenticated,
  })

  async function callBackend(path: 'enroll' | 'unenroll') {
    const token = await getAccessToken()
    const res = await fetch(`${backendUrl}/twitter-autopay/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.message ?? 'Something went wrong')
    return data as AutopayStatus
  }

  async function handleEnable() {
    if (!solanaAddress) {
      setError('No Solana wallet found on your account yet')
      return
    }
    if (!BOT_SIGNER_ID) {
      setError('Not configured yet — the Loofta bot authorization key hasn’t been set up. Ask an engineer to finish the Privy setup.')
      return
    }
    if (!BOT_POLICY_ID) {
      // Refuse rather than fall back to policyIds: [] — an empty array grants the signer
      // FULL, UNRESTRICTED permission on the wallet (Privy's own semantics), not "no access."
      // Silently granting unlimited signing power because a config value was missing would be
      // exactly the kind of gap that's caused real drains elsewhere in this app.
      setError('Not configured yet — no spending-limit policy is set up. Ask an engineer to finish the Privy setup before enabling.')
      return
    }
    setWorking(true)
    setError(null)
    try {
      await addSigners({
        address: solanaAddress,
        signers: [{ signerId: BOT_SIGNER_ID, policyIds: [BOT_POLICY_ID] }],
      })
      const updated = await callBackend('enroll')
      queryClient.setQueryData(['twitter-autopay-status'], updated)
    } catch (e: any) {
      setError(e.message ?? 'Failed to enable')
    } finally {
      setWorking(false)
    }
  }

  async function handleDisable() {
    setWorking(true)
    setError(null)
    try {
      if (solanaAddress) {
        await removeSigners({ address: solanaAddress }).catch(() => null) // best-effort, don't block on this
      }
      const updated = await callBackend('unenroll')
      queryClient.setQueryData(['twitter-autopay-status'], updated)
    } catch (e: any) {
      setError(e.message ?? 'Failed to disable')
    } finally {
      setWorking(false)
    }
  }

  if (!ready || (authenticated && isLoading)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-7 w-7 animate-spin text-white/30" />
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
        <XLogo className="h-8 w-8 text-white/40" />
        <p className="text-white font-semibold text-lg">Twitter bot</p>
        <p className="text-white/40 text-lg max-w-xs">Log in to see your Twitter auto-pay settings.</p>
        <GradientActionButton onClick={login}>Log in</GradientActionButton>
      </div>
    )
  }

  // Everyone sees the full page — settings, current status, all of it. Only the actual
  // enable action is gated: non-admins get a "request access" prompt in place of the button.
  return (
    <div className="flex flex-col items-center px-4 pt-6 pb-16 min-h-[calc(100vh-64px)]">
      <div className="w-full max-w-xl space-y-5">
        {/* How it works */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
          <div className="flex items-center justify-center gap-2 border-b border-white/[0.06] px-6 py-4">
            <XLogo className="h-4 w-4 text-white/60" />
            <span className="text-xl font-semibold text-white">How it works</span>
          </div>
          <div className="px-6 py-6 space-y-5">
            <div className="flex items-start gap-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-sm font-semibold text-white/60">1</div>
              <div className="flex items-start gap-2.5">
                <AtSign className="h-5 w-5 text-white/30 shrink-0 mt-0.5" />
                <p className="text-lg text-slate-300 leading-relaxed">
                  Enable auto-pay below, then tag{' '}
                  <span className="text-white/80 font-medium">@looftapay</span>{' '}
                  on X: &ldquo;send $10 to @alice&rdquo;
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-sm font-semibold text-white/60">2</div>
              <div className="flex items-start gap-2.5">
                <Link2 className="h-5 w-5 text-white/30 shrink-0 mt-0.5" />
                <p className="text-lg text-slate-300 leading-relaxed">
                  The bot replies with a link. Only accounts enrolled here get a reply &mdash; nobody else can trigger it.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-sm font-semibold text-white/60">3</div>
              <div className="flex items-start gap-2.5">
                <Wallet className="h-5 w-5 text-white/30 shrink-0 mt-0.5" />
                <p className="text-lg text-slate-300 leading-relaxed">
                  Open the link, choose private or regular, and confirm. Your recipient gets a claim link for the money.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Real example */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
          <div className="flex items-center justify-center gap-2 border-b border-white/[0.06] px-6 py-4">
            <span className="text-xl font-semibold text-white">The bot in action</span>
          </div>
          <div className="px-3 py-5 flex justify-center [&_.react-tweet-theme]:mx-auto" data-theme="dark">
            <Tweet id={DEMO_TWEET_ID} />
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
          <div className="flex items-center justify-center gap-2 border-b border-white/[0.06] px-6 py-4">
            <XLogo className="h-4 w-4 text-white/60" />
            <span className="text-xl font-semibold text-white">Twitter bot</span>
          </div>

          <div className="px-6 py-6 space-y-5">
            {status?.twitterHandle ? (
              <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                <p className="text-lg text-white/70">Linked as @{status.twitterHandle}</p>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3">
                <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />
                <p className="text-lg text-amber-300">Link your X account in Loofta before enabling</p>
              </div>
            )}

            <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${status?.enrolled ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-amber-500/20 bg-amber-500/10'}`}>
              <ShieldCheck className={`h-5 w-5 shrink-0 ${status?.enrolled ? 'text-emerald-400' : 'text-amber-400'}`} />
              <span className={`flex-1 text-lg font-medium ${status?.enrolled ? 'text-emerald-300' : 'text-amber-300'}`}>
                {status?.enrolled ? 'Auto-pay enabled' : 'Auto-pay disabled'}
              </span>
            </div>

            <p className="text-lg text-slate-300 leading-relaxed">
              Enabling lets you use the bot on X and grants Loofta a scoped, revocable permission on your wallet for
              faster payments later. Right now, tagging the bot still gives you a link to confirm and send each
              payment yourself — see how it works above. You can disable this anytime.
            </p>

            {status?.enrolled ? (
              <GradientActionButton onClick={handleDisable} loading={working} loadingText="Disabling…">
                Disable auto-pay
              </GradientActionButton>
            ) : status?.isAdmin ? (
              <GradientActionButton onClick={handleEnable} loading={working} loadingText="Setting up…" disabled={!status?.twitterHandle}>
                Give Loofta access to fund
              </GradientActionButton>
            ) : (
              // Not admin — everything above still renders normally, only the enable action
              // itself is replaced. Access is limited while this rolls out, not the visibility
              // of the settings.
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-5 space-y-3 text-center">
                <p className="text-lg text-slate-300">
                  Auto-pay is limited to admins while we roll it out. Request access and we&apos;ll get you set up.
                </p>
                <div className="flex items-center justify-center gap-5 text-lg">
                  <a href="https://t.me/looftapay" target="_blank" rel="noreferrer" className="text-white/60 hover:text-white underline underline-offset-2">
                    t.me/looftapay
                  </a>
                  <a href="mailto:hello@loofta.xyz" className="flex items-center gap-1.5 text-white/60 hover:text-white underline underline-offset-2">
                    <Mail className="h-4 w-4" /> hello@loofta.xyz
                  </a>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2.5 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
                <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
                <p className="text-lg text-red-300">{error}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
