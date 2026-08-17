'use client'

import { useState, useRef, useEffect } from 'react'
import confetti from 'canvas-confetti'
import bs58 from 'bs58'
import { formatDistanceToNowStrict } from 'date-fns'
import { usePrivy } from '@privy-io/react-auth'
import {
  useWallets as useSolanaWallets,
  useSignTransaction as usePrivySolanaSignTransaction,
  useSignAndSendTransaction,
} from '@privy-io/react-auth/solana'
import { Connection } from '@solana/web3.js'
import { useAuthStore } from '@/store/auth'
import { useMultiSendStore } from '@/store/multiSend'
import { useSolanaPayment } from '@/hooks/useSolanaPayment'
import { MultiSendFlow } from '@/components/app/MultiSendFlow'
import { createClaimFromEmail } from '@/lib/createClaimFromEmail'
import { createClaimFromUsername } from '@/lib/createClaimFromUsername'
import { createClaimFromSocial } from '@/lib/createClaimFromSocial'
import { getClaimById, updateClaimStatus } from '@/services/api/claims'
import { checkUsernameExists } from '@/services/api/users'
import { fetchRecentRecipients, type RecentRecipient } from '@/services/api/recentRecipients'
import { buildMultiSend, multiConfirm, type MultiSendRecipient, type MultiSendLinkItem } from '@/services/api/sendPayment'
import { buyGift, confirmGiftSend } from '@/services/api/lotteryGift'
import { parseAgentCommand, type ParsedRecipient } from '@/lib/parseAgentCommand'
import { parseGiftCommand, type ParsedGiftRecipient } from '@/lib/parseGiftCommand'
import { TELEGRAM_SEND_ENABLED } from '@/lib/socialPlatforms'
import { getRpcForMode, getRpcFallbackForMode, getPrivySolanaChainForMode } from '@/lib/solanaRpc'
import { waitForSignatureConfirmation } from '@/lib/per/confirmSignature'
import { deriveSolanaEmbeddedAddress } from '@/lib/privySolanaEmbeddedAddress'
import { ShareLinkMenu } from '@/components/ShareLinkMenu'
import { MessageInput } from '@/components/MessageInput'
import { IncognitoModeToggle } from '@/components/IncognitoModeToggle'
import { SocialPlatformIcon, type SocialIconPlatform } from '@/components/SocialPlatformIcon'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Send, Loader2, Copy, Check, ExternalLink, AlertCircle, Clock, Ticket } from 'lucide-react'

function fireConfetti() {
  confetti({
    particleCount: 40,
    spread: 55,
    startVelocity: 28,
    scalar: 0.7,
    origin: { x: 0.5, y: 0.5 },
    colors: ['#FF1301', '#EAB308', '#22c55e'],
  })
}

const MIN_SEND_USD = 5
const MULTI_MAX_RECIPIENTS = 10
const LOOFTA_ICON = '/images/icons/loofta-icon.svg'

type CardState = 'pending' | 'sending' | 'sent' | 'cancelled' | 'failed'

interface PaymentCard {
  recipient: ParsedRecipient
  amount: number
  state: CardState
  message: string
  gifUrl: string | null
  isPrivate: boolean
  /** True when this exact recipient never showed up in the sender's own payment history. */
  isNewRecipient: boolean
  /** Set once the claim/burner is created — kept so a retry after a failed on-chain send
   *  reuses the same claim instead of creating a duplicate pending claim every attempt. */
  claimId?: string
  shortId?: string | null
  destinationAddress?: string
  /** Set the moment the on-chain transfer itself succeeds — once this is set, a retry must
   *  never call makePayment again (that would double-send); only the status-sync step is safe
   *  to retry. */
  txHash?: string
  link?: string
  errorMessage?: string
}

interface GiftCard {
  recipient: ParsedGiftRecipient
  numTickets: number
  state: CardState
  message: string
  gifUrl: string | null
  isPrivate: boolean
  /** Set once buy-gift has returned an id — a gift is only actually created once buy-gift-confirm
   *  succeeds, so unlike PaymentCard there's no meaningful "reuse across retries" state here; a
   *  retry after a failure just runs the whole buy → sign → confirm sequence again, same as the
   *  existing self-service gift UI on /app/megapot already does. */
  claimUrl?: string
  errorMessage?: string
}

interface PlatformChoice {
  identifier: string
  amount: number
  isPrivate: boolean
  resolved: boolean
}

interface MultiPlatformChoice {
  /** Full recipient list for the multi-send — platform gets patched in for the ambiguous ones. */
  recipients: ParsedRecipient[]
  /** Identifiers (lowercased) needing clarification — unregistered "username"-defaulted recipients. */
  ambiguousIdentifiers: string[]
  isPrivate: boolean
  resolved: boolean
}

interface MultiPaymentCard {
  recipients: ParsedRecipient[]
  state: CardState
  /** One shared message applied to every recipient — matches the compact card's "one
   *  confirmation, multisend behind" framing rather than a message box per row. */
  message: string
  gifUrl: string | null
  links?: MultiSendLinkItem[]
  errorMessage?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  tone?: 'error' | 'info'
  card?: PaymentCard
  multiCard?: MultiPaymentCard
  giftCard?: GiftCard
  platformChoice?: PlatformChoice
  multiPlatformChoice?: MultiPlatformChoice
  insufficientFunds?: { neededUsd: number }
}

const PLATFORM_CHOICES: { id: SocialIconPlatform; label: string }[] = [
  { id: 'discord', label: 'Discord' },
  { id: 'github', label: 'GitHub' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'twitter', label: 'X' },
]

const EXAMPLE_PROMPTS = ['send $5 to @alice on X', 'send $10 to @bob on Telegram', 'send $5 to @alice on X and $10 to @bob on telegram', 'gift 5 lottery tickets to @alice']

function platformLabel(p: ParsedRecipient['platform'] | ParsedGiftRecipient['platform']) {
  switch (p) {
    case 'twitter': return 'X'
    case 'telegram': return 'Telegram'
    case 'discord': return 'Discord'
    case 'github': return 'GitHub'
    case 'email': return 'Email'
    default: return 'Loofta'
  }
}

// "loo-" is a fixed prefix on Loofta usernames — strip one if the user already typed it
// (e.g. "loo-alice") so it isn't doubled up into "loo-loo-alice".
function looUsername(identifier: string) {
  return `loo-${identifier.replace(/^loo-/i, '')}`
}

function recipientDisplay(rec: ParsedRecipient | ParsedGiftRecipient) {
  if (rec.platform === 'email') return rec.identifier
  if (rec.platform === 'username') return looUsername(rec.identifier)
  return `@${rec.identifier}`
}

let idCounter = 0
function nextId() {
  idCounter += 1
  return `agent-msg-${idCounter}`
}

function Avatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1a1a22] border border-white/10 mt-0.5">
      <img src={LOOFTA_ICON} alt="" className="h-[18px] w-[18px]" />
    </div>
  )
}

export function AgentChatBox() {
  const { authenticated, login, user, getAccessToken } = usePrivy()
  const networkMode = useAuthStore((s) => s.networkMode)
  const apiCluster = networkMode === 'mainnet' ? 'mainnet' : 'devnet'
  const { setRows, setReviewPending, clear } = useMultiSendStore()
  const solanaPayment = useSolanaPayment()
  const { wallets: solanaWallets } = useSolanaWallets()
  const { signTransaction: privySolanaSignTransaction } = usePrivySolanaSignTransaction()
  const { signAndSendTransaction } = useSignAndSendTransaction()

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: nextId(),
      role: 'assistant',
      text: 'Hey! Try "send $5 to @alice on X" or "gift 5 lottery tickets to @alice". Works with X, Telegram, Discord, Github, loofta username and email.',
    },
  ])
  const [input, setInput] = useState('')
  const [examplesVisible, setExamplesVisible] = useState(true)
  const [multiSendOpen, setMultiSendOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const [recentRecipients, setRecentRecipients] = useState<RecentRecipient[]>([])
  const [mention, setMention] = useState<{ query: string; start: number; end: number; index: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, multiSendOpen])

  useEffect(() => {
    if (!authenticated) return
    let cancelled = false
    getAccessToken().then((accessToken) => fetchRecentRecipients(accessToken, networkMode)).then((list) => {
      if (!cancelled) setRecentRecipients(list)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated])

  function isKnownRecipient(rec: ParsedRecipient): boolean {
    return recentRecipients.some((r) => r.platform === rec.platform && r.identifier.toLowerCase() === rec.identifier.toLowerCase())
  }

  const mentionMatches = mention
    ? recentRecipients.filter((r) => r.identifier.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6)
    : []
  // Clamped separately from mention.index — the filtered list can shrink as the query changes
  // faster than the index resets, which would otherwise point past the end of the new list.
  const mentionActiveIndex = mention ? Math.min(mention.index, Math.max(mentionMatches.length - 1, 0)) : 0

  /** Detects an in-progress "@handle" the caret is inside of — start-of-word only, no
   *  whitespace typed yet after the "@" — same convention as X/Discord-style mention pickers. */
  function detectMention(value: string, caret: number): { query: string; start: number; end: number } | null {
    const upToCaret = value.slice(0, caret)
    const at = upToCaret.lastIndexOf('@')
    if (at === -1) return null
    const before = upToCaret[at - 1]
    if (at > 0 && before && !/\s/.test(before)) return null
    const query = upToCaret.slice(at + 1)
    if (/\s/.test(query)) return null
    return { query, start: at, end: caret }
  }

  function handleInputChange(value: string, caret: number) {
    setInput(value)
    const found = detectMention(value, caret)
    setMention(found ? { ...found, index: 0 } : null)
  }

  function selectMention(r: RecentRecipient) {
    if (!mention) return
    const insertion =
      r.platform === 'email' ? r.identifier
        : r.platform === 'username' ? `@${r.identifier}`
          : `@${r.identifier} on ${platformLabel(r.platform)}`
    const next = `${input.slice(0, mention.start)}${insertion} ${input.slice(mention.end)}`
    setInput(next)
    setMention(null)
    requestAnimationFrame(() => {
      const caret = mention.start + insertion.length + 1
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(caret, caret)
    })
  }

  function pushAssistant(text: string, tone?: 'error' | 'info') {
    setMessages((m) => [...m, { id: nextId(), role: 'assistant', text, tone }])
  }

  function updateCard(id: string, patch: Partial<PaymentCard>) {
    setMessages((m) => m.map((msg) => (msg.id === id && msg.card ? { ...msg, card: { ...msg.card, ...patch } } : msg)))
  }

  function updateMultiCard(id: string, patch: Partial<MultiPaymentCard>) {
    setMessages((m) => m.map((msg) => (msg.id === id && msg.multiCard ? { ...msg, multiCard: { ...msg.multiCard, ...patch } } : msg)))
  }

  async function sendSingle(rec: ParsedRecipient, amount: number, isPrivate: boolean, description?: string) {
    const accessToken = await getAccessToken()
    const amountStr = String(amount)
    if (rec.platform === 'email') {
      return createClaimFromEmail({ email: rec.identifier, amount: amountStr, userId: user?.id, accessToken, isPrivate, cluster: apiCluster, description })
    }
    if (rec.platform === 'twitter') {
      return createClaimFromUsername({
        username: rec.identifier,
        amount: amountStr,
        userId: user?.id,
        accessToken,
        isPrivate,
        cluster: apiCluster,
        treatUnregisteredAsTwitter: true,
        description,
      })
    }
    if (rec.platform === 'username') {
      return createClaimFromUsername({ username: looUsername(rec.identifier), amount: amountStr, userId: user?.id, accessToken, isPrivate, cluster: apiCluster, description })
    }
    return createClaimFromSocial({ platform: rec.platform, handle: rec.identifier, amount: amountStr, userId: user?.id, accessToken, isPrivate, cluster: apiCluster, description })
  }

  async function handleConfirm(id: string, card: PaymentCard) {
    updateCard(id, { state: 'sending', errorMessage: undefined })
    try {
      const accessToken = await getAccessToken()

      // Create the claim/burner only on the first attempt — a retry after a failed on-chain
      // send reuses the same claimId/destination instead of minting a new pending claim.
      let { claimId, shortId, destinationAddress } = card
      if (!claimId || !destinationAddress) {
        const description = [card.message.trim(), card.gifUrl].filter(Boolean).join(' ').trim() || undefined
        const result = await sendSingle(card.recipient, card.amount, card.isPrivate, description)
        claimId = result.id
        shortId = result.short_id ?? null
        const { claim } = await getClaimById(claimId, user?.id, accessToken)
        destinationAddress = (claim.claim_burner_address || claim.recipient_address || '').trim()
        if (!destinationAddress) throw new Error('Could not resolve a payment destination for this claim.')
        updateCard(id, { claimId, shortId, destinationAddress })
      }

      // Once the on-chain transfer succeeds, never call makePayment again for this card — a
      // retry from here on must only retry the (best-effort) status sync below, never re-send.
      let txHash = card.txHash
      if (!txHash) {
        txHash = await solanaPayment.makePayment({ amount: card.amount, recipientAddress: destinationAddress, claimId })
        updateCard(id, { txHash })
      }

      // Fire-and-forget, matching MultiSendFlow's own multiConfirm(...).catch(() => {}) pattern:
      // the money has already moved, so a status-sync hiccup here must never surface as "failed"
      // (that would show a "Try again" that could re-trigger makePayment and double-send).
      updateClaimStatus(
        claimId,
        'SUCCESS',
        { txHash, paidWith: 'USDC (Loofta)', paidWithToken: 'USDC', paidWithChain: 'solana' },
        user?.id,
        accessToken,
      ).catch((e: unknown) => {
        console.error(`[AgentChatBox] status sync failed for claim ${claimId} (payment already sent, safe to ignore):`, e)
      })

      const link = `${window.location.origin}/share/${shortId ?? claimId}`
      updateCard(id, { state: 'sent', link })
      fireConfetti()
    } catch (e: unknown) {
      updateCard(id, { state: 'failed', errorMessage: e instanceof Error ? e.message : 'Something went wrong.' })
    }
  }

  function handleCancel(id: string) {
    updateCard(id, { state: 'cancelled' })
  }

  function pushPaymentCard(rec: ParsedRecipient, amount: number, isPrivate: boolean) {
    setMessages((m) => [
      ...m,
      {
        id: nextId(),
        role: 'assistant',
        text: "Here's your payment — confirm to send.",
        card: { recipient: rec, amount, state: 'pending', message: '', gifUrl: null, isPrivate, isNewRecipient: !isKnownRecipient(rec) },
      },
    ])
  }

  function choosePlatform(msgId: string, platform: SocialIconPlatform, identifier: string, amount: number, isPrivate: boolean) {
    setMessages((m) => m.map((msg) => (msg.id === msgId && msg.platformChoice ? { ...msg, platformChoice: { ...msg.platformChoice, resolved: true } } : msg)))
    if (platform === 'telegram' && !TELEGRAM_SEND_ENABLED) {
      pushAssistant('Sending to Telegram is temporarily unavailable — try X, Discord, or GitHub instead.', 'error')
      return
    }
    pushPaymentCard({ raw: identifier, platform, identifier, amount }, amount, isPrivate)
  }

  function pushInsufficientFunds(neededUsd: number) {
    setMessages((m) => [
      ...m,
      {
        id: nextId(),
        role: 'assistant',
        text: `Not enough funds — you have $${solanaPayment.balanceUSD.toFixed(2)} available and this needs $${neededUsd.toFixed(2)}. Add funds first, then try again.`,
        insufficientFunds: { neededUsd },
      },
    ])
  }

  function pushMultiPaymentCard(recipients: ParsedRecipient[]) {
    setMessages((m) => [
      ...m,
      {
        id: nextId(),
        role: 'assistant',
        text: `Here's your payment to ${recipients.length} recipients — confirm to send.`,
        multiCard: { recipients, state: 'pending', message: '', gifUrl: null },
      },
    ])
  }

  /** Final step of building a multi-send, once every recipient's platform is resolved. Public
   *  (non-private) sends get the compact in-chat confirm card — one combined transaction, no
   *  fees, same shape as the single-payment card. Private sends fall back to the full
   *  MultiSendFlow below the chat, since that's the only path with the hub-fee calculation and
   *  its own privacy toggle — cramming that into the compact card isn't worth the complexity. */
  function finalizeMultiSend(recipients: ParsedRecipient[], isPrivate: boolean) {
    const total = recipients.reduce((s, r) => s + r.amount, 0)
    if (!solanaPayment.hasEnoughBalance(total)) {
      pushInsufficientFunds(total)
      return
    }
    if (!isPrivate) {
      pushMultiPaymentCard(recipients)
      return
    }
    setRows(
      recipients.map((r, i) => ({
        id: `agent-ms-${Date.now()}-${i}`,
        recipient: r.identifier,
        amount: String(r.amount),
        message: '',
        recipientType: r.platform,
      })),
    )
    setReviewPending(true)
    setMultiSendOpen(true)
    pushAssistant(
      `Got it — private multi-send needs the fee breakdown below. $${total.toFixed(2)} total to ${recipients.length} recipients. Review and pay below.`,
    )
  }

  async function handleConfirmMulti(id: string, card: MultiPaymentCard) {
    updateMultiCard(id, { state: 'sending', errorMessage: undefined })
    try {
      const accessToken = await getAccessToken()
      if (!user?.id) throw new Error('Not authenticated')
      const senderAddress = deriveSolanaEmbeddedAddress(user)
      const wallet = solanaWallets.find((w) => w.address === senderAddress) ?? solanaWallets[0]
      if (!wallet) throw new Error('Loofta wallet not found. Try logging out and back in.')

      const message = [card.message.trim(), card.gifUrl].filter(Boolean).join(' ').trim() || undefined
      const multiRecipients: MultiSendRecipient[] = card.recipients.map((r) => ({
        amount: r.amount,
        recipient_type: r.platform,
        recipient_identifier: r.platform === 'username' ? looUsername(r.identifier) : r.identifier,
        message,
      }))

      const cluster = networkMode === 'mainnet' ? 'mainnet' : 'devnet'
      const chain = getPrivySolanaChainForMode(networkMode)

      const result = await buildMultiSend({ recipients: multiRecipients, sender_wallet: wallet.address, cluster }, user.id, accessToken)

      // showWalletUIs: false — the fee payer covers gas, not the user's wallet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signedOutput = await (privySolanaSignTransaction as any)({
        transaction: Buffer.from(result.transactionBase64, 'base64') as Uint8Array,
        wallet,
        chain,
        options: { uiOptions: { showWalletUIs: false } },
      })
      const signedBytes: Uint8Array = signedOutput.signedTransaction

      const broadcastConn = new Connection(getRpcForMode(cluster), 'confirmed')
      const sig = await broadcastConn.sendRawTransaction(signedBytes, { skipPreflight: true, maxRetries: 3 })
      const fallbackRpcUrl = getRpcFallbackForMode(cluster)
      const fallbackConn = fallbackRpcUrl ? new Connection(fallbackRpcUrl, 'confirmed') : undefined
      try {
        await waitForSignatureConfirmation(broadcastConn, sig, 120_000, 1500, 'multiSend', fallbackConn)
      } catch (e: unknown) {
        // MagicBlock/fee-payer co-signed txs can land with a non-fatal Custom instruction error
        // even though the transfer succeeded — same tolerance MultiSendFlow applies.
        const msg = e instanceof Error ? e.message : ''
        if (!(msg.includes('InstructionError') && msg.includes('"Custom":'))) throw e
      }

      // Fire-and-forget, same reasoning as the single-send status sync: the transfer already
      // landed on-chain, so a confirm-call hiccup here must never turn a successful send into
      // an apparent failure.
      multiConfirm(result.payment_ids, user.id, accessToken, sig, result.networkFeeUsdc ?? 0).catch((e: unknown) => {
        console.error('[AgentChatBox] multiConfirm failed (payment already sent, safe to ignore):', e)
      })

      updateMultiCard(id, { state: 'sent', links: result.links.map((l) => ({ ...l, link: l.link.replace(/\/c\/([^/?#]+)/, '/share/$1') })) })
      fireConfetti()
    } catch (e: unknown) {
      updateMultiCard(id, { state: 'failed', errorMessage: e instanceof Error ? e.message : 'Something went wrong.' })
    }
  }

  function handleCancelMulti(id: string) {
    updateMultiCard(id, { state: 'cancelled' })
  }

  function chooseMultiPlatform(msgId: string, platform: SocialIconPlatform, choice: MultiPlatformChoice) {
    setMessages((m) => m.map((msg) => (msg.id === msgId && msg.multiPlatformChoice ? { ...msg, multiPlatformChoice: { ...msg.multiPlatformChoice, resolved: true } } : msg)))
    if (platform === 'telegram' && !TELEGRAM_SEND_ENABLED) {
      pushAssistant('Sending to Telegram is temporarily unavailable — try X, Discord, or GitHub instead.', 'error')
      return
    }
    const resolvedRecipients = choice.recipients.map((r) =>
      choice.ambiguousIdentifiers.includes(r.identifier.toLowerCase()) ? { ...r, platform } : r,
    )
    finalizeMultiSend(resolvedRecipients, choice.isPrivate)
  }

  function updateGiftCard(id: string, patch: Partial<GiftCard>) {
    setMessages((m) => m.map((msg) => (msg.id === id && msg.giftCard ? { ...msg, giftCard: { ...msg.giftCard, ...patch } } : msg)))
  }

  function pushGiftCard(recipient: ParsedGiftRecipient, numTickets: number, isPrivate: boolean) {
    setMessages((m) => [
      ...m,
      {
        id: nextId(),
        role: 'assistant',
        text: "Here's your gift — confirm to send.",
        giftCard: { recipient, numTickets, state: 'pending', message: '', gifUrl: null, isPrivate },
      },
    ])
  }

  function handleCancelGift(id: string) {
    updateGiftCard(id, { state: 'cancelled' })
  }

  /** Builds, signs, and confirms the gift's funding tx — mirrors /app/megapot's own
   *  handleGiftBuy (buy-gift → one signature → buy-gift-confirm). Unlike handleConfirm's
   *  claimId-reuse-on-retry logic, a retry here just runs the whole sequence again — the existing
   *  self-service gift UI doesn't track partial progress across a failure either, since nothing
   *  is actually funded until buy-gift-confirm succeeds. */
  async function handleConfirmGift(id: string, card: GiftCard) {
    updateGiftCard(id, { state: 'sending', errorMessage: undefined })
    try {
      if (!user?.id) throw new Error('Not authenticated')
      const accessToken = await getAccessToken()
      const senderAddress = deriveSolanaEmbeddedAddress(user)
      const wallet = solanaWallets.find((w) => w.address === senderAddress) ?? solanaWallets[0]
      if (!wallet) throw new Error('Loofta wallet not found. Try logging out and back in.')

      const recipientType: 'email' | 'handle' = card.recipient.platform === 'email' ? 'email' : 'handle'
      const note = [card.message.trim(), card.gifUrl].filter(Boolean).join(' ').trim() || undefined
      const { giftId, txBase64 } = await buyGift(
        {
          numTickets: card.numTickets,
          userSolanaAddress: wallet.address,
          recipientType,
          recipientIdentifier: card.recipient.identifier,
          note,
          route: card.isPrivate ? 'solana_private' : 'solana_public',
        },
        user.id,
        accessToken,
      )

      // showWalletUIs defaults on for this hook (unlike the fee-payer-sponsored multi-send path
      // above) — this is the sender's own wallet funding the gift, so Privy's normal confirm UI
      // is expected here, same as /app/megapot's own gift flow.
      const { signature: sigBytes } = await signAndSendTransaction({
        transaction: Buffer.from(txBase64, 'base64') as unknown as Uint8Array,
        wallet: wallet as unknown as Parameters<typeof signAndSendTransaction>[0]['wallet'],
      })
      const signature = bs58.encode(sigBytes as Uint8Array)

      const { claimUrl } = await confirmGiftSend(giftId, signature, user.id, accessToken)
      updateGiftCard(id, { state: 'sent', claimUrl })
      fireConfetti()
    } catch (e: unknown) {
      updateGiftCard(id, { state: 'failed', errorMessage: e instanceof Error ? e.message : 'Something went wrong.' })
    }
  }

  async function handleSubmit() {
    const text = input.trim()
    if (!text) return
    setInput('')
    setExamplesVisible(false)
    setMessages((m) => [...m, { id: nextId(), role: 'user', text }])

    if (!authenticated) {
      pushAssistant('Log in first, then tell me who to pay.', 'info')
      login({ loginMethods: ['email', 'twitter', 'discord', 'github'], disableSignup: false })
      return
    }

    // Checked before the payment parser — "gift 5 tickets to @alice" has a different quantity
    // unit ($amount vs a ticket count) and a different resulting action entirely, so it's a fully
    // separate command shape rather than a variant of the payment one.
    const giftParsed = parseGiftCommand(text)
    if (giftParsed) {
      if (giftParsed.error) {
        pushAssistant(giftParsed.error, 'error')
        return
      }
      // Gifts can only resolve to an email or a handle checked against BOTH X and Loofta
      // username at claim time (see lottery.service.ts's isGiftRecipient) — there's no
      // discord/telegram/github matching path on the backend at all, unlike payments.
      if (giftParsed.recipient.platform === 'discord' || giftParsed.recipient.platform === 'telegram' || giftParsed.recipient.platform === 'github') {
        pushAssistant('Gifts can only go to an email or an X/Loofta handle right now — drop the platform, or use email instead.', 'error')
        return
      }
      let giftRecipient = giftParsed.recipient
      if (giftRecipient.platform === 'username') {
        const exists = await checkUsernameExists(looUsername(giftRecipient.identifier))
        if (!exists) {
          // Not a hard block — a gift's "handle" recipient is checked against BOTH X and Loofta
          // username at claim time, so this still works if @identifier turns out to be (or later
          // becomes) someone's X handle. Just relabel so the card is honest about what's actually
          // being sent, instead of implying a confirmed Loofta username.
          pushAssistant(`@${giftRecipient.identifier} isn't a registered Loofta user — sending this as a gift claimable by whoever links that as their X handle or username.`, 'info')
          giftRecipient = { ...giftRecipient, platform: 'twitter' }
        }
      }
      pushGiftCard(giftRecipient, giftParsed.numTickets, giftParsed.isPrivate)
      return
    }

    const parsed = parseAgentCommand(text)
    if (parsed.error) {
      pushAssistant(parsed.error, 'error')
      return
    }
    const { recipients, isMulti, isPrivate } = parsed

    const hasTelegram = recipients.some((r) => r.platform === 'telegram')
    if (hasTelegram && !TELEGRAM_SEND_ENABLED) {
      pushAssistant('Sending to Telegram is temporarily unavailable — try X, Discord, GitHub, or email instead.', 'error')
      return
    }

    if (isMulti && recipients.length > MULTI_MAX_RECIPIENTS) {
      pushAssistant(`I can send to at most ${MULTI_MAX_RECIPIENTS} recipients at once — you gave me ${recipients.length}.`, 'error')
      return
    }

    // No platform was specified and it's not an email — before assuming a "username"-defaulted
    // recipient is a Loofta username, check it's actually registered. If not, the sender
    // probably meant a social handle without saying which platform, so ask instead of silently
    // paying a made-up username (which would just sit as an unclaimed pending claim forever).
    // Applies to every such recipient in the command, not just a lone single-send one.
    const usernameRecipients = recipients.filter((r) => r.platform === 'username')
    if (usernameRecipients.length > 0) {
      const checks = await Promise.all(usernameRecipients.map((r) => checkUsernameExists(looUsername(r.identifier)).then((exists) => ({ r, exists }))))
      const unregistered = checks.filter((c) => !c.exists).map((c) => c.r)
      if (unregistered.length > 0) {
        if (!isMulti) {
          setMessages((m) => [
            ...m,
            {
              id: nextId(),
              role: 'assistant',
              text: `${recipients[0].identifier} isn't a registered Loofta user — are you trying to pay a social handle? Choose the platform:`,
              platformChoice: { identifier: recipients[0].identifier, amount: recipients[0].amount, isPrivate, resolved: false },
            },
          ])
        } else {
          const names = unregistered.map((r) => `@${r.identifier}`).join(', ')
          setMessages((m) => [
            ...m,
            {
              id: nextId(),
              role: 'assistant',
              text: `${names} ${unregistered.length === 1 ? "isn't a" : "aren't"} registered Loofta ${unregistered.length === 1 ? 'user' : 'users'} — are you trying to pay ${unregistered.length === 1 ? 'a social handle' : 'social handles'}? Choose the platform:`,
              multiPlatformChoice: { recipients, ambiguousIdentifiers: unregistered.map((r) => r.identifier.toLowerCase()), isPrivate, resolved: false },
            },
          ])
        }
        return
      }
    }

    if (isMulti) {
      const total = recipients.reduce((s, r) => s + r.amount, 0)
      if (total < MIN_SEND_USD) {
        pushAssistant(`The total across all recipients needs to be at least $${MIN_SEND_USD} — right now that's $${total.toFixed(2)}.`, 'error')
        return
      }
      finalizeMultiSend(recipients, isPrivate)
      return
    }

    if (recipients[0].amount < MIN_SEND_USD) {
      pushAssistant(`Minimum payment is $${MIN_SEND_USD}.`, 'error')
      return
    }
    if (!solanaPayment.hasEnoughBalance(recipients[0].amount)) {
      pushInsufficientFunds(recipients[0].amount)
      return
    }

    pushPaymentCard(recipients[0], recipients[0].amount, isPrivate)
  }

  async function copyLink(id: string, link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setCopiedId(id)
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000)
    } catch {
      // clipboard denied — link is still visible for manual copy
    }
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] overflow-hidden shadow-[0_0_80px_rgba(255,19,1,0.07),0_0_160px_rgba(234,179,8,0.05)]">
      <div ref={scrollRef} className="min-h-[340px] max-h-[480px] overflow-y-auto px-4 py-4 space-y-3.5">
        {messages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[#1a1a22] border border-white/10 px-4 py-2.5 text-white text-lg">
                  {msg.text}
                </div>
              </div>
            )
          }
          const card = msg.card
          const multiCard = msg.multiCard
          const giftCard = msg.giftCard
          return (
            <div key={msg.id} className="flex items-start gap-2.5 justify-start max-w-[90%]">
              <Avatar />
              <div className="flex flex-col gap-2.5 min-w-0">
                <p className={`text-lg ${msg.tone === 'error' ? 'text-red-300 flex items-start gap-1.5' : 'text-slate-200'}`}>
                  {msg.tone === 'error' && <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
                  <span>{msg.text}</span>
                </p>

                {msg.platformChoice && !msg.platformChoice.resolved && (
                  <div className="flex flex-wrap gap-1.5">
                    {PLATFORM_CHOICES.filter((p) => p.id !== 'telegram' || TELEGRAM_SEND_ENABLED).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => choosePlatform(msg.id, p.id, msg.platformChoice!.identifier, msg.platformChoice!.amount, msg.platformChoice!.isPrivate)}
                        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-lg text-slate-200 hover:text-white hover:bg-white/[0.08] transition-colors"
                      >
                        <SocialPlatformIcon platform={p.id} className="h-4 w-4" />
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}

                {msg.multiPlatformChoice && !msg.multiPlatformChoice.resolved && (
                  <div className="flex flex-wrap gap-1.5">
                    {PLATFORM_CHOICES.filter((p) => p.id !== 'telegram' || TELEGRAM_SEND_ENABLED).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => chooseMultiPlatform(msg.id, p.id, msg.multiPlatformChoice!)}
                        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-lg text-slate-200 hover:text-white hover:bg-white/[0.08] transition-colors"
                      >
                        <SocialPlatformIcon platform={p.id} className="h-4 w-4" />
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}

                {msg.insufficientFunds && (
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('openBalanceModal', { detail: { tab: 'topup' } }))}
                    className="w-full h-11 rounded-xl text-lg font-semibold border border-white/20 bg-white/10 text-white hover:bg-white/15 transition-colors"
                  >
                    Add funds to your balance
                  </button>
                )}

                {card && (
                  <div className="rounded-2xl border border-white/[0.12] bg-white/[0.04] p-4 min-w-[280px]">
                    <div className="flex items-baseline justify-between mb-3">
                      <span className="text-base uppercase tracking-wide text-slate-500">Payment</span>
                      <span className="font-display font-semibold text-3xl text-white">${card.amount.toFixed(2)}</span>
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-lg mb-3.5">
                      <span className="text-slate-500">To</span>
                      <span className="text-slate-200 truncate">{recipientDisplay(card.recipient)}</span>
                      <span className="text-slate-500">Via</span>
                      <span className="text-slate-200">{platformLabel(card.recipient.platform)}</span>
                      <span className="text-slate-500">Fee</span>
                      <span className="text-slate-200">Free</span>
                      {card.isPrivate && (
                        <>
                          <span className="text-slate-500">Privacy</span>
                          <span className="text-slate-200">Private</span>
                        </>
                      )}
                    </div>

                    {card.state === 'pending' && (
                      <div className="space-y-2.5">
                        {card.isNewRecipient && (
                          <p className="flex items-center gap-1.5 text-base text-amber-300">
                            <Clock className="h-4 w-4 shrink-0" /> First time sending to this recipient.
                          </p>
                        )}
                        <IncognitoModeToggle checked={card.isPrivate} onCheckedChange={(v) => updateCard(msg.id, { isPrivate: v })} />
                        <MessageInput
                          value={card.message}
                          onChange={(v) => updateCard(msg.id, { message: v })}
                          gifUrl={card.gifUrl}
                          onGifChange={(url) => updateCard(msg.id, { gifUrl: url })}
                          placeholder="Add a message or GIF (optional)"
                          maxLength={500}
                          className="[&_input]:h-10 [&_input]:bg-white/5 [&_input]:border-white/10 [&_input]:text-white [&_input]:placeholder:text-slate-500 [&_input]:text-base [&_input]:md:text-base"
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            onClick={() => handleConfirm(msg.id, card)}
                            className="flex-1 h-11 rounded-xl text-lg md:text-lg font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
                          >
                            Confirm
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleCancel(msg.id)}
                            className="flex-1 h-11 rounded-xl text-lg md:text-lg font-medium bg-transparent border-white/15 text-slate-400 hover:bg-white/5 hover:text-white"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {card.state === 'sending' && (
                      <Button disabled className="w-full h-11 rounded-xl text-lg md:text-lg font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white opacity-80">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending…
                      </Button>
                    )}

                    {card.state === 'sent' && (
                      <div className="space-y-2">
                        <p className="flex items-center gap-1.5 text-lg font-medium text-green-400">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-400/15">
                            <Check className="h-2.5 w-2.5" strokeWidth={3} />
                          </span>
                          Confirmed
                        </p>
                        {card.link && (
                          <div className="flex gap-2">
                            <Input readOnly value={card.link} className="font-mono text-base md:text-base flex-1 min-w-0 h-9 bg-white/5 border-white/10 text-white" />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => copyLink(msg.id, card.link!)}
                              className="h-9 w-9 shrink-0 bg-transparent border-white/10 text-slate-300 hover:bg-white/10 hover:text-white"
                            >
                              {copiedId === msg.id ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                            </Button>
                            <a
                              href={card.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                            <ShareLinkMenu
                              url={card.link}
                              title="Payment sent"
                              text={`$${card.amount.toFixed(2)} sent to ${recipientDisplay(card.recipient)} via Loofta.`}
                              variant="subtle"
                              triggerClassName="h-9 w-9"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {card.state === 'cancelled' && <p className="text-lg text-slate-500">Cancelled — nothing was sent.</p>}

                    {card.state === 'failed' && (
                      <div className="space-y-2">
                        <p className="flex items-start gap-1.5 text-lg text-red-300">
                          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> {card.errorMessage}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => updateCard(msg.id, { state: 'pending', errorMessage: undefined })}
                          className="w-full h-11 rounded-xl text-lg md:text-lg font-medium bg-transparent border-white/15 text-slate-300 hover:bg-white/5 hover:text-white"
                        >
                          Try again
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {giftCard && (
                  <div className="rounded-2xl border border-white/[0.12] bg-white/[0.04] p-4 min-w-[280px]">
                    <div className="flex items-baseline justify-between mb-3">
                      <span className="text-base uppercase tracking-wide text-slate-500">Gift</span>
                      <span className="flex items-center gap-1.5 font-display font-semibold text-2xl text-white">
                        <Ticket className="h-5 w-5 text-amber-400" />
                        {giftCard.numTickets} {giftCard.numTickets === 1 ? 'ticket' : 'tickets'}
                      </span>
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-lg mb-3.5">
                      <span className="text-slate-500">To</span>
                      <span className="text-slate-200 truncate">{recipientDisplay(giftCard.recipient)}</span>
                      <span className="text-slate-500">Fee</span>
                      <span className="text-slate-200">Free</span>
                      {giftCard.isPrivate && (
                        <>
                          <span className="text-slate-500">Privacy</span>
                          <span className="text-slate-200">Private</span>
                        </>
                      )}
                    </div>

                    {giftCard.state === 'pending' && (
                      <div className="space-y-2.5">
                        <MessageInput
                          value={giftCard.message}
                          onChange={(v) => updateGiftCard(msg.id, { message: v })}
                          gifUrl={giftCard.gifUrl}
                          onGifChange={(url) => updateGiftCard(msg.id, { gifUrl: url })}
                          placeholder="Add a note or GIF (optional)"
                          defaultGifQuery="lottery"
                          maxLength={500}
                          className="[&_input]:h-10 [&_input]:bg-white/5 [&_input]:border-white/10 [&_input]:text-white [&_input]:placeholder:text-slate-500 [&_input]:text-base [&_input]:md:text-base"
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            onClick={() => handleConfirmGift(msg.id, giftCard)}
                            className="flex-1 h-11 rounded-xl text-lg md:text-lg font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
                          >
                            Confirm
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleCancelGift(msg.id)}
                            className="flex-1 h-11 rounded-xl text-lg md:text-lg font-medium bg-transparent border-white/15 text-slate-400 hover:bg-white/5 hover:text-white"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {giftCard.state === 'sending' && (
                      <Button disabled className="w-full h-11 rounded-xl text-lg md:text-lg font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white opacity-80">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending…
                      </Button>
                    )}

                    {giftCard.state === 'sent' && (
                      <div className="space-y-2">
                        <p className="flex items-center gap-1.5 text-lg font-medium text-green-400">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-400/15">
                            <Check className="h-2.5 w-2.5" strokeWidth={3} />
                          </span>
                          Confirmed
                        </p>
                        {giftCard.claimUrl && (
                          <div className="flex gap-2">
                            <Input readOnly value={giftCard.claimUrl} className="font-mono text-base md:text-base flex-1 min-w-0 h-9 bg-white/5 border-white/10 text-white" />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => copyLink(msg.id, giftCard.claimUrl!)}
                              className="h-9 w-9 shrink-0 bg-transparent border-white/10 text-slate-300 hover:bg-white/10 hover:text-white"
                            >
                              {copiedId === msg.id ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                            </Button>
                            <a
                              href={giftCard.claimUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                            <ShareLinkMenu
                              url={giftCard.claimUrl}
                              title="Gift sent"
                              text={`I gifted ${giftCard.numTickets} Megapot ${giftCard.numTickets === 1 ? 'ticket' : 'tickets'} on Loofta 🎟️`}
                              // Without this, ShareLinkMenu defaults to the payment share route
                              // (/api/share/:id/og) — a gift claim link needs the lottery gift OG
                              // route instead, same as the claim page's own ShareLinkMenu usages.
                              ogUrl={(() => {
                                try {
                                  const u = new URL(giftCard.claimUrl!)
                                  const shareId = u.pathname.split('/').filter(Boolean).pop()
                                  return shareId ? `${u.origin}/api/gift/${shareId}/og` : undefined
                                } catch {
                                  return undefined
                                }
                              })()}
                              variant="subtle"
                              triggerClassName="h-9 w-9"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {giftCard.state === 'cancelled' && <p className="text-lg text-slate-500">Cancelled — nothing was sent.</p>}

                    {giftCard.state === 'failed' && (
                      <div className="space-y-2">
                        <p className="flex items-start gap-1.5 text-lg text-red-300">
                          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> {giftCard.errorMessage}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => updateGiftCard(msg.id, { state: 'pending', errorMessage: undefined })}
                          className="w-full h-11 rounded-xl text-lg md:text-lg font-medium bg-transparent border-white/15 text-slate-300 hover:bg-white/5 hover:text-white"
                        >
                          Try again
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {multiCard && (
                  <div className="rounded-2xl border border-white/[0.12] bg-white/[0.04] p-4 min-w-[280px]">
                    <div className="flex items-baseline justify-between mb-3">
                      <span className="text-base uppercase tracking-wide text-slate-500">Payment</span>
                      <span className="font-display font-semibold text-3xl text-white">
                        ${multiCard.recipients.reduce((s, r) => s + r.amount, 0).toFixed(2)}
                      </span>
                    </div>

                    <div className="space-y-2 mb-3.5">
                      {multiCard.recipients.map((r, i) => (
                        <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-base text-slate-500">Recipient {i + 1} &middot; {platformLabel(r.platform)}</p>
                            <p className="text-lg text-white truncate">{recipientDisplay(r)}</p>
                          </div>
                          <span className="text-xl font-display font-semibold text-white shrink-0">${r.amount.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between mb-3.5">
                      <span className="text-lg font-semibold text-white">{multiCard.recipients.length} recipients</span>
                      <span className="text-base text-slate-400">no fees</span>
                    </div>

                    {multiCard.state === 'pending' && (
                      <div className="space-y-2.5">
                        <MessageInput
                          value={multiCard.message}
                          onChange={(v) => updateMultiCard(msg.id, { message: v })}
                          gifUrl={multiCard.gifUrl}
                          onGifChange={(url) => updateMultiCard(msg.id, { gifUrl: url })}
                          placeholder="Add a message or GIF for everyone (optional)"
                          maxLength={500}
                          className="[&_input]:h-10 [&_input]:bg-white/5 [&_input]:border-white/10 [&_input]:text-white [&_input]:placeholder:text-slate-500 [&_input]:text-base [&_input]:md:text-base"
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            onClick={() => handleConfirmMulti(msg.id, multiCard)}
                            className="flex-1 h-11 rounded-xl text-lg md:text-lg font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
                          >
                            Confirm
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleCancelMulti(msg.id)}
                            className="flex-1 h-11 rounded-xl text-lg md:text-lg font-medium bg-transparent border-white/15 text-slate-400 hover:bg-white/5 hover:text-white"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {multiCard.state === 'sending' && (
                      <Button disabled className="w-full h-11 rounded-xl text-lg md:text-lg font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white opacity-80">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending…
                      </Button>
                    )}

                    {multiCard.state === 'sent' && (
                      <div className="space-y-2">
                        <p className="flex items-center gap-1.5 text-lg font-medium text-green-400">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-400/15">
                            <Check className="h-2.5 w-2.5" strokeWidth={3} />
                          </span>
                          Confirmed
                        </p>
                        {multiCard.links?.map((link) => (
                          <div key={link.id} className="flex gap-2">
                            <Input readOnly value={link.link} className="font-mono text-base md:text-base flex-1 min-w-0 h-9 bg-white/5 border-white/10 text-white" />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => copyLink(link.id, link.link)}
                              className="h-9 w-9 shrink-0 bg-transparent border-white/10 text-slate-300 hover:bg-white/10 hover:text-white"
                            >
                              {copiedId === link.id ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                            </Button>
                            <ShareLinkMenu
                              url={link.link}
                              title="Payment sent"
                              text={`$${parseFloat(link.amount).toFixed(2)} sent to ${link.recipient_identifier} via Loofta.`}
                              variant="subtle"
                              triggerClassName="h-9 w-9"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {multiCard.state === 'cancelled' && <p className="text-lg text-slate-500">Cancelled — nothing was sent.</p>}

                    {multiCard.state === 'failed' && (
                      <div className="space-y-2">
                        <p className="flex items-start gap-1.5 text-lg text-red-300">
                          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> {multiCard.errorMessage}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => updateMultiCard(msg.id, { state: 'pending', errorMessage: undefined })}
                          className="w-full h-11 rounded-xl text-lg md:text-lg font-medium bg-transparent border-white/15 text-slate-300 hover:bg-white/5 hover:text-white"
                        >
                          Try again
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {multiSendOpen && (
        <div className="shrink-0 px-4 pb-4 overflow-y-auto">
          <MultiSendFlow
            onBack={() => {
              setMultiSendOpen(false)
              clear()
            }}
          />
        </div>
      )}

      {!multiSendOpen && (
        <div className="shrink-0 border-t border-white/[0.06] px-4 py-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setExamplesVisible((v) => !v)}
              className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              {examplesVisible ? 'Hide examples' : 'Show examples'}
            </button>
            {examplesVisible && EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setInput(p)}
                className="rounded-full border text-left border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-lg text-slate-200 hover:text-white hover:bg-white/[0.08] transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
          <div className="relative flex items-center gap-2">
            {mention && mentionMatches.length > 0 && (
              <div className="absolute bottom-full left-0 mb-2 w-full max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-[#18181c] shadow-xl z-10">
                {mentionMatches.map((r, i) => (
                  <button
                    key={r.key}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      selectMention(r)
                    }}
                    className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors ${i === mentionActiveIndex ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'
                      }`}
                  >
                    {r.platform !== 'email' && r.platform !== 'username' && (
                      <SocialPlatformIcon platform={r.platform} className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                    <span className="flex-1 min-w-0 truncate text-lg text-white">{r.platform === 'email' ? r.identifier : `@${r.identifier}`}</span>
                    <span className="shrink-0 text-base text-slate-500">${r.lastAmount.toFixed(2)} &middot; {formatDistanceToNowStrict(new Date(r.lastAt), { addSuffix: true })}</span>
                  </button>
                ))}
              </div>
            )}
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
              onKeyDown={(e) => {
                if (mention && mentionMatches.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setMention((m) => (m ? { ...m, index: Math.min(m.index + 1, mentionMatches.length - 1) } : m))
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setMention((m) => (m ? { ...m, index: Math.max(m.index - 1, 0) } : m))
                    return
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    selectMention(mentionMatches[mentionActiveIndex])
                    return
                  }
                  if (e.key === 'Escape') {
                    setMention(null)
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder='"send $5 to @alice on X"'
              className="h-12 bg-white/5 border-white/10 text-white placeholder:text-slate-500 text-lg md:text-lg"
            />
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="h-12 w-12 shrink-0 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
