"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  useWallets as useSolanaWallets,
  useSignTransaction as usePrivySolanaSignTransaction,
} from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import { Loader2, ExternalLink, KeyRound, Copy, Check } from "lucide-react";
import { DocsCodeBlock } from "../DocsCodeBlock";
import { RAW_KEY_STORAGE_KEY } from "./ApiKeySetup";
import { createPayoutWithKey, PAYOUT_RECIPIENT_TYPES, type PayoutRecipientType, type PayoutFundingSource } from "@/services/api/payouts";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";
import { getRpcForMode, getRpcFallbackForMode } from "@/lib/solanaRpc";
import { getEphemeralRpcForMode } from "@/lib/per/constants";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";

type NetworkOption = "solana" | "base" | "ton" | "stellar";

// Every network/token pair the payouts API actually supports — "solana" signs and broadcasts a
// Solana transaction with your own wallet right here, the other three return a deposit address
// instead (see funding_source in the payouts DTO). Fixed 1:1 token-per-network today, so picking
// either dropdown keeps the other in sync rather than allowing invalid combinations.
const NETWORKS: { value: NetworkOption; label: string; token: "USDC" | "USDT"; fundingSource?: PayoutFundingSource }[] = [
  { value: "solana", label: "Solana", token: "USDC" },
  { value: "base", label: "Base", token: "USDC", fundingSource: "usdc_base" },
  { value: "ton", label: "TON", token: "USDT", fundingSource: "usdt_ton" },
  { value: "stellar", label: "Stellar", token: "USDC", fundingSource: "usdc_stellar" },
];
const TOKENS = ["USDC", "USDT"] as const;

const RECIPIENT_LABELS: Record<PayoutRecipientType, { label: string; placeholder: string; type: string }> = {
  email: { label: "Recipient email", placeholder: "alice@example.com", type: "email" },
  username: { label: "Recipient username", placeholder: "alice", type: "text" },
  twitter: { label: "Twitter handle", placeholder: "@alice", type: "text" },
  discord: { label: "Discord handle", placeholder: "alice#0", type: "text" },
  github: { label: "GitHub handle", placeholder: "alice", type: "text" },
  telegram: { label: "Telegram handle", placeholder: "@alice", type: "text" },
};

const PRIVATE_MIN_USD = 5;
const CUSTOM_INTEGRATION_HREF = "mailto:hello@loofta.xyz?subject=" + encodeURIComponent("Custom payout integration");
const TELEGRAM_HREF = "https://t.me/looftaxyz";

type PayNowPhase =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "awaiting_signature" }
  | { kind: "broadcasting" }
  | { kind: "done_signed"; claimLink: string; signature: string; rawResponse: string }
  | { kind: "done_deposit"; claimLink: string; depositAddress: string; depositMemo: string | null; depositAmount?: string; depositDeadline?: string; depositNote?: string; token: string; rawResponse: string }
  | { kind: "error"; message: string };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
      aria-label="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function TryPayNow() {
  const { login, authenticated, user } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { signTransaction: privySolanaSignTransaction } = usePrivySolanaSignTransaction();

  const [apiKey, setApiKey] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(RAW_KEY_STORAGE_KEY) ?? "";
  });
  const [network, setNetwork] = useState<NetworkOption>("solana");
  const [recipientType, setRecipientType] = useState<PayoutRecipientType>("email");
  const [recipientIdentifier, setRecipientIdentifier] = useState("");
  const [amount, setAmount] = useState("1");
  const [message, setMessage] = useState("Try it demo payout");
  const [isPrivate, setIsPrivate] = useState(false);
  const [refundWallet, setRefundWallet] = useState("");
  const [phase, setPhase] = useState<PayNowPhase>({ kind: "idle" });

  const selectedNetwork = NETWORKS.find((n) => n.value === network) ?? NETWORKS[0];
  const senderAddress = deriveSolanaEmbeddedAddress(user);
  const isBusy = phase.kind === "creating" || phase.kind === "awaiting_signature" || phase.kind === "broadcasting";
  const recipientMeta = RECIPIENT_LABELS[recipientType];

  function handleTokenChange(token: string) {
    const match = NETWORKS.find((n) => n.token === token && n.value === network) ?? NETWORKS.find((n) => n.token === token);
    if (match) setNetwork(match.value);
  }

  async function handlePayNow() {
    setPhase({ kind: "idle" });
    if (!apiKey.trim()) {
      setPhase({ kind: "error", message: "Paste your API key first (generate one above)." });
      return;
    }
    if (!recipientIdentifier.trim()) {
      setPhase({ kind: "error", message: `Enter a ${recipientMeta.label.toLowerCase()}.` });
      return;
    }
    const amountNum = Number(amount);
    if (!amountNum || amountNum < 1) {
      setPhase({ kind: "error", message: "Minimum is $1." });
      return;
    }
    if (isPrivate && amountNum < PRIVATE_MIN_USD) {
      setPhase({ kind: "error", message: `Private payouts require a $${PRIVATE_MIN_USD} minimum.` });
      return;
    }
    if (selectedNetwork.fundingSource && !refundWallet.trim()) {
      setPhase({ kind: "error", message: `Enter a refund address on ${selectedNetwork.label} in case the deposit can't complete.` });
      return;
    }

    // Only the Solana path signs anything here — funding_source just needs the API call, no wallet.
    if (network === "solana") {
      if (!authenticated) {
        login();
        return;
      }
      if (!senderAddress) {
        setPhase({ kind: "error", message: "No embedded wallet found. Try logging out and back in." });
        return;
      }
    }
    const wallet = network === "solana" ? solanaWallets.find((w) => w.address === senderAddress) : undefined;
    if (network === "solana" && !wallet) {
      setPhase({ kind: "error", message: "No embedded wallet found. Try logging out and back in." });
      return;
    }

    try {
      setPhase({ kind: "creating" });
      const created = await createPayoutWithKey(apiKey.trim(), {
        amount: amountNum,
        recipientType,
        recipientIdentifier: recipientIdentifier.trim(),
        senderWallet: network === "solana" ? (senderAddress ?? undefined) : undefined,
        fundingSource: selectedNetwork.fundingSource,
        refundWallet: selectedNetwork.fundingSource ? refundWallet.trim() : undefined,
        message: message || undefined,
        isPrivate,
      });

      if (selectedNetwork.fundingSource) {
        if (!created.deposit_address) throw new Error("No deposit_address returned.");
        setPhase({
          kind: "done_deposit",
          claimLink: created.claim_link,
          depositAddress: created.deposit_address,
          depositMemo: created.deposit_memo ?? null,
          depositAmount: created.deposit_amount,
          depositDeadline: created.deposit_deadline,
          depositNote: created.deposit_note,
          token: selectedNetwork.token,
          rawResponse: JSON.stringify(created, null, 2),
        });
        return;
      }

      if (!created.unsigned_transaction || !wallet) {
        throw new Error("No unsigned_transaction returned.");
      }

      setPhase({ kind: "awaiting_signature" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signedOutput = await (privySolanaSignTransaction as any)({
        transaction: Buffer.from(created.unsigned_transaction, "base64") as Uint8Array,
        wallet,
        chain: "solana:mainnet",
        options: { uiOptions: { showWalletUIs: false } },
      });
      const signedBytes: Uint8Array = signedOutput.signedTransaction;

      setPhase({ kind: "broadcasting" });
      // Private transfers can require MagicBlock's ephemeral rollup RPC instead of base Solana —
      // send_to says which.
      const rpc = created.send_to === "ephemeral" ? getEphemeralRpcForMode("mainnet") : getRpcForMode("mainnet");
      const connection = new Connection(rpc, "confirmed");
      const signature = await connection.sendRawTransaction(signedBytes, { skipPreflight: true, maxRetries: 3 });
      const fallbackRpc = created.send_to === "ephemeral" ? getRpcForMode("mainnet") : getRpcFallbackForMode("mainnet");
      const fallbackConn = fallbackRpc ? new Connection(fallbackRpc, "confirmed") : undefined;
      await waitForSignatureConfirmation(connection, signature, 60_000, 1500, "payoutsTryIt", fallbackConn);

      setPhase({ kind: "done_signed", claimLink: created.claim_link, signature, rawResponse: JSON.stringify(created, null, 2) });
    } catch (e: any) {
      const msg = e?.message?.includes("user rejected") || e?.message?.includes("denied")
        ? "Signature was cancelled."
        : e?.message || "Payout failed";
      setPhase({ kind: "error", message: msg });
    }
  }

  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-4 space-y-4">
      <div>
        <label className="text-base text-slate-400 mb-1 flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5" /> API key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="lft_live_..."
          className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-base text-slate-400 mb-1 block">Token</label>
          <select
            value={selectedNetwork.token}
            onChange={(e) => handleTokenChange(e.target.value)}
            className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
          >
            {TOKENS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-base text-slate-400 mb-1 block">Network</label>
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value as NetworkOption)}
            className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
          >
            {NETWORKS.filter((n) => n.token === selectedNetwork.token).map((n) => (
              <option key={n.value} value={n.value}>{n.label}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-base text-slate-400 -mt-2">
        {network === "solana"
          ? "Signs a Solana transaction with your own Loofta wallet, right here."
          : `Skips signing — you'll get a deposit address to send ${selectedNetwork.token} to on ${selectedNetwork.label}.`}
      </p>

      <div>
        <label className="text-base text-slate-400 mb-1 block">Recipient type</label>
        <select
          value={recipientType}
          onChange={(e) => setRecipientType(e.target.value as PayoutRecipientType)}
          className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
        >
          {PAYOUT_RECIPIENT_TYPES.map((t) => (
            <option key={t} value={t}>{RECIPIENT_LABELS[t].label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-base text-slate-400 mb-1 block">{recipientMeta.label}</label>
        <input
          type={recipientMeta.type}
          value={recipientIdentifier}
          onChange={(e) => setRecipientIdentifier(e.target.value)}
          placeholder={recipientMeta.placeholder}
          className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
        />
      </div>

      {selectedNetwork.fundingSource && (
        <div>
          <label className="text-base text-slate-400 mb-1 block">Your refund address on {selectedNetwork.label}</label>
          <input
            type="text"
            value={refundWallet}
            onChange={(e) => setRefundWallet(e.target.value)}
            placeholder={`Your ${selectedNetwork.label} address`}
            className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
          />
          <p className="text-base text-slate-400 mt-1">Used to refund you if the deposit can&apos;t complete.</p>
        </div>
      )}

      <div>
        <label className="text-base text-slate-400 mb-1 block">Amount (USD)</label>
        <input
          type="number"
          min={isPrivate ? PRIVATE_MIN_USD : 1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
        />
      </div>
      <div>
        <label className="text-base text-slate-400 mb-1 block">Message</label>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={500}
          className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-base text-white outline-none focus:border-orange-400/50"
        />
      </div>
      <label className="flex items-center gap-2 text-base text-slate-300">
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => setIsPrivate(e.target.checked)}
          className="rounded border-white/20 bg-black/30 accent-orange-500"
        />
        Pay privately
        <span className="text-slate-400">— shields the amount and your wallet, ${PRIVATE_MIN_USD} minimum</span>
      </label>

      <button
        type="button"
        onClick={handlePayNow}
        disabled={isBusy}
        className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50"
      >
        {isBusy && <Loader2 className="w-4 h-4 animate-spin" />}
        {network === "solana" && !authenticated
          ? "Log in to pay"
          : phase.kind === "creating"
            ? "Creating payout…"
            : phase.kind === "awaiting_signature"
              ? "Confirm in wallet…"
              : phase.kind === "broadcasting"
                ? "Sending…"
                : `Pay now — $${formatUsd(amount)}`}
      </button>

      {phase.kind === "error" && <p className="text-base text-red-400">{phase.message}</p>}

      {phase.kind === "done_signed" && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-400/30 p-3 space-y-2">
          <p className="text-base font-medium text-emerald-200">Paid — recipient can claim it now</p>
          <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3">
            <a
              href={phase.claimLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-0 truncate text-base text-slate-300 hover:text-white hover:underline underline-offset-2 transition-colors"
            >
              {phase.claimLink}
            </a>
            <CopyButton text={phase.claimLink} />
            <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </div>
          <p className="text-base text-slate-400">
            Signature:{" "}
            <a
              href={`https://solscan.io/tx/${phase.signature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-400 hover:underline"
            >
              {phase.signature.slice(0, 12)}…
            </a>
          </p>
        </div>
      )}
      {phase.kind === "done_signed" && <DocsCodeBlock label="Response" code={phase.rawResponse} />}

      {phase.kind === "done_deposit" && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-400/30 p-3 space-y-2">
          <p className="text-base font-medium text-amber-200">
            Send {phase.depositAmount ?? "the exact amount"} {phase.token} here to complete it
          </p>
          <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3">
            <code className="flex-1 min-w-0 truncate text-base text-slate-300">{phase.depositAddress}</code>
            <CopyButton text={phase.depositAddress} />
          </div>
          {phase.depositMemo && (
            <p className="text-base text-slate-400">Memo: <code className="text-slate-300">{phase.depositMemo}</code></p>
          )}
          {phase.depositDeadline && (
            <p className="text-base text-slate-400">Deadline: {new Date(phase.depositDeadline).toLocaleString()}</p>
          )}
          {phase.depositNote && (
            <p className="text-base text-amber-200/90 bg-amber-500/10 border border-amber-400/20 rounded-lg px-3 py-2">
              {phase.depositNote}
            </p>
          )}
          <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3">
            <a
              href={phase.claimLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-0 truncate text-base text-slate-300 hover:text-white hover:underline underline-offset-2 transition-colors"
            >
              {phase.claimLink}
            </a>
            <CopyButton text={phase.claimLink} />
            <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </div>
        </div>
      )}
      {phase.kind === "done_deposit" && <DocsCodeBlock label="Response" code={phase.rawResponse} />}
    </div>
  );
}

function formatUsd(amount: string): string {
  const n = Number(amount);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

export function SendPayments({ onNavigate }: { onNavigate: (slug: string) => void }) {
  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">Send payments</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-3">
        Pay anyone by identity, no wallet address needed on either side:
      </p>
      <ul className="list-disc list-inside space-y-2 text-base text-slate-300 mb-4">
        <li><strong className="text-slate-100 font-medium">Community members</strong> — Discord or Telegram handle.</li>
        <li><strong className="text-slate-100 font-medium">Contributors</strong> — GitHub username or email.</li>
        <li><strong className="text-slate-100 font-medium">Creators</strong> — X handle. TikTok and Instagram are coming.</li>
        <li><strong className="text-slate-100 font-medium">Collaborators, freelancers, bounty winners</strong> — email or username.</li>
        <li><strong className="text-slate-100 font-medium">One or many</strong> — pay one person with this endpoint, or batch up to 10 recipients in a single signature with multi-send.</li>
      </ul>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        Recipients don&apos;t need a wallet ready to go either. They claim straight to a wallet
        Loofta sets up for them on the spot, or, in Nigeria, straight to a bank account instead.
      </p>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        <code className="text-orange-300">POST /payouts</code> pays a recipient — by email,
        username, or social handle — from the API key owner's own account. The counterpart to{" "}
        <button type="button" onClick={() => onNavigate("receive-payments")} className="text-orange-400 hover:underline">
          payment links
        </button>
        : that one gets you paid, this one pays someone else. Self-custody — it returns an
        unsigned transaction, you sign it with your own wallet. Loofta never holds or moves your
        funds on your behalf.
      </p>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-8">
        <p className="text-slate-300 text-base">
          Need a specific SPL token, a recurring payout schedule, funds released only when a
          condition is met, or a custom integration into your own systems?{" "}
          <a href={TELEGRAM_HREF} target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:underline">
            Message us on Telegram
          </a>{" "}
          or{" "}
          <a href={CUSTOM_INTEGRATION_HREF} className="text-orange-400 hover:underline">
            email us
          </a>{" "}
          and we&apos;ll build it with you.
        </p>
      </div>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Try it — pay someone now</h2>
      <p className="text-base text-slate-400 mb-4">
        Live (mainnet) — this sends a real, small payout from your own account.{" "}
        <code className="text-orange-300">Pay now</code> calls <code className="text-orange-300">POST /payouts</code>{" "}
        with your API key; on Solana it signs the returned transaction with your own Loofta wallet
        right here and broadcasts it, the same round trip a real integration makes. If you leave
        it unsettled — never signed, or never funded at the deposit address — it auto-expires
        after 4 hours.
      </p>
      <TryPayNow />
      <p className="text-base text-slate-400 mb-8">
        Don&apos;t have a key yet?{" "}
        <button type="button" onClick={() => onNavigate("api-key")} className="text-orange-400 hover:underline">
          Generate one
        </button>.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Request</h2>
      <DocsCodeBlock
        label="POST /payouts"
        code={`curl -X POST https://api.loofta.xyz/payouts \\
  -H "Authorization: Bearer lft_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 25,
    "recipient_type": "email",
    "recipient_identifier": "alice@example.com",
    "sender_wallet": "5dCT...BKuq",
    "message": "August payout"
  }'`}
      />

      <table className="w-full text-base text-left mb-6">
        <thead>
          <tr className="text-base text-slate-400 border-b border-white/10">
            <th className="py-2 pr-4 font-medium">Field</th>
            <th className="py-2 pr-4 font-medium">Type</th>
            <th className="py-2 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody className="text-slate-300">
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>amount</code></td>
            <td className="py-2 pr-4 text-slate-400">number</td>
            <td className="py-2 text-slate-400">USD, $10,000 maximum. $1 minimum, $5 minimum if <code>is_private</code> is <code>true</code>.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>recipient_type</code></td>
            <td className="py-2 pr-4 text-slate-400">string</td>
            <td className="py-2 text-slate-400"><code>email</code>, <code>username</code>, <code>twitter</code>, <code>discord</code>, <code>github</code>, or <code>telegram</code>.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>recipient_identifier</code></td>
            <td className="py-2 pr-4 text-slate-400">string</td>
            <td className="py-2 text-slate-400">The email address, Loofta username, or handle, matching <code>recipient_type</code>.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>sender_wallet</code></td>
            <td className="py-2 pr-4 text-slate-400">string, optional</td>
            <td className="py-2 text-slate-400">Your own Solana wallet's public key — pays gas and signs the returned transaction. Loofta never touches it. Omit if you're paying with <code>funding_source</code> instead.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>funding_source</code></td>
            <td className="py-2 pr-4 text-slate-400">string, optional</td>
            <td className="py-2 text-slate-400">
              Fund from another chain instead of signing a Solana transaction: <code>usdt_ton</code>, <code>usdc_base</code>,
              or <code>usdc_stellar</code>. Pass this instead of <code>sender_wallet</code> — the response gives you a
              deposit address and the exact amount to send there for an exact-output delivery. Requires <code>refund_wallet</code>.
            </td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>refund_wallet</code></td>
            <td className="py-2 pr-4 text-slate-400">string, optional</td>
            <td className="py-2 text-slate-400">Your address on the <code>funding_source</code> chain, used to refund you if the deposit can't complete. Required when <code>funding_source</code> is set.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>message</code></td>
            <td className="py-2 pr-4 text-slate-400">string, optional</td>
            <td className="py-2 text-slate-400">Shown to the recipient on their claim page. 500 characters max.</td>
          </tr>
          <tr>
            <td className="py-2 pr-4"><code>is_private</code></td>
            <td className="py-2 pr-4 text-slate-400">boolean, optional</td>
            <td className="py-2 text-slate-400">Defaults to <code>false</code>. Pass <code>true</code> to shield the amount and your wallet on-chain — a MagicBlock private transfer, ~10 bps + $0.20 flat gas on top of <code>amount</code>.</td>
          </tr>
        </tbody>
      </table>
      <p className="text-base text-slate-400 mb-6">
        A payout that never gets funded auto-expires — <code>unsigned_transaction</code> never
        signed and broadcast expires 4 hours after creation; nothing ever sent to a{" "}
        <code>deposit_address</code> expires whenever that deposit address's own bridge quote does
        (often a few days, never less than 4 hours), since the claim shouldn't die before the
        address stops being watched. Once expired, <code>claim_link</code> no longer accepts
        payment. A payout that has already been funded is unaffected, however long the recipient
        takes to claim it.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Response</h2>
      <DocsCodeBlock
        code={`{
  "payment_id": "b3f1...e02a",
  "short_id": "aB3xK9pQ",
  "claim_link": "https://pay.loofta.xyz/c/aB3xK9pQ",
  "unsigned_transaction": "AQAAAAAAAAAAAAAAAAAAAAAA...",
  "transaction_version": "legacy",
  "send_to": "base",
  "is_private": false
}`}
      />
      <p className="text-base text-slate-400 mb-6">
        <code className="text-orange-300">unsigned_transaction</code> is a base64-encoded, unsigned
        Solana transaction — <code>transaction_version</code> tells you whether to deserialize it
        as a legacy <code>Transaction</code> or a <code>VersionedTransaction</code> (private
        transfers can come back as either; public ones are always <code>legacy</code>).{" "}
        <code>send_to</code> tells you which RPC to broadcast the signed transaction to —{" "}
        <code>&quot;base&quot;</code> is regular Solana; a private transfer can come back as{" "}
        <code>&quot;ephemeral&quot;</code>, MagicBlock&apos;s own rollup RPC, instead.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Sign and broadcast</h2>
      <p className="text-base text-slate-400 mb-3">
        This is the one step Loofta can't do for you — <code>sender_wallet</code> is your own
        wallet, so only you can authorize spending from it. Deserialize, sign with that wallet's
        keypair, and send it to the RPC <code>send_to</code> names:
      </p>
      <DocsCodeBlock
        code={`import { Connection, Transaction, VersionedTransaction, Keypair } from "@solana/web3.js";

const rpcUrl = send_to === "ephemeral"
  ? "https://mainnet-tee.magicblock.app"
  : "https://api.mainnet-beta.solana.com";
const connection = new Connection(rpcUrl);
const senderKeypair = Keypair.fromSecretKey(/* your own key, never sent to Loofta */);

const raw = Buffer.from(unsigned_transaction, "base64");
const tx = transaction_version === "v0"
  ? VersionedTransaction.deserialize(raw)
  : Transaction.from(raw);

tx.sign(senderKeypair); // VersionedTransaction: tx.sign([senderKeypair])
const signature = await connection.sendRawTransaction(tx.serialize());`}
      />
      <p className="text-base text-slate-400 mb-6">
        The recipient sees the payout waiting for them at <code>claim_link</code> the moment
        your transaction lands — same claim/burner mechanics as every other Loofta payment, so an
        unregistered recipient claims by signing in with the email or handle you sent it to.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Funding from another chain</h2>
      <p className="text-base text-slate-400 mb-3">
        Pass <code>funding_source</code> instead of <code>sender_wallet</code> to skip the Solana
        transaction entirely — you'll get a deposit address to send USDT/USDC to on the chain you
        actually hold funds on:
      </p>
      <DocsCodeBlock
        label="POST /payouts"
        code={`curl -X POST https://api.loofta.xyz/payouts \\
  -H "Authorization: Bearer lft_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 25,
    "recipient_type": "email",
    "recipient_identifier": "alice@example.com",
    "funding_source": "usdc_base",
    "refund_wallet": "0xYourBaseAddress..."
  }'`}
      />
      <DocsCodeBlock
        code={`{
  "payment_id": "b3f1...e02a",
  "short_id": "aB3xK9pQ",
  "claim_link": "https://pay.loofta.xyz/c/aB3xK9pQ",
  "is_private": false,
  "funding_source": "usdc_base",
  "deposit_address": "0x9f2c...4a1b",
  "deposit_memo": null,
  "deposit_amount": "25.081234",
  "deposit_deadline": "2026-09-07T12:34:56.000Z"
}`}
      />
      <p className="text-base text-slate-400 mb-6">
        Send exactly <code>deposit_amount</code> of the <code>funding_source</code> token to{" "}
        <code>deposit_address</code> (include <code>deposit_memo</code> if present) before{" "}
        <code>deposit_deadline</code>. Alice sees the payout at <code>claim_link</code> once the
        deposit is confirmed and swept — there's nothing left for you to sign or broadcast.
      </p>
      <p className="text-base text-amber-300/90 mb-6">
        <code className="text-amber-200">deposit_note</code> (only present for{" "}
        <code>usdt_ton</code>): every TON deposit address is brand new and holds zero TON. Most
        wallets attach enough gas automatically when you use their normal send flow, but a jetton
        transfer sent with too little forward gas can land on-chain and still never register as a
        deposit — the confirmed failure mode is a gas-starved notification message, not a lost
        payment, but it needs manual recovery either way. Read this field and pass it through to
        whoever's actually sending the funds.
      </p>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-4">
        <p className="text-slate-300 text-base">
          Want your recipient landing on your own branded page instead of{" "}
          <code>pay.loofta.xyz</code>?{" "}
          <button type="button" onClick={() => onNavigate("whitelabel")} className="text-orange-400 hover:underline">
            Whitelabel the claim page
          </button>
          . It&apos;s set up on-demand, contact us to turn it on.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="text-slate-300 text-base">
          Building with an AI coding agent? Grab the copyable{" "}
          <button type="button" onClick={() => onNavigate("agent-skill")} className="text-orange-400 hover:underline">
            agent skill
          </button>{" "}
          — it covers this endpoint too.
        </p>
      </div>
    </article>
  );
}
