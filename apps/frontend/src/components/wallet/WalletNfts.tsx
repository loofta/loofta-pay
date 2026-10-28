"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useWalletNfts, type WalletNft } from "@/hooks/useWalletNfts";
import { WalletNftSendModal } from "@/components/wallet/WalletNftSendModal";
import { WalletModal } from "@/components/wallet/WalletModal";
import { BTN_PRIMARY, BTN_SECONDARY, shortAddress } from "@/components/wallet/walletStyles";

const SORA = "var(--font-home-sora), Sora, sans-serif";
const MONO = "var(--font-home-mono), ui-monospace, monospace";

function NftImage({ nft, radius }: { nft: WalletNft; radius: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div style={{ width: "100%", aspectRatio: "1", borderRadius: radius, background: "#22222A", display: "grid", placeItems: "center", color: "#5D5B66", fontWeight: 800, fontSize: 18, fontFamily: SORA }}>
        NFT
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={nft.image} alt={nft.name} loading="lazy" onError={() => setFailed(true)} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: radius, background: "#22222A", display: "block" }} />
  );
}

function NftDetail({ nft, onClose, onSend }: { nft: WalletNft | null; onClose: () => void; onSend: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!nft) return;
    try {
      await navigator.clipboard.writeText(nft.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <WalletModal open={nft != null} onClose={onClose} title={nft?.name ?? "NFT"}>
      {nft && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <NftImage nft={nft} radius={24} />
          {nft.description && <span style={{ fontSize: 15, lineHeight: 1.5, color: "#9A98A3" }}>{nft.description}</span>}
          {nft.attributes.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {nft.attributes.map((a) => (
                <div key={`${a.trait}:${a.value}`} style={{ padding: "10px 12px", borderRadius: 14, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: "#77757F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.trait}</span>
                  <span style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.value}</span>
                </div>
              ))}
            </div>
          )}
          {nft.sendable ? (
            <button type="button" onClick={onSend} style={{ ...BTN_PRIMARY, flex: "none", width: "100%" }}>Send</button>
          ) : (
            <span style={{ fontSize: 13, color: "#77757F", lineHeight: 1.45, textAlign: "center" }}>Sending is available for standard NFTs. This one uses a type we can't move from here yet.</span>
          )}
          <button type="button" onClick={copy} aria-label="Copy NFT address" style={{ cursor: "pointer", alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 999, border: 0, background: "#1A1A20", color: "#C9C6CF" }}>
            <span style={{ fontFamily: MONO, fontSize: 15 }}>{shortAddress(nft.id)}</span>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <a href={`https://solscan.io/token/${nft.id}`} target="_blank" rel="noopener noreferrer" style={{ ...BTN_SECONDARY, flex: "none", width: "100%", boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, textDecoration: "none" }}>
            View on Solscan <ExternalLink size={16} />
          </a>
        </div>
      )}
    </WalletModal>
  );
}

/** Grid of the NFTs held by the Loofta Solana wallet; tap one for its details. */
export function WalletNfts({ enabled, solanaAddress }: { enabled: boolean; solanaAddress: string | null }) {
  const { data, isLoading, isError, refetch } = useWalletNfts();
  const [selected, setSelected] = useState<WalletNft | null>(null);
  const [sending, setSending] = useState<WalletNft | null>(null);
  const nfts = data ?? [];

  return (
    <>
      {enabled && isLoading && <span style={{ fontSize: 14, color: "#77757F", padding: "0 8px" }}>Loading your NFTs…</span>}
      {enabled && isError && <span style={{ fontSize: 14, color: "#77757F", padding: "0 8px" }}>Could not load your NFTs. Try again in a moment.</span>}
      {enabled && !isLoading && !isError && nfts.length === 0 && <span style={{ fontSize: 14, color: "#77757F", padding: "0 8px 6px" }}>No NFTs yet. Send one to your Solana address and it shows up here.</span>}
      {nfts.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          {nfts.map((n) => (
            <button key={n.id} type="button" onClick={() => setSelected(n)} style={{ cursor: "pointer", textAlign: "left", padding: 8, borderRadius: 20, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.05)", color: "#F2EFE8", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <NftImage nft={n} radius={14} />
              <span style={{ fontWeight: 700, fontSize: 15, padding: "0 4px 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
            </button>
          ))}
        </div>
      )}
      <NftDetail nft={sending ? null : selected} onClose={() => setSelected(null)} onSend={() => setSending(selected)} />
      <WalletNftSendModal nft={sending} solanaAddress={solanaAddress} onClose={() => { setSending(null); setSelected(null); }} onDone={() => void refetch()} />
    </>
  );
}
