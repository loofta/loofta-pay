"use client";

/**
 * Thin wrapper around @solana/wallet-adapter-react(-ui), the standard Solana wallet connect
 * widget (Phantom/Solflare/Backpack/etc., with a built-in disconnect option). Scoped locally
 * around whichever feature needs "connect your own wallet and sign" rather than wrapping the
 * whole app, since only a couple of flows need it and the rest of the app manages wallets
 * entirely through Privy.
 */

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import "@solana/wallet-adapter-react-ui/styles.css";

export { useWallet } from "@solana/wallet-adapter-react";
export { useWalletModal } from "@solana/wallet-adapter-react-ui";

export function SolanaWalletConnectProvider({ rpcUrl, children }: { rpcUrl: string; children: ReactNode }) {
  // Phantom + Solflare are listed explicitly so they always show in the picker (with an "install"
  // link if not present) instead of only appearing when already installed and self-registered.
  // Any OTHER Wallet Standard wallet (Backpack, etc.) is still auto-detected on top of this.
  // @solana/wallet-adapter-react dedupes by name, so an installed Phantom/Solflare that
  // self-registers via the Wallet Standard silently replaces these two, no duplicate entries.
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={rpcUrl}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
