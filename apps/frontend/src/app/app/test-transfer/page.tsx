"use client";

import { useState } from "react";
import { Connection, Transaction, VersionedTransaction, SendTransactionError } from "@solana/web3.js";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { getRpcForMode } from "@/lib/solanaRpc";
import { getEphemeralRpcForMode } from "@/lib/per/constants";

type Cluster = "devnet" | "mainnet";

type PhantomProvider = {
  publicKey: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  isPhantom?: boolean;
};

function getWalletProvider(): PhantomProvider | undefined {
  const w = window as unknown as { solana?: PhantomProvider };
  return w?.solana;
}

type Status =
  | { type: "idle" }
  | { type: "connecting" }
  | { type: "building" }
  | { type: "awaiting_signature" }
  | { type: "broadcasting" }
  | { type: "confirming" }
  | { type: "success"; signature: string; cluster: Cluster }
  | { type: "error"; message: string };

export default function TestTransferPage() {
  const [cluster, setCluster] = useState<Cluster>("devnet");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const [inspectorUrl, setInspectorUrl] = useState<string | null>(null);

  async function connectWallet() {
    const provider = getWalletProvider();
    if (!provider) {
      setStatus({ type: "error", message: "No Solana wallet found. Install Phantom or another wallet extension." });
      return;
    }
    setStatus({ type: "connecting" });
    try {
      if (provider.publicKey) {
        setWalletAddress(provider.publicKey.toBase58());
      } else {
        const { publicKey } = await provider.connect();
        setWalletAddress(publicKey.toBase58());
      }
      setStatus({ type: "idle" });
    } catch (e) {
      setStatus({ type: "error", message: `Wallet connection failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function sendTransfer() {
    if (!walletAddress) {
      setStatus({ type: "error", message: "Connect your wallet first." });
      return;
    }
    const amountNum = parseFloat(amount);
    if (!recipient.trim() || !amount.trim() || isNaN(amountNum) || amountNum <= 0) {
      setStatus({ type: "error", message: "Enter a valid recipient address and amount." });
      return;
    }

    const provider = getWalletProvider();
    if (!provider?.publicKey) {
      setStatus({ type: "error", message: "Wallet disconnected. Please reconnect." });
      return;
    }

    try {
      setInspectorUrl(null);
      // 1. Build tx via API route (server-side MagicBlock call keeps recipient off network tab)
      setStatus({ type: "building" });
      const buildRes = await fetch("/api/test-transfer/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: walletAddress, to: recipient.trim(), amountUsdc: amountNum, cluster }),
      });
      const txData = await buildRes.json();
      if (!buildRes.ok) {
        throw new Error(txData.error ?? "Failed to build transaction");
      }

      const { transactionBase64, sendTo } = txData as {
        transactionBase64: string;
        sendTo: "base" | "ephemeral";
        kind: string;
        requiredSigners: string[];
      };

      console.log("[test-transfer] tx built", { sendTo, kind: txData.kind, signers: txData.requiredSigners });

      // 2. Deserialize
      const rawBytes = Buffer.from(transactionBase64, "base64");
      let tx: Transaction | VersionedTransaction;
      let isLegacy: boolean;
      try {
        tx = Transaction.from(rawBytes);
        isLegacy = true;
      } catch {
        tx = VersionedTransaction.deserialize(rawBytes);
        isLegacy = false;
      }
      console.log("[test-transfer] deserialized", { isLegacy });

      // Build inspector URL from the unsigned message bytes
      const msgBytes = isLegacy
        ? (tx as Transaction).serializeMessage()
        : (tx as VersionedTransaction).message.serialize();
      const msgBase64 = Buffer.from(msgBytes).toString("base64");
      const clusterParam = cluster === "mainnet" ? "mainnet-beta" : "devnet";
      setInspectorUrl(
        `https://explorer.solana.com/tx/inspector?cluster=${clusterParam}&message=${encodeURIComponent(msgBase64)}`,
      );

      // 3. Sign with wallet
      setStatus({ type: "awaiting_signature" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signed = await provider.signTransaction(tx as any);

      // 4. Broadcast
      setStatus({ type: "broadcasting" });
      const broadcastRpcUrl = sendTo === "ephemeral" ? getEphemeralRpcForMode(cluster === "mainnet" ? "mainnet" : "devnet") : getRpcForMode(cluster === "mainnet" ? "mainnet" : "devnet");
      const broadcastConn = new Connection(broadcastRpcUrl, "confirmed");

      const serialized = isLegacy
        ? (signed as Transaction).serialize()
        : (signed as VersionedTransaction).serialize();

      let signature: string;
      try {
        signature = await broadcastConn.sendRawTransaction(serialized, { skipPreflight: false, preflightCommitment: "confirmed" });
      } catch (e) {
        if (e instanceof SendTransactionError) {
          try {
            const logs = await e.getLogs(broadcastConn);
            console.error("[test-transfer] broadcast failed logs:", logs);
          } catch { /* ignore */ }
        }
        throw e;
      }

      console.log("[test-transfer] broadcast sig:", signature);

      // 5. Confirm
      setStatus({ type: "confirming" });
      const fallbackConn = sendTo === "ephemeral" ? new Connection(getRpcForMode(cluster === "mainnet" ? "mainnet" : "devnet"), "confirmed") : undefined;
      await waitForSignatureConfirmation(broadcastConn, signature, 120_000, 1500, "test-transfer", fallbackConn);

      setStatus({ type: "success", signature, cluster });
    } catch (e) {
      setStatus({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const busy = status.type === "connecting" || status.type === "building" || status.type === "awaiting_signature" || status.type === "broadcasting" || status.type === "confirming";

  const explorerUrl = status.type === "success"
    ? `https://explorer.solana.com/tx/${status.signature}?cluster=${status.cluster === "mainnet" ? "mainnet-beta" : "devnet"}`
    : null;

  const statusLabel: Record<string, string> = {
    connecting: "Connecting wallet…",
    building: "Building transaction…",
    awaiting_signature: "Approve in wallet…",
    broadcasting: "Broadcasting…",
    confirming: "Waiting for confirmation…",
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-md">
        <h1 className="text-xl font-semibold mb-1">Private Transfer Test</h1>
        <p className="text-zinc-400 text-base md:text-sm mb-8">MagicBlock private USDC transfer — no fee sponsor, wallet pays gas.</p>

        {/* Network */}
        <div className="mb-5">
          <label className="block text-sm md:text-xs text-zinc-400 mb-2 uppercase tracking-wide">Network</label>
          <div className="flex gap-2">
            {(["devnet", "mainnet"] as Cluster[]).map((c) => (
              <button
                key={c}
                onClick={() => setCluster(c)}
                disabled={busy}
                className={`px-4 py-2 rounded-lg text-base md:text-sm font-medium transition-colors ${
                  cluster === c
                    ? "bg-violet-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Wallet */}
        <div className="mb-5">
          <label className="block text-sm md:text-xs text-zinc-400 mb-2 uppercase tracking-wide">Sender wallet</label>
          {walletAddress ? (
            <div className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2">
              <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
              <span className="text-base md:text-sm font-mono text-zinc-200 truncate">{walletAddress}</span>
            </div>
          ) : (
            <button
              onClick={connectWallet}
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-base md:text-sm font-medium text-zinc-200 transition-colors disabled:opacity-50"
            >
              Connect Wallet
            </button>
          )}
        </div>

        {/* Recipient */}
        <div className="mb-5">
          <label className="block text-sm md:text-xs text-zinc-400 mb-2 uppercase tracking-wide">Recipient address</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Solana wallet address"
            disabled={busy}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-base md:text-sm font-mono text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-violet-500 disabled:opacity-50"
          />
        </div>

        {/* Amount */}
        <div className="mb-7">
          <label className="block text-sm md:text-xs text-zinc-400 mb-2 uppercase tracking-wide">Amount (USDC)</label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              disabled={busy}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 pr-16 text-base md:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-violet-500 disabled:opacity-50"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm md:text-xs text-zinc-400">USDC</span>
          </div>
        </div>

        {/* Send button */}
        <button
          onClick={sendTransfer}
          disabled={busy || !walletAddress}
          className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-base md:text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? (statusLabel[status.type] ?? "…") : "Send Private Transfer"}
        </button>

        {/* Inspector link — appears after tx is built, before and after signing */}
        {inspectorUrl && (
          <div className="mt-3 text-center">
            <a
              href={inspectorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm md:text-xs text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
            >
              Open in TX Inspector →
            </a>
          </div>
        )}

        {/* Status */}
        {status.type === "error" && (
          <div className="mt-4 p-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-base md:text-sm break-words">
            {status.message}
          </div>
        )}

        {status.type === "success" && (
          <div className="mt-4 p-4 rounded-lg bg-green-950 border border-green-800">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-green-300 text-base md:text-sm font-medium">Transaction confirmed</span>
            </div>
            <p className="text-sm md:text-xs text-zinc-400 mb-1">Signature</p>
            <p className="text-sm md:text-xs font-mono text-zinc-200 break-all mb-3">{status.signature}</p>
            <a
              href={explorerUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm md:text-xs text-violet-400 hover:text-violet-300 underline underline-offset-2"
            >
              View on Explorer →
            </a>
          </div>
        )}

        {/* Note */}
        <p className="mt-6 text-sm md:text-xs text-zinc-600 text-center">
          Private transfers have a random delay (devnet: 30s–5min) before the recipient sees funds.
        </p>
      </div>
    </div>
  );
}
