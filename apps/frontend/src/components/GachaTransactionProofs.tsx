"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";

export interface GachaTransactionProof {
  label: string;
  signature: string | null | undefined;
}

export function gachaSolscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}

function shortSignature(signature: string): string {
  return signature.length > 20
    ? `${signature.slice(0, 8)}…${signature.slice(-8)}`
    : signature;
}

/** Persistent, user-opened audit trail for every stored on-chain transaction in a Gacha room. */
export default function GachaTransactionProofs({ proofs }: { proofs: GachaTransactionProof[] }) {
  const available = proofs.filter(
    (proof): proof is { label: string; signature: string } =>
      typeof proof.signature === "string" && proof.signature.length > 0,
  );
  if (available.length === 0) return null;

  return (
    <details className="group fixed bottom-4 left-4 z-40 w-[calc(100%-2rem)] max-w-sm rounded-xl border border-border bg-card text-card-foreground shadow-xl">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        On-chain proof
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
          {available.length}
        </span>
      </summary>
      <div className="border-t border-border px-3 py-2">
        {available.map((proof) => (
          <div key={`${proof.label}-${proof.signature}`} className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{proof.label}</p>
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={proof.signature}>
                {shortSignature(proof.signature)}
              </p>
            </div>
            <a
              href={gachaSolscanTxUrl(proof.signature)}
              target="_blank"
              rel="noreferrer"
              aria-label={`View ${proof.label} transaction on Solscan`}
              className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Solscan <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        ))}
      </div>
    </details>
  );
}
