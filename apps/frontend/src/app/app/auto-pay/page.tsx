'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePrivy, useSigners, useLinkAccount } from '@privy-io/react-auth'
import { useWallets } from '@privy-io/react-auth/solana'
import { Loader2, AlertCircle, ShieldCheck, X } from 'lucide-react'
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
  const searchParams = useSearchParams()
  // The bot sends people here with ?from=telegram, so we can offer Telegram as the only login
  // method (the account the bot finds is the one they actually linked) and prompt to connect it.
  const fromTelegram = searchParams.get('from') === 'telegram'
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [perPayment, setPerPayment] = useState<string | null>(null)
  const [daily, setDaily] = useState<string | null>(null)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [showConnect, setShowConnect] = useState(false)
  const [connectingTelegram, setConnectingTelegram] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  const solanaAddress = deriveSolanaEmbeddedAddress(user) ?? solanaWallets[0]?.address ?? null
  const telegramLinked = ((user?.linkedAccounts ?? []) as Array<{ type?: string }>).some(
    (a) => a.type === 'telegram' || a.type === 'telegram_oauth',
  )

  // Clear any bot-side sign-out left by the bot's /logout, so it recognizes this account again.
  const notifyBotReconnect = async () => {
    try {
      await fetchApi('/telegram-bot/reconnect', { method: 'POST', accessToken: await getAccessToken() })
    } catch {
      // Non-critical: the bot just keeps its local sign-out until the next successful app visit.
    }
  }

  const { linkOAuth } = useLinkAccount({
    onSuccess: async (arg: any) => {
      const linkedType = arg?.linkedAccount?.type
      if (linkedType === 'telegram' || linkedType === 'telegram_oauth') {
        setConnectingTelegram(false)
        setShowConnect(false)
        setConnectError(null)
        await notifyBotReconnect()
        await queryClient.invalidateQueries({ queryKey: STATUS_KEY })
      }
    },
    onError: () => {
      setConnectingTelegram(false)
      setConnectError('Could not connect Telegram. Please try again.')
    },
  })

  const handleConnectTelegram = async () => {
    setConnectingTelegram(true)
    setConnectError(null)
    try {
      await linkOAuth({ provider: 'telegram' })
    } catch (e: any) {
      setConnectingTelegram(false)
      setConnectError(e?.message ?? 'Could not connect Telegram. Please try again.')
    }
  }

  // Once signed in (e.g. after Telegram login), reconnect with the bot and, when they arrived
  // from the bot without Telegram linked yet, prompt them to connect it.
  useEffect(() => {
    if (!authenticated) return
    void notifyBotReconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated])

  useEffect(() => {
    if (authenticated && fromTelegram && !telegramLinked) setShowConnect(true)
  }, [authenticated, fromTelegram, telegramLinked])

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
          <p className="text-lg text-slate-300">
            {fromTelegram
              ? 'Sign in with Telegram to let the bot pay from your wallet when you ask, with limits you control.'
              : 'Sign in to let Loofta pay from your wallet when you ask, with limits you control.'}
          </p>
          <GradientActionButton onClick={() => login(fromTelegram ? { loginMethods: ['telegram'] } : undefined)}>
            {fromTelegram ? 'Sign in with Telegram' : 'Sign in'}
          </GradientActionButton>
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
          Let Loofta pay from your wallet when you ask, from Telegram or from an AI agent. Message{' '}
          <a href="https://t.me/looftapay_bot" target="_blank" rel="noreferrer" className="text-white underline underline-offset-2">@looftapay_bot</a>{' '}
          with <span className="text-white">pay $5 to @someone</span>, or connect an agent on the{' '}
          <a href="/agent" className="text-white underline underline-offset-2">Agents page</a>.
        </p>
      </div>

      {fromTelegram && !telegramLinked && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-400" />
          <p className="flex-1 text-lg text-amber-200">
            Connect your Telegram account so the bot knows it is you.
          </p>
          <button
            type="button"
            onClick={() => setShowConnect(true)}
            className="shrink-0 inline-flex items-center justify-center h-9 rounded-lg border border-[#FF7A2A]/40 text-[#FF7A2A] px-4 text-base font-semibold hover:bg-[#FF7A2A]/10 transition-all"
          >
            Connect
          </button>
        </div>
      )}

      <div className={card}>
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${status?.enrolled ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-amber-500/20 bg-amber-500/10'}`}>
          <ShieldCheck className={`h-5 w-5 shrink-0 ${status?.enrolled ? 'text-emerald-400' : 'text-amber-400'}`} />
          <span className={`flex-1 text-lg font-medium ${status?.enrolled ? 'text-emerald-300' : 'text-amber-300'}`}>
            {status?.enrolled ? 'Auto-pay is on' : 'Auto-pay is off'}
          </span>
        </div>

        {status?.enrolled ? (
          <div className="space-y-4">
            <p className="text-lg text-slate-300">You are ready. Open the bot and send your first payment.</p>
            <GradientActionButton onClick={() => window.open('https://t.me/looftapay_bot', '_blank', 'noopener,noreferrer')}>
              Open @looftapay_bot
            </GradientActionButton>
          </div>
        ) : status?.canEnable ? (
          <div className="space-y-4">
            <ul className="list-disc pl-5 space-y-1.5 text-lg text-slate-300 leading-relaxed">
              <li>Loofta can send USDC from your wallet when a command comes from your own Telegram account, or from an AI agent you connected. Both share the same limits below.</li>
              <li>A payment that has been sent cannot be reversed, so check the name before you confirm. You can turn this off any time.</li>
            </ul>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-1.5 h-5 w-5 accent-orange-400"
              />
              <span className="text-lg text-white/80">I understand and accept.</span>
            </label>
            <GradientActionButton onClick={handleEnable} loading={working} loadingText="Setting up…" disabled={!acceptedTerms}>
              Get started
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
            <h2 className="text-xl font-semibold text-white">Limits</h2>
            <p className="text-lg text-slate-300">
              Right now the bot can send up to ${status.perPaymentCapUsd} per payment and ${status.dailyCapUsd} a day. Change them any time.
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
          <button
            type="button"
            onClick={handleDisable}
            disabled={working}
            className="text-lg text-white/50 underline underline-offset-2 hover:text-white disabled:opacity-50"
          >
            {working ? 'Turning off…' : 'Turn off auto-pay'}
          </button>
        </>
      )}

      {error && (
        <div className="flex items-center gap-2.5 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
          <p className="text-lg text-red-300">{error}</p>
        </div>
      )}
    </div>

    {showConnect && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true">
        <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#141418] p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-xl font-semibold text-white">Connect Telegram</h2>
            <button
              type="button"
              onClick={() => setShowConnect(false)}
              aria-label="Close"
              className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="text-lg text-slate-300 leading-relaxed">
            The bot pays from your wallet when a command comes from your Telegram account. Connect it to your
            Loofta account here so the bot recognizes you.
          </p>
          <GradientActionButton onClick={handleConnectTelegram} loading={connectingTelegram} loadingText="Connecting…">
            Connect Telegram
          </GradientActionButton>
          {connectError && (
            <div className="flex items-center gap-2.5 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
              <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
              <p className="text-lg text-red-300">{connectError}</p>
            </div>
          )}
        </div>
      </div>
    )}
    </div>
  )
}
