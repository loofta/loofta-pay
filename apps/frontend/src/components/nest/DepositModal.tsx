"use client";

import { useState } from "react";
import { useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { buildNestDevnetDepositTx, confirmNestDevnetDeposit, faucetNestDevnetUsdc } from "@/services/api/nest";

type Method = "devnet" | "crypto" | "card";

/** Free devnet USDC (no real value) — same on-chain-verify pattern as a real payment (treasury
 *  sponsors gas + its own destination ATA, user signs, server verifies before crediting), just
 *  pointed at devnet via Privy's per-call `chain` override so this one transaction goes to
 *  devnet while the rest of the app stays on mainnet. Credits the devnet-demo ledger only (see
 *  nest-ledger-id.ts) — never mixed with real money. Card and real-crypto deposit aren't wired up
 *  yet for this pilot; shown greyed out so the eventual shape of the product is visible.
 */
export function DepositModal({
  onClose,
  onDeposited,
  embeddedWallet,
  embeddedSolAddress,
  getAccessToken,
  userId,
}: {
  onClose: () => void;
  onDeposited: () => void;
  embeddedWallet: any;
  embeddedSolAddress: string;
  getAccessToken: () => Promise<string | null>;
  userId?: string;
}) {
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const [method, setMethod] = useState<Method>("devnet");
  const [amount, setAmount] = useState("100");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDeposit = async () => {
    const amountUsdc = Number(amount);
    if (!Number.isFinite(amountUsdc) || amountUsdc < 1) {
      setError("Enter an amount");
      return;
    }
    if (!embeddedWallet?.address) {
      setError("No Solana wallet found");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      // A fresh embedded wallet holds no devnet USDC, so the transfer below would always fail
      // with nothing to send — grant it some first. No-ops (throws a recognizable message we
      // swallow) once the wallet already has some, so this is safe to call on every attempt.
      try {
        await faucetNestDevnetUsdc(embeddedSolAddress, { userId, accessToken });
      } catch (faucetErr: any) {
        if (!(faucetErr?.message ?? "").toLowerCase().includes("already has devnet usdc")) throw faucetErr;
      }
      const { txBase64 } = await buildNestDevnetDepositTx(embeddedSolAddress, amountUsdc, { userId, accessToken });
      const txBytes = Buffer.from(txBase64, "base64");
      const { signature: sigBytes } = await signAndSendTransaction({
        transaction: txBytes as unknown as Uint8Array,
        wallet: embeddedWallet,
        chain: "solana:devnet",
      });
      const signature = bs58.encode(sigBytes as Uint8Array);
      await confirmNestDevnetDeposit(embeddedSolAddress, signature, amountUsdc, { userId, accessToken });
      onDeposited();
      onClose();
    } catch (e: any) {
      const msg = (e?.message ?? "").toLowerCase();
      if (msg.includes("insufficient funds")) setError("Your devnet wallet needs devnet USDC first — use a devnet faucet, then try again.");
      else if (msg.includes("user rejected") || msg.includes("denied")) setError("Deposit cancelled.");
      else setError("Deposit failed — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ns-root" style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(20,18,14,.45)", padding: 16 }}>
      <div className="ns-card" style={{ width: "100%", maxWidth: 420, padding: 22 }}>
        <div className="ns-serif" style={{ fontSize: 24 }}>Deposit into your Nest</div>
        <p style={{ marginTop: 6, fontSize: 14, color: "var(--ink2)" }}>Free devnet USDC for this pilot — no real money involved yet.</p>

        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          <MethodTile
            active={method === "devnet"}
            enabled
            title="Devnet demo"
            subtitle="Free devnet USDC — try it risk-free"
            badge="Available"
            onClick={() => setMethod("devnet")}
          />
          <MethodTile active={false} enabled={false} title="Crypto" subtitle="From your wallet, real USDC" badge="Coming soon" onClick={() => {}} />
          <MethodTile active={false} enabled={false} title="Card" subtitle="Pay with debit or credit" badge="Coming soon" onClick={() => {}} />
        </div>

        <label style={{ marginTop: 18, display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink3)" }}>Amount (USD)</label>
        <input
          type="number"
          min={1}
          value={amount}
          onChange={e => setAmount(e.target.value)}
          style={{ marginTop: 6, width: "100%", borderRadius: 10, border: "1px solid var(--line)", background: "var(--paper)", padding: "10px 12px", fontSize: 16, color: "var(--ink)", outline: "none" }}
        />

        {error && <p style={{ marginTop: 8, fontSize: 13, color: "var(--down)" }}>{error}</p>}

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, borderRadius: 10, border: "1px solid var(--line)", background: "transparent", padding: "11px 0", fontSize: 14, color: "var(--ink2)", cursor: "pointer" }}>
            Cancel
          </button>
          <button className="ns-btn" style={{ flex: 1, justifyContent: "center", padding: "11px 0", fontSize: 14, opacity: submitting ? 0.6 : 1 }} onClick={handleDeposit} disabled={submitting}>
            {submitting ? "Depositing…" : "Deposit"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MethodTile({ active, enabled, title, subtitle, badge, onClick }: { active: boolean; enabled: boolean; title: string; subtitle: string; badge: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        textAlign: "left",
        padding: "13px 16px",
        borderRadius: 12,
        border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        borderWidth: active ? 2 : 1,
        background: active ? "color-mix(in oklch, var(--accent) 8%, transparent)" : "#fff",
        cursor: enabled ? "pointer" : "default",
        opacity: enabled ? 1 : 0.45,
      }}
    >
      <div>
        <p style={{ fontWeight: 600, fontSize: 14 }}>{title}</p>
        <p style={{ fontSize: 12, color: "var(--ink3)" }}>{subtitle}</p>
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          padding: "3px 9px",
          borderRadius: 999,
          background: enabled ? "color-mix(in oklch, var(--accent) 15%, transparent)" : "var(--paper2)",
          color: enabled ? "var(--accent)" : "var(--ink3)",
        }}
      >
        {badge}
      </span>
    </button>
  );
}
