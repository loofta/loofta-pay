import type { PublicKey, VersionedTransaction } from "@solana/web3.js";

/** Injected Phantom (or compatible) provider for Solana pay + PER auth. */
export type InjectedPhantomProvider = {
  connect: () => Promise<{ publicKey: PublicKey }>;
  publicKey: PublicKey | null;
  signMessage: (msg: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
};

/**
 * Returns window.solana when it supports signing txs + messages (required for PER TEE auth).
 * SSR-safe: always null on server.
 */
export function getPhantomProvider(): InjectedPhantomProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    solana?: {
      connect?: () => Promise<{ publicKey: PublicKey }>;
      publicKey: PublicKey | null;
      signMessage?: (msg: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>;
      signTransaction?: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
    };
  };
  const solana = w?.solana;
  if (!solana?.signTransaction || !solana?.signMessage) return null;
  return solana as InjectedPhantomProvider;
}
