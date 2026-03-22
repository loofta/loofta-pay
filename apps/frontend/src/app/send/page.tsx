'use client';

import React, { useState, type SVGProps } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets, useSignAndSendTransaction } from '@privy-io/react-auth/solana';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  createSendPayment,
  confirmSendPaymentFunded,
  getMySendPaymentLinks,
  getSendPaymentPublic,
  reclaimSendPayment,
  type CreateSendPaymentInput,
  type CreateSendPaymentResult,
} from '@/services/api/sendPayment';
import { useSendPaymentStore } from '@/store/sendPayment';
import { buildUSDCTransferTransaction, sendSignedUSDCTransfer } from '@/services/solanaTransfer';
import { useSolanaPayment } from '@/hooks/useSolanaPayment';
import { PRIVATE_PAYMENT_ENABLED } from '@/services/privatePayment';
import { GradientActionButton } from '@/components/ui/GradientActionButton';
import { MessageInput } from '@/components/MessageInput';
import { Copy, Check, Send, Mail, AtSign, Share2, Wallet as WalletIcon, Loader2, ArrowRight, Shield, Link2, History, RotateCcw, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import bs58 from 'bs58';
import type { Wallet } from '@coral-xyz/anchor';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { usePerPrivateTransfer } from '@/hooks/usePerPrivateTransfer';
import { phantomWalletToAnchorWallet, privyWalletToAnchorWallet } from '@/lib/per/signer';
import { getUsdcMint } from '@/lib/per/constants';

type PhantomLike = {
  connect: () => Promise<{ publicKey: { toBase58(): string } }>;
  publicKey: { toBase58(): string } | null;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  signMessage?: (msg: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>;
};
function getPhantomProvider(): PhantomLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { solana?: PhantomLike };
  const solana = w?.solana;
  if (!solana?.signTransaction) return null;
  return solana as PhantomLike;
}

function LooftaIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  const id = React.useId().replace(/:/g, '-');
  return (
    <svg viewBox="0 0 56 57" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden {...props}>
      <g filter={`url(#loofta-shadow-${id})`}>
        <path d="M27.9532 49C20.655 49 14.8226 46.8696 10.4561 42.6087C6.15205 38.2861 4 32.2035 4 24.3611C4 19.5444 4.99805 15.3144 6.99415 11.6711C8.99025 8.02773 11.7661 5.18714 15.3216 3.14934C18.9396 1.04978 23.1501 0 27.9532 0C33.3177 0 37.7778 1.04978 41.3333 3.14934C44.8889 5.18714 47.54 8.02773 49.2865 11.6711C51.0955 15.3144 52 19.5444 52 24.3611C52 32.2035 50.0039 38.2861 46.0117 42.6087C42.0819 46.8696 36.0624 49 27.9532 49ZM15.1345 22.7864C15.1345 24.7007 16.1014 26.0592 18.0351 26.862C19.9688 27.603 23.2749 27.9735 27.9532 27.9735C32.6316 27.9735 35.9376 27.603 37.8713 26.862C39.8051 26.0592 40.7719 24.7007 40.7719 22.7864C40.7719 20.9338 39.8051 19.637 37.8713 18.896C35.9376 18.155 32.6316 17.7845 27.9532 17.7845C23.2749 17.7845 19.9688 18.155 18.0351 18.896C16.1014 19.637 15.1345 20.9338 15.1345 22.7864Z" fill="#FF4A26" />
      </g>
      <defs>
        <filter id={`loofta-shadow-${id}`} x="0" y="0" width="56" height="57" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="4" />
          <feGaussianBlur stdDeviation="2" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.12 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_617_42" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_617_42" result="shape" />
        </filter>
      </defs>
    </svg>
  );
}

export default function SendPaymentPage() {
  const { user, authenticated, login } = usePrivy();
  const { wallets: solanaWallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { toast } = useToast();
  const { currentLink, step: storeStep, hydrated, setCurrentLink, setStep, setCreated, setFunded, clearCurrentLink } = useSendPaymentStore();
  const result = currentLink;
  const step = storeStep;

  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<'link' | 'address' | null>(null);
  const [form, setForm] = useState({
    amount: '',
    recipient_type: 'email' as 'email' | 'twitter' | 'username',
    recipient_identifier: '',
    message: '',
  });
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [markingFunded, setMarkingFunded] = useState(false);
  const [payingWithWallet, setPayingWithWallet] = useState(false);
  const [payingWithLoofta, setPayingWithLoofta] = useState(false);
  const [payWithLooftaError, setPayWithLooftaError] = useState<string | null>(null);
  const [payWithWalletError, setPayWithWalletError] = useState<string | null>(null);
  /** Optional non-private path only when private payments are not globally enabled. */
  const [payPrivatelyOptional, setPayPrivatelyOptional] = useState(false);
  const payPrivately = PRIVATE_PAYMENT_ENABLED ? true : payPrivatelyOptional;
  const [payWithPrivateError, setPayWithPrivateError] = useState<string | null>(null);
  const [recoverLinks, setRecoverLinks] = useState<{ id: string; amount: string; token: string; status: string; recipient_type: string; created_at: string }[] | null>(null);
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [reclaiming, setReclaiming] = useState(false);

  const solanaPayment = useSolanaPayment({ enabled: step === 'created' && !!result });
  const { transfer: perTransfer } = usePerPrivateTransfer();

  if (!authenticated) {
    return (
      <>
        <div className="fixed inset-0 -z-10 bg-[#18181F]" />
        <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center px-4 py-12">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-sm">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-red-500/20">
              <Send className="h-8 w-8 text-amber-400" />
            </div>
            <h1 className="text-2xl font-semibold text-white mb-2">Send a payment</h1>
            <p className="text-white/70 text-sm mb-8">
              Log in to create a payment link. The recipient will claim it with their email, Twitter, or Loofta username.
            </p>
            <Button
              onClick={() => login()}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-500 to-red-500 text-white font-semibold hover:opacity-90 transition-opacity"
            >
              Log in to continue
            </Button>
          </div>
        </main>
      </>
    );
  }

  // Wait for persisted store to rehydrate so we don't lose the current link on reload
  if (!hydrated) {
    return (
      <>
        <div className="fixed inset-0 -z-10 bg-[#18181F]" />
        <main className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center px-4 py-12">
          <div className="flex flex-col items-center gap-4 text-white/80">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading your payment info…</p>
          </div>
        </main>
      </>
    );
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0 || !form.recipient_identifier.trim()) {
      toast({
        title: 'Please check your input',
        description: 'Enter an amount and recipient (email, Twitter, or Loofta username).',
        variant: 'destructive',
      });
      return;
    }
    setLoading(true);
    try {
      const userId = user?.id;
      if (!userId) throw new Error('Not logged in');
      // Strip GIF URLs from message so we never store them
      const gifUrlPattern = /(https?:\/\/[^\s]+(?:\.gif|giphy\.com|tenor\.com|gfycat\.com|media\.giphy\.com)[^\s]*)/gi;
      const textOnly = form.message.trim().replace(gifUrlPattern, '').replace(/\s+/g, ' ').trim();
      const fullMessage = textOnly || undefined;
      const res = await createSendPayment(
        {
          amount,
          recipient_type: form.recipient_type,
          recipient_identifier: form.recipient_identifier.trim(),
          message: fullMessage,
        },
        userId
      );
      setCreated(res);
      toast({ title: 'Link created', description: 'Send USDC to the address below, then share the link.' });
    } catch (err: any) {
      toast({
        title: 'Couldn’t create link',
        description: err?.message || 'Something went wrong. Try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMarkFunded = async () => {
    if (!result?.id || !user?.id) return;
    setMarkingFunded(true);
    try {
      await confirmSendPaymentFunded(result.id, null, user.id);
      setFunded();
      toast({ title: 'Marked as funded', description: 'The recipient can now claim.' });
    } catch (err: any) {
      toast({ title: 'Failed', description: err?.message || 'Could not update.', variant: 'destructive' });
    } finally {
      setMarkingFunded(false);
    }
  };

  const claimAmountUSD = result ? parseFloat(result.amount) || 0 : 0;
  const looftaBalanceUSD = solanaPayment.balanceUSD;
  const hasEnoughLooftaBalance = solanaPayment.hasEnoughBalance(claimAmountUSD);
  const balanceData = solanaPayment.isBalanceLoading ? undefined : { balanceUSD: looftaBalanceUSD };

  function getOnchainRecipientAddress(): string | null {
    const r = result?.per_recipient_pubkey?.trim() || result?.burner_address?.trim();
    return r || null;
  }

  async function payWithLooftaBalance() {
    const to = getOnchainRecipientAddress();
    if (!to || !result?.amount || !user?.id) return;
    const amount = parseFloat(result.amount);
    if (!amount || amount <= 0) return;
    setPayingWithLoofta(true);
    setPayWithLooftaError(null);
    try {
      const sig = await solanaPayment.makePayment({
        amount,
        recipientAddress: to,
      });
      await confirmSendPaymentFunded(result.id, sig, user.id);
      setFunded();
      toast({ title: 'Payment sent', description: 'USDC sent from your Loofta wallet. The recipient can now claim.' });
    } catch (err: any) {
      const msg = err?.message || 'Could not send. Try again or use your wallet.';
      setPayWithLooftaError(msg);
      toast({ title: 'Payment failed', description: msg, variant: 'destructive' });
    } finally {
      setPayingWithLoofta(false);
    }
  }

  async function payWithPrivate(preferWallet: 'loofta' | 'phantom') {
    if (!result?.id || !result?.amount || !user?.id) return;
    const recipient = result.per_recipient_pubkey?.trim();
    if (!recipient) {
      throw new Error('This link is missing recipient data. Create a new payment link.');
    }
    setPayWithPrivateError(null);
    const amount = parseFloat(result.amount);
    const mint = getUsdcMint().toBase58();
    let anchorWallet: Wallet;

    if (preferWallet === 'phantom') {
      const ph = getPhantomProvider();
      if (!ph) throw new Error('Install Phantom to pay with Phantom.');
      const { publicKey } = ph.publicKey ? { publicKey: ph.publicKey } : await ph.connect();
      if (!publicKey) throw new Error('Phantom: no public key');
      anchorWallet = phantomWalletToAnchorWallet({
        publicKey,
        signTransaction: async (tx: Transaction) => {
          const signed = await ph.signTransaction(tx as unknown as VersionedTransaction);
          return signed as unknown as Transaction;
        },
      });
    } else {
      const w =
        solanaWallets?.find(
          (x) =>
            (x as { walletClientType?: string }).walletClientType !== 'phantom' &&
            (x as { walletClientType?: string }).walletClientType !== 'detected',
        ) ?? solanaWallets?.[0];
      if (!w?.address) throw new Error('Connect your Loofta Solana wallet.');
      anchorWallet = privyWalletToAnchorWallet(w as Parameters<typeof privyWalletToAnchorWallet>[0]);
    }

    const sig = await perTransfer(anchorWallet, recipient, mint, amount);
    await confirmSendPaymentFunded(result.id, sig, user.id);
    setFunded();
    toast({
      title: 'Private payment sent',
      description: 'MagicBlock PER transfer completed. The recipient can claim after funds settle.',
    });
  }

  async function handlePayWithLoofta() {
    if (!result || !user?.id) return;
    setPayingWithLoofta(true);
    setPayWithLooftaError(null);
    setPayWithPrivateError(null);
    try {
      if (payPrivately) {
        await payWithPrivate('loofta');
      } else {
        await payWithLooftaBalance();
      }
    } catch (err: any) {
      if (payPrivately) {
        const msg = err?.message || 'Private payment failed.';
        setPayWithPrivateError(msg);
        toast({ title: 'Private payment failed', description: msg, variant: 'destructive' });
      } else {
        const msg = err?.message || 'Could not send. Try again or use your wallet.';
        setPayWithLooftaError(msg);
        toast({ title: 'Payment failed', description: msg, variant: 'destructive' });
      }
    } finally {
      setPayingWithLoofta(false);
    }
  }

  async function handlePayWithPhantom() {
    if (!result || !user?.id) return;
    setPayingWithWallet(true);
    setPayWithWalletError(null);
    setPayWithPrivateError(null);
    try {
      if (payPrivately) {
        await payWithPrivate('phantom');
      } else {
        await payWithWallet();
      }
    } catch (err: any) {
      if (payPrivately) {
        const msg = err?.message || 'Private payment failed.';
        setPayWithPrivateError(msg);
        toast({ title: 'Private payment failed', description: msg, variant: 'destructive' });
      } else {
        const msg = err?.message || 'Could not send. You can copy the address and send manually.';
        setPayWithWalletError(msg);
        toast({ title: 'Payment failed', description: msg, variant: 'destructive' });
      }
    } finally {
      setPayingWithWallet(false);
    }
  }

  async function payWithWallet() {
    const to = getOnchainRecipientAddress();
    if (!to || !result?.amount || !user?.id) return;
    const amount = parseFloat(result.amount);
    if (!amount || amount <= 0) return;
    setPayingWithWallet(true);
    setPayWithWalletError(null);
    try {
      const phantom = getPhantomProvider();
      let txSignature: string;

      if (phantom) {
        const { publicKey } = phantom.publicKey ? { publicKey: phantom.publicKey } : await phantom.connect();
        if (!publicKey) throw new Error('Phantom: no public key');
        const senderAddress = publicKey.toBase58();
        const tx = await buildUSDCTransferTransaction({
          senderAddress,
          recipientAddress: to,
          amountUSDC: amount,
        });
        const signed = await phantom.signTransaction(tx);
        txSignature = await sendSignedUSDCTransfer(signed);
      } else {
        const solanaWallet = solanaWallets?.find((w) => (w as { walletClientType?: string }).walletClientType === 'phantom' || (w as { walletClientType?: string }).walletClientType === 'detected');
        const wallet = solanaWallet ?? solanaWallets?.[0];
        if (!wallet?.address) {
          const msg = 'Connect Phantom or another Solana wallet to pay.';
          setPayWithWalletError(msg);
          toast({ title: 'No wallet', description: msg, variant: 'destructive' });
          return;
        }
        const tx = await buildUSDCTransferTransaction({
          senderAddress: wallet.address,
          recipientAddress: to,
          amountUSDC: amount,
        });
        const { signature } = await signAndSendTransaction({
          transaction: tx.serialize(),
          wallet,
        });
        txSignature = typeof signature === 'string' ? signature : bs58.encode(signature);
      }

      await confirmSendPaymentFunded(result.id, txSignature, user.id);
      setFunded();
      toast({ title: 'Payment sent', description: 'USDC sent. The recipient can now claim.' });
    } catch (err: any) {
      const msg = err?.message || 'Could not send. You can still copy the address and send manually.';
      setPayWithWalletError(msg);
      toast({ title: 'Payment failed', description: msg, variant: 'destructive' });
    } finally {
      setPayingWithWallet(false);
    }
  }

  const copyToClipboard = async (value: string, key: 'link' | 'address') => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    toast({ title: 'Copied!' });
    setTimeout(() => setCopied(null), 2000);
  };

  const loadRecoverLinks = async () => {
    if (!user?.id || recoverLinks !== null) return;
    setRecoverLoading(true);
    try {
      const list = await getMySendPaymentLinks(user.id);
      setRecoverLinks(list);
    } catch {
      toast({ title: 'Could not load links', variant: 'destructive' });
    } finally {
      setRecoverLoading(false);
    }
  };

  const restoreLink = async (id: string) => {
    if (!user?.id) return;
    setRestoringId(id);
    try {
      const publicData = await getSendPaymentPublic(id, user.id);
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const link: CreateSendPaymentResult = {
        id: publicData.id,
        link: `${origin}/s/${id}`,
        deposit_address: publicData.deposit_address ?? '',
        burner_address: publicData.burner_address ?? '',
        amount: publicData.amount,
        token: publicData.token,
        required_sol_lamports: publicData.required_sol_lamports ?? 500_000,
        per_recipient_pubkey: publicData.per_recipient_pubkey ?? undefined,
        per_mode: !!publicData.per_recipient_pubkey,
      };
      setCurrentLink(link);
      setStep(publicData.status === 'FUNDED' || publicData.status === 'CLAIMED' ? 'funded' : 'created');
      toast({ title: 'Link restored', description: 'You can share it or mark as funded.' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not restore link';
      toast({ title: 'Restore failed', description: msg, variant: 'destructive' });
    } finally {
      setRestoringId(null);
    }
  };

  const handleReclaim = async () => {
    if (!result?.id || !user?.id) return;
    setReclaiming(true);
    try {
      const res = await reclaimSendPayment(result.id, user.id);
      const amount = res?.amount_reclaimed ?? result.amount;
      toast({
        title: 'Funds reclaimed',
        description: `$${amount} USDC has been sent back to your wallet.`,
      });
      clearCurrentLink();
      setGifUrl(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reclaim failed';
      toast({ title: 'Reclaim failed', description: msg, variant: 'destructive' });
    } finally {
      setReclaiming(false);
    }
  };

  const shareLink = () => {
    if (!result?.link) return;
    if (navigator.share) {
      navigator.share({
        title: 'Payment for you',
        text: `You have a payment of $${result.amount} USDC to claim`,
        url: result.link,
      }).then(() => toast({ title: 'Shared!' })).catch(() => copyToClipboard(result!.link, 'link'));
    } else {
      copyToClipboard(result.link, 'link');
    }
  };

  return (
    <>
      <div className="fixed inset-0 -z-10 bg-[#18181F]" />
      <main className="min-h-[calc(100vh-5rem)] px-4 py-8 md:py-12">
        <div className="mx-auto max-w-lg">
          {/* Recover link — always visible at top so users can get a past link back */}
          <div className="mb-6 rounded-xl border border-amber-200/80 bg-amber-50/50 p-4">
            <button
              type="button"
              onClick={loadRecoverLinks}
              disabled={recoverLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold text-amber-800 hover:bg-amber-100/80 transition-colors disabled:opacity-60"
            >
              <History className="h-5 w-5" />
              {recoverLinks === null
                ? recoverLoading
                  ? 'Loading your links…'
                  : 'Recover a recent payment link'
                : 'Your recent payment links'}
            </button>
            {recoverLinks !== null && (
              <ul className="mt-3 space-y-2">
                {recoverLinks.length === 0 ? (
                  <li className="text-sm text-amber-800/80">No payment links yet.</li>
                ) : (
                  recoverLinks.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200/60 bg-white p-3">
                      <span className="text-sm font-medium text-gray-900">
                        ${item.amount} {item.token}
                      </span>
                      <span className="text-xs text-gray-500 capitalize">{item.status.toLowerCase()}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={restoringId !== null}
                        onClick={() => restoreLink(item.id)}
                        className="shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100"
                      >
                        {restoringId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Link2 className="h-4 w-4 mr-1" />
                            Restore
                          </>
                        )}
                      </Button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          <AnimatePresence mode="wait">
            {step === 'form' && (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="rounded-2xl border border-white/10 bg-white p-6 shadow-xl md:p-8"
              >
                <div className="mb-8">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-600">
                    <Send className="h-4 w-4" />
                    Send payment
                  </div>
                  <h1 className="text-2xl font-semibold text-gray-900">Create a payment link</h1>
                  <p className="mt-1 text-sm text-gray-500">
                    Enter amount and who can claim it (email, Twitter, or Loofta username). They’ll log in to claim to their Loofta wallet.
                  </p>
                </div>

                <form onSubmit={handleCreate} className="space-y-6">
                  <div>
                    <Label htmlFor="amount" className="text-gray-700">Amount (USD)</Label>
                    <Input
                      id="amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={form.amount}
                      onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                      className="mt-2 h-14 text-2xl font-semibold tabular-nums"
                    />
                  </div>

                  <div>
                    <Label className="text-gray-700">Recipient — who can claim</Label>
                    <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, recipient_type: 'email' }))}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-3 text-xs font-medium transition-colors sm:text-sm ${form.recipient_type === 'email' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        <Mail className="h-4 w-4 shrink-0" />
                        Email
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, recipient_type: 'twitter' }))}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-3 text-xs font-medium transition-colors sm:text-sm ${form.recipient_type === 'twitter' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        <AtSign className="h-4 w-4 shrink-0" />
                        Twitter
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, recipient_type: 'username' }))}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-3 text-xs font-medium transition-colors sm:text-sm ${form.recipient_type === 'username' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        <User className="h-4 w-4 shrink-0" />
                        Loofta
                      </button>
                    </div>
                    <Input
                      type="text"
                      placeholder={
                        form.recipient_type === 'email'
                          ? 'name@example.com'
                          : form.recipient_type === 'twitter'
                            ? 'username or @username'
                            : 'Loofta username'
                      }
                      value={form.recipient_identifier}
                      onChange={(e) => setForm((f) => ({ ...f, recipient_identifier: e.target.value }))}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label className="text-gray-700">Message (optional)</Label>
                    <MessageInput
                      value={form.message}
                      onChange={(value) => setForm((f) => ({ ...f, message: value }))}
                      placeholder="e.g. Thanks for your help!"
                      maxLength={500}
                      gifUrl={gifUrl}
                      onGifChange={setGifUrl}
                      className="mt-2 [&_input]:h-12"
                    />
                  </div>

                  <GradientActionButton
                    type="submit"
                    disabled={loading}
                    loading={loading}
                    loadingText="Creating link…"
                    className="mt-2 h-12 rounded-2xl"
                  >
                    <Send className="mr-2 h-5 w-5" />
                    Create payment link
                  </GradientActionButton>
                </form>
              </motion.div>
            )}

            {(step === 'created' || step === 'funded') && result && (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-white/10 bg-white p-6 shadow-xl md:p-8"
              >
                <div className="mb-6 flex items-center justify-between">
                  <span className={`rounded-full px-3 py-1 text-sm font-medium ${step === 'funded' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                    {step === 'funded' ? 'Ready to claim' : 'Waiting for funds'}
                  </span>
                  <span className="text-2xl font-bold text-gray-900">${result.amount}</span>
                </div>

                <div className="space-y-6">
                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-amber-600">1</span>
                      Fund this link — {result.amount} USDC
                    </p>
                    <p className="mb-4 text-xs text-gray-500">
                      {PRIVATE_PAYMENT_ENABLED
                        ? 'Pay with MagicBlock PER (private USDC). Use Loofta balance or Phantom.'
                        : 'Choose how to pay — private (PER) or regular USDC transfer. Use Loofta balance or Phantom.'}
                    </p>

                    {step === 'created' && (
                      <div className="flex flex-col gap-3">
                        {!PRIVATE_PAYMENT_ENABLED && (
                          <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-gray-50/50 cursor-pointer hover:bg-violet-50/50 hover:border-violet-200 transition-colors">
                            <input
                              type="checkbox"
                              checked={payPrivatelyOptional}
                              onChange={(e) => setPayPrivatelyOptional(e.target.checked)}
                              className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                            />
                            <Shield className="w-5 h-5 text-violet-600 shrink-0" />
                            <span className="font-medium text-gray-900">Pay privately</span>
                            <span className="text-sm text-gray-500">MagicBlock PER</span>
                          </label>
                        )}
                        {payPrivately && (
                          <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/80 text-sm text-amber-900 space-y-2">
                            <p className="font-medium">MagicBlock private rollup (PER)</p>
                            <p className="text-amber-800">
                              USDC moves through a program vault and delegated deposit accounts; the transfer runs on the ephemeral rollup. You need USDC in your wallet and a small amount of SOL for Solana fees on devnet.
                            </p>
                          </div>
                        )}
                        {payWithPrivateError && (
                          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                            {payWithPrivateError}
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={payingWithLoofta || (balanceData !== undefined && !hasEnoughLooftaBalance)}
                          onClick={() => handlePayWithLoofta()}
                          title={balanceData !== undefined && !hasEnoughLooftaBalance ? `Need $${claimAmountUSD.toFixed(2)} (you have $${looftaBalanceUSD.toFixed(2)})` : undefined}
                          className="flex items-center gap-3 w-full p-4 rounded-xl border border-gray-200 bg-gray-50 hover:bg-orange-50 hover:border-orange-200 transition-all text-left disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-gray-50 disabled:hover:border-gray-200"
                        >
                          <div className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0 p-1.5">
                            {payingWithLoofta ? <Loader2 className="w-5 h-5 animate-spin text-orange-600" /> : <LooftaIcon className="w-full h-full object-contain" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold text-gray-900 block">Loofta balance</span>
                            <span className="text-sm text-gray-500">
                              {payingWithLoofta
                                ? payPrivately ? 'Signing & sending privately…' : 'Sending…'
                                : balanceData === undefined
                                  ? 'Loading balance…'
                                  : payPrivately
                                    ? 'Pay from balance (PER)'
                                    : `Your balance: $${looftaBalanceUSD.toFixed(2)}${!hasEnoughLooftaBalance ? ' · Need more' : ''}`}
                            </span>
                          </div>
                          {!payingWithLoofta && balanceData !== undefined && hasEnoughLooftaBalance && (
                            <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full shrink-0">Ready</span>
                          )}
                          {!payingWithLoofta && balanceData !== undefined && !hasEnoughLooftaBalance && (
                            <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-full shrink-0">Low balance</span>
                          )}
                        </button>
                        {payWithLooftaError && (
                          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                            {payWithLooftaError}
                          </div>
                        )}

                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-px bg-gray-200" />
                          <span className="text-sm font-medium text-gray-400">or</span>
                          <div className="flex-1 h-px bg-gray-200" />
                        </div>

                        <button
                          type="button"
                          disabled={payingWithWallet}
                          onClick={() => handlePayWithPhantom()}
                          className="flex items-center gap-3 w-full p-4 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-all text-left disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <div className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0">
                            {payingWithWallet ? <Loader2 className="w-5 h-5 animate-spin text-gray-600" /> : <WalletIcon className="w-5 h-5 text-gray-700" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold text-gray-900 block">Phantom wallet</span>
                            <span className="text-sm text-gray-500">
                              {payingWithWallet
                                ? payPrivately ? 'Signing & sending privately…' : 'Sign in Phantom & sending…'
                                : payPrivately ? 'Pay from Phantom (private)' : 'Connect Phantom or other Solana wallet'}
                            </span>
                          </div>
                          {!payingWithWallet && <ArrowRight className="w-5 h-5 text-gray-400 shrink-0" />}
                        </button>
                        {payWithWalletError && (
                          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                            {payWithWalletError}
                          </div>
                        )}

                        {result.deposit_address || result.burner_address ? (
                          <>
                            <p className="text-xs text-gray-500 mt-1">Or send manually: USDC to deposit address{result.burner_address ? ', 0.0005 SOL to burner for claim gas' : ''}.</p>
                            <div className="flex flex-col gap-2">
                              {!!result.deposit_address && (
                                <div className="flex gap-2">
                                  <Input readOnly value={result.deposit_address} className="font-mono text-xs" placeholder="USDC deposit" />
                                  <Button type="button" variant="outline" size="icon" onClick={() => copyToClipboard(result.deposit_address, 'address')} className="text-gray-700 border-gray-300 hover:bg-gray-100 hover:text-gray-900">
                                    {copied === 'address' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-gray-700" />}
                                  </Button>
                                </div>
                              )}
                              {result.burner_address != null && result.burner_address !== '' && (
                                <div className="flex gap-2">
                                  <Input readOnly value={result.burner_address} className="font-mono text-xs" placeholder="SOL (0.0005) for gas" />
                                  <Button type="button" variant="outline" size="icon" onClick={() => copyToClipboard(result.burner_address!, 'address')} className="text-gray-700 border-gray-300 hover:bg-gray-100 hover:text-gray-900">
                                    {copied === 'address' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-gray-700" />}
                                  </Button>
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-gray-500 mt-1">
                            Use Loofta balance or Phantom — USDC is sent to the recipient&apos;s on-chain deposit (MagicBlock PER). No burner address is used.
                          </p>
                        )}
                      </div>
                    )}

                    {step === 'funded' && (
                      result.deposit_address ? (
                        <div className="flex gap-2">
                          <Input readOnly value={result.deposit_address} className="font-mono text-xs" />
                          <Button type="button" variant="outline" size="icon" onClick={() => copyToClipboard(result.deposit_address, 'address')} className="text-gray-700 border-gray-300 hover:bg-gray-100 hover:text-gray-900">
                            {copied === 'address' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-gray-700" />}
                          </Button>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500">Funded via MagicBlock PER — share the claim link below.</p>
                      )
                    )}
                  </div>

                  <div className="rounded-xl bg-gray-50 p-4">
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-amber-600">2</span>
                      Share the claim link
                    </p>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                      <div className="flex-1 flex gap-2">
                        <Input readOnly value={result.link} className="font-mono text-xs" />
                        <Button type="button" variant="outline" size="icon" onClick={() => copyToClipboard(result.link, 'link')} className="text-gray-700 border-gray-300 hover:bg-gray-100 hover:text-gray-900">
                          {copied === 'link' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-gray-700" />}
                        </Button>
                      </div>
                      <Button type="button" variant="outline" className="shrink-0" onClick={shareLink}>
                        <Share2 className="mr-2 h-4 w-4" />
                        Share
                      </Button>
                    </div>
                    <div className="mt-4 flex justify-center rounded-lg bg-white p-4">
                      <QRCodeSVG value={result.link} size={128} level="M" />
                    </div>
                  </div>
                </div>

                {step === 'created' && (
                  <p className="mt-4 text-center">
                    <button
                      type="button"
                      onClick={handleMarkFunded}
                      disabled={markingFunded}
                      className="text-sm text-gray-500 underline hover:text-gray-700 disabled:opacity-60"
                    >
                      {markingFunded ? 'Updating…' : "I sent USDC manually — mark as funded"}
                    </button>
                  </p>
                )}

                <div className="mt-6 flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full text-gray-700 border-gray-300 hover:bg-red-50 hover:border-red-200 hover:text-red-700"
                    onClick={handleReclaim}
                    disabled={reclaiming}
                  >
                    {reclaiming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                    Reclaim funds (cancel and get USDC back)
                  </Button>
                  <Button variant="ghost" className="w-full text-gray-500" onClick={() => { clearCurrentLink(); setGifUrl(null); }}>
                    Create another link
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </>
  );
}
