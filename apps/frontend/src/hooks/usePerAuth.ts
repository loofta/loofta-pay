"use client";

import { useCallback, useMemo, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallets, useSignMessage } from "@privy-io/react-auth/solana";
import { EPHEMERAL_RPC_URL } from "@/lib/per/constants";
import { getPhantomProvider } from "@/lib/per/phantomProvider";
import { fetchMagicblockAuthToken } from "@/lib/per/magicblockAuth";

export type EnsureAuthTokenResult = { token: string; baseUrl: string };

/**
 * MagicBlock TEE auth token for `Connection(\`\${baseUrl}?token=\${token}\`)`.
 * Injected Phantom uses Phantom `signMessage`; Loofta embedded uses Privy (must match pubkey).
 * `baseUrl` is whichever MagicBlock host succeeded (may differ from EPHEMERAL_RPC_URL when using fallbacks).
 */
export function usePerAuth() {
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [ephemeralBaseUrl, setEphemeralBaseUrl] = useState<string | null>(null);

  const ensureAuthToken = useCallback(async (forPublicKey: PublicKey): Promise<EnsureAuthTokenResult> => {
    if (!forPublicKey) throw new Error("Connect a Solana wallet first.");

    const phantom = getPhantomProvider();
    if (phantom?.publicKey && phantom.publicKey.equals(forPublicKey)) {
      const sm = async (message: Uint8Array) => {
        const { signature } = await phantom.signMessage(message);
        return signature instanceof Uint8Array ? signature : new Uint8Array(signature);
      };
      const { token, baseUrl } = await fetchMagicblockAuthToken(forPublicKey, sm);
      setAuthToken(token);
      setEphemeralBaseUrl(baseUrl);
      return { token, baseUrl };
    }

    if (!signMessage) throw new Error("Wallet cannot sign messages.");
    const w =
      wallets.find((x) => (x as { address?: string }).address === forPublicKey.toBase58()) ??
      wallets[0];
    if (!w) throw new Error("No Solana wallet available.");
    const sm = async (message: Uint8Array) => {
      const { signature } = await signMessage({ message, wallet: w });
      return signature instanceof Uint8Array ? signature : new Uint8Array(signature);
    };
    const { token, baseUrl } = await fetchMagicblockAuthToken(forPublicKey, sm);
    setAuthToken(token);
    setEphemeralBaseUrl(baseUrl);
    return { token, baseUrl };
  }, [signMessage, wallets]);

  const ephemeralConnection = useMemo(() => {
    const base = ephemeralBaseUrl ?? EPHEMERAL_RPC_URL.replace(/\/$/, "");
    if (!authToken) return null;
    return new Connection(`${base}?token=${authToken}`, "confirmed");
  }, [authToken, ephemeralBaseUrl]);

  return { authToken, ephemeralBaseUrl, ephemeralConnection, ensureAuthToken };
}
