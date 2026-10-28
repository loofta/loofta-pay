"use client";

import { useEffect, useState } from "react";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { ExternalLink } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuthStore } from "@/store/auth";
import { useSolDomain } from "@/hooks/useSolDomain";
import { isSolDomain } from "@/lib/refundAddresses";
import type { WalletNft } from "@/hooks/useWalletNfts";
import { useLooftaSigner } from "@/components/deposit/DepositSheet";
import { WalletModal } from "@/components/wallet/WalletModal";
import { waitForSignatureConfirmation } from "@/lib/per/confirmSignature";
import { getPrivySolanaChainForMode, getRpcForMode } from "@/lib/solanaRpc";
import { getExplorerTxUrl } from "@/lib/getExplorerTxUrl";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD_BOX, FIELD_INPUT, FIELD_PILL, shortAddress } from "@/components/wallet/walletStyles";

const SORA = "var(--font-home-sora), Sora, sans-serif";
const MONO = "var(--font-home-mono), ui-monospace, monospace";
/** Rent for the receiver's token account (if it does not exist yet) plus the network fee, with room to spare. */
const MIN_SOL_FOR_NFT_SEND = 0.003;

function isSolanaAddress(v: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return false;
  try {
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
}

/** Send one standard token NFT to a wallet address or .sol name. Paid for by the user's own SOL. */
export function WalletNftSendModal({ nft, solanaAddress, onClose, onDone }: { nft: WalletNft | null; solanaAddress: string | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const networkMode = useAuthStore((s) => s.networkMode);
  const cluster = networkMode === "devnet" ? "devnet" : "mainnet";
  const { wallet, signTransaction } = useLooftaSigner(solanaAddress);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [sig, setSig] = useState<string | null>(null);

  useEffect(() => {
    if (!nft) {
      setRecipient("");
      setBusy(false);
      setSig(null);
    }
  }, [nft]);

  const typed = recipient.trim();
  const isDomain = isSolDomain(typed.toLowerCase());
  const domain = useSolDomain(typed, networkMode);
  const resolved = isDomain && domain.status === "resolved" ? domain.address : null;
  const dest = isDomain ? resolved : isSolanaAddress(typed) ? typed : null;
  const invalid = typed !== "" && !isDomain && !dest;
  const self = !!dest && dest === solanaAddress;

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setRecipient(text.replace(/\s/g, ""));
    } catch {
      /* clipboard blocked */
    }
  };

  const send = async () => {
    if (!nft || !wallet || !solanaAddress || !dest || self) return;
    setBusy(true);
    try {
      const connection = new Connection(getRpcForMode(cluster), "confirmed");
      const from = new PublicKey(solanaAddress);
      const to = new PublicKey(dest);
      const mint = new PublicKey(nft.id);

      const sol = (await connection.getBalance(from)) / 1e9;
      if (sol < MIN_SOL_FOR_NFT_SEND) throw new Error(`You need about ${MIN_SOL_FOR_NFT_SEND} SOL in your wallet for the network fee.`);

      const mintInfo = await connection.getAccountInfo(mint);
      if (!mintInfo) throw new Error("This NFT could not be found on-chain.");
      const programId = mintInfo.owner;
      const fromAta = getAssociatedTokenAddressSync(mint, from, false, programId);
      const held = await getAccount(connection, fromAta, "confirmed", programId);
      if (held.amount !== 1n) throw new Error("This NFT is not in your wallet any more.");
      if (held.isFrozen) throw new Error("This NFT is frozen and can't be moved.");

      const toAta = getAssociatedTokenAddressSync(mint, to, true, programId);
      const tx = new Transaction();
      tx.add(createAssociatedTokenAccountIdempotentInstruction(from, toAta, to, mint, programId));
      tx.add(createTransferCheckedInstruction(fromAta, mint, toAta, from, 1n, 0, [], programId));
      // The emptied token account is ours, so close it and take its rent back (classic Token program only).
      if (programId.equals(TOKEN_PROGRAM_ID)) tx.add(createCloseAccountInstruction(fromAta, from, from, [], programId));

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = from;
      const { signedTransaction } = await signTransaction({
        transaction: tx.serialize({ requireAllSignatures: false }),
        wallet,
        chain: getPrivySolanaChainForMode(cluster),
      });
      const signature = await connection.sendRawTransaction(signedTransaction, { skipPreflight: false, preflightCommitment: "confirmed" });
      await waitForSignatureConfirmation(connection, signature, 120_000, 1500, "walletNftSend");
      setSig(signature);
      onDone();
    } catch (e) {
      toast({ title: "Could not send", description: e instanceof Error ? e.message : "Something went wrong. Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <WalletModal open={nft != null} onClose={onClose} title={sig ? "Sent" : "Send NFT"}>
      {nft && !sig && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 12, borderRadius: 20, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.05)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={nft.image} alt="" width={56} height={56} style={{ width: 56, height: 56, borderRadius: 14, objectFit: "cover", background: "#22222A" }} />
            <span style={{ fontWeight: 700, fontSize: 16, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nft.name}</span>
          </div>
          <div style={FIELD_BOX}>
            <input value={recipient} onChange={(e) => setRecipient(e.target.value.replace(/\s/g, ""))} placeholder="Wallet address or .sol name" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="Recipient wallet address or .sol name" style={{ ...FIELD_INPUT, fontFamily: recipient ? MONO : undefined }} />
            <button type="button" onClick={() => void paste()} style={FIELD_PILL}>Paste</button>
          </div>
          {isDomain && domain.status === "resolving" && <span style={{ fontSize: 14, color: "#77757F", padding: "0 6px" }}>Looking up {typed}…</span>}
          {isDomain && resolved && <span style={{ fontSize: 14, color: "#6FD69A", padding: "0 6px" }}>{typed} → <span style={{ fontFamily: MONO }}>{shortAddress(resolved)}</span></span>}
          {isDomain && domain.status === "not-found" && <span style={{ fontSize: 14, color: "#FF7A6A", padding: "0 6px" }}>No wallet found for {typed}.</span>}
          {invalid && <span style={{ fontSize: 14, color: "#FF7A6A", padding: "0 6px" }}>Enter a Solana wallet address or a .sol name.</span>}
          {self && <span style={{ fontSize: 14, color: "#FF7A6A", padding: "0 6px" }}>That is your own wallet.</span>}
          <span style={{ fontSize: 13, color: "#77757F", padding: "0 6px", lineHeight: 1.45 }}>The network fee is paid in SOL from your wallet. Sending is final, so check the address.</span>
          <button type="button" onClick={() => void send()} disabled={!dest || self || busy} style={{ ...BTN_PRIMARY, flex: "none", width: "100%", marginTop: "auto", opacity: !dest || self || busy ? 0.5 : 1, cursor: !dest || self || busy ? "default" : "pointer" }}>
            {busy ? "Sending…" : "Send NFT"}
          </button>
        </div>
      )}
      {nft && sig && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center", paddingTop: 12 }}>
          <div style={{ width: 84, height: 84, borderRadius: 28, background: "radial-gradient(120% 120% at 28% 18%,#B8F5D0 0%,#3CB371 48%,#23864F 100%)", boxShadow: "inset 0 4px 8px rgba(255,255,255,0.5),inset 0 -8px 14px rgba(0,0,0,0.22),0 8px 0 #17603A,0 24px 40px rgba(0,0,0,0.5)", display: "grid", placeItems: "center", fontSize: 40, color: "#fff", fontWeight: 800 }}>✓</div>
          <span style={{ fontFamily: SORA, fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em" }}>{nft.name} is on its way</span>
          <span style={{ fontSize: 15, lineHeight: 1.5, color: "#9A98A3", maxWidth: 320 }}>Your transfer is confirmed on Solana.</span>
          <a href={getExplorerTxUrl("solana", sig)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "#9CC8FF" }}>
            <ExternalLink size={16} /> View transaction
          </a>
          <button type="button" onClick={onClose} style={{ ...BTN_SECONDARY, flex: "none", width: "100%", marginTop: "auto" }}>Done</button>
        </div>
      )}
    </WalletModal>
  );
}
