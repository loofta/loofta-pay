'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePrivy, useSigners } from '@privy-io/react-auth'
import { useWallets } from '@privy-io/react-auth/solana'
import { Loader2, AlertCircle, ShieldCheck } from 'lucide-react'
import { GradientActionButton } from '@/components/ui/GradientActionButton'
import { deriveSolanaEmbeddedAddress } from '@/lib/privySolanaEmbeddedAddress'
import { fetchApi } from '@/services/api/client'

// Set once the authorization key + spend policy exist in Privy's dashboard. Both are required:
// an empty policyIds array would grant the signer unrestricted power on the wallet.
const BOT_SIGNER_ID = process.env.NEXT_PUBLIC_LOOFTA_BOT_SIGNER_ID
const BOT_POLICY_ID = process.env.NEXT_PUBLIC_LOOFTA_BOT_POLICY_ID

interface AutopayStatus {
  isAdmin: boolean
  canEnable: boolean
  twitterHandle: string | null
  enrolled: boolean
  signerGranted: boolean
  perPaymentCapUsd: number
  maxPerPaymentCapUsd: number
  dailyCapUsd: number
  approvers: string[]
  termsAcceptedVersion: string | null
  currentTermsVersion: string
}

const STATUS_KEY = ['twitter-autopay-status']

export default function TwitterBotPage() {
  const { ready, authenticated, login, user, getAccessToken } = usePrivy()
  const { addSigners, removeSigners } = useSigners()
  const { wallets: solanaWallets } = useWallets()
  const queryClient = useQueryClient()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [perPayment, setPerPayment] = useState<string | null>(null)
  const [daily, setDaily] = useState<string | null>(null)
  const [acceptedTerms, setAcceptedTerms] = useState(false)

  const solanaAddress = deriveSolanaEmbeddedAddress(user) ?? solanaWallets[0]?.address ?? null

  const { data: status, isLoading } = useQuery<AutopayStatus>({
    queryKey: STATUS_KEY,
    queryFn: async () =>
      fetchApi<AutopayStatus>('/twitter-autopay/status', { accessToken: await getAccessToken() }),
    enabled: authenticated,
  })

  async function post(path: string, body?: unknown) {
    const updated = await fetchApi<AutopayStatus>(`/twitter-autopay/${path}`, {
      method: 'POST',
      accessToken: await getAccessToken(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    queryClient.setQueryData(STATUS_KEY, updated)
    return updated
  }

  async function run(fn: () => Promise<unknown>) {
    setWorking(true)
    setError(null)
    try {
      await fn()
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong')
    } finally {
      setWorking(false)
    }
  }

  const handleEnable = () =>
    run(async () => {
      if (!solanaAddress) throw new Error('No Solana wallet found on your account yet')
      if (!BOT_SIGNER_ID || !BOT_POLICY_ID) {
        // Never fall back to policyIds: [] (unrestricted grant).
        throw new Error('Not set up yet: the bot signer and spending policy are missing in Privy.')
      }
      const grant = () => addSigners({ address: solanaAddress, signers: [{ signerId: BOT_SIGNER_ID, policyIds: [BOT_POLICY_ID] }] })
      try {
        await grant()
      } catch (e: any) {
        // A grant from an earlier enrollment is still on the wallet. Clear it and add it again so
        // the signer always carries the current policy, instead of keeping a stale one.
        if (!/duplicate signer/i.test(e?.message ?? '')) throw e
        await removeSigners({ address: solanaAddress })
        await grant()
      }
      await post('enroll', { accepted_terms: true })
    })

  const handleDisable = () =>
    run(async () => {
      if (solanaAddress) await removeSigners({ address: solanaAddress }).catch(() => null)
      await post('unenroll')
    })

  const handleSaveLimits = () =>
    run(() =>
      post('limits', {
        per_payment_cap_usd: Number(perPayment ?? status?.perPaymentCapUsd),
        daily_cap_usd: Number(daily ?? status?.dailyCapUsd),
      }),
    )

  if (!ready || (authenticated && isLoading)) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <Loader2 className="h-7 w-7 animate-spin text-white/30" />
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="mx-auto max-w-xl px-4 py-16 text-center space-y-5">
          <h1 className="text-3xl font-semibold text-slate-100">Auto-pay</h1>
          <p className="text-lg text-slate-300">Sign in to let Loofta pay from your wallet when you ask, with limits you control.</p>
          <GradientActionButton onClick={() => login()}>Sign in</GradientActionButton>
        </div>
      </div>
    )
  }

  const card = 'rounded-2xl border border-white/[0.08] bg-white/[0.03] px-6 py-6 space-y-4'
  const input =
    'w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-lg text-white placeholder:text-white/30 focus:outline-none focus:border-orange-400'

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-white">Auto-pay</h1>
        <p className="text-lg text-slate-300 leading-relaxed">
          Let Loofta pay from your wallet when you ask it to, within limits you set. Message{' '}
          <a href="https://t.me/looftapay_bot" target="_blank" rel="noreferrer" className="text-white underline underline-offset-2">@looftapay_bot</a>{' '}
          on Telegram with <span className="text-white">send $5 to @alice</span>, or reply to someone in a group with{' '}
          <span className="text-white">/tip 5</span>. Recipients without a Loofta account get a claim link.
          Sign in to Loofta with the same Telegram account you use in the bot.
        </p>
      </div>

      <div className={card}>
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${status?.enrolled ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-amber-500/20 bg-amber-500/10'}`}>
          <ShieldCheck className={`h-5 w-5 shrink-0 ${status?.enrolled ? 'text-emerald-400' : 'text-amber-400'}`} />
          <span className={`flex-1 text-lg font-medium ${status?.enrolled ? 'text-emerald-300' : 'text-amber-300'}`}>
            {status?.enrolled ? 'Auto-pay is on' : 'Auto-pay is off'}
          </span>
        </div>

        {status?.enrolled ? (
          <GradientActionButton onClick={handleDisable} loading={working} loadingText="Turning off…">
            Turn off
          </GradientActionButton>
        ) : status?.canEnable ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-4 space-y-2 text-lg text-slate-300 leading-relaxed">
              <p className="text-white font-medium">Before you turn this on</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>You give Loofta permission to send USDC from your Loofta wallet when a command comes from your account or a teammate you name as an approver.</li>
                <li>Each payment is capped at ${status?.maxPerPaymentCapUsd ?? 500} at most, and you set your own per-payment and daily limits below. Both are checked on every payment.</li>
                <li>Payments are sent to the account named in the command. Check handles carefully, because a payment that has been sent cannot be reversed by Loofta.</li>
                <li>You can turn auto-pay off at any time, which removes the permission from your wallet.</li>
              </ul>
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-1.5 h-5 w-5 accent-orange-400"
              />
              <span className="text-lg text-white/80">I understand and accept these terms.</span>
            </label>
          <GradientActionButton onClick={handleEnable} loading={working} loadingText="Setting up…" disabled={!acceptedTerms}>
            Give Loofta access to fund
          </GradientActionButton>
          </div>
        ) : (
          <p className="text-lg text-slate-300">
            This is invite-only for now. Email{' '}
            <a href="mailto:hello@loofta.xyz" className="underline underline-offset-2 text-white/70 hover:text-white">hello@loofta.xyz</a>{' '}
            to get access.
          </p>
        )}
      </div>

      {status?.enrolled && (
        <>
          <div className={card}>
            <h2 className="text-xl font-semibold text-white">Spending limits</h2>
            <p className="text-lg text-slate-300">
              Hard limits checked on every payment, no matter who asks. The daily limit covers the last 24 hours.
            </p>
            <label className="block space-y-1.5">
              <span className="text-lg text-white/70">Max per payment (USD, up to {status.maxPerPaymentCapUsd})</span>
              <input className={input} inputMode="decimal" value={perPayment ?? String(status.perPaymentCapUsd)} onChange={(e) => setPerPayment(e.target.value)} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-lg text-white/70">Max per day (USD)</span>
              <input className={input} inputMode="decimal" value={daily ?? String(status.dailyCapUsd)} onChange={(e) => setDaily(e.target.value)} />
            </label>
            <GradientActionButton onClick={handleSaveLimits} loading={working} loadingText="Saving…">
              Save limits
            </GradientActionButton>
          </div>
        </>
      )}

      {error && (
        <div className="flex items-center gap-2.5 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
          <p className="text-lg text-red-300">{error}</p>
        </div>
      )}
    </div>
    </div>
  )
}
