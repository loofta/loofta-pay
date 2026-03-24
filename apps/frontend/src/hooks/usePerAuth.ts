"use client";

import { useCallback, useMemo, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallets, useSignMessage } from "@privy-io/react-auth/solana";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { EPHEMERAL_RPC_URL } from "@/lib/per/constants";

/**
 * MagicBlock TEE auth token for `Connection(\`\${EPHEMERAL_RPC_URL}?token=\${token}\`)`.
 */
export function usePerAuth() {
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const [authToken, setAuthToken] = useState<string | null>(null);

  const ensureAuthToken = useCallback(async (forPublicKey: PublicKey): Promise<string> => {
    if (!forPublicKey) throw new Error("Connect a Solana wallet first.");
    if (!signMessage) throw new Error("Wallet cannot sign messages.");
    const w =
      wallets.find((x) => (x as { address?: string }).address === forPublicKey.toBase58()) ??
      wallets[0];
    if (!w) throw new Error("No Solana wallet available.");
    const sm = async (message: Uint8Array) => {
      const { signature } = await signMessage({ message, wallet: w });
      return signature instanceof Uint8Array ? signature : new Uint8Array(signature);
    };
    const res = await getAuthToken(EPHEMERAL_RPC_URL, forPublicKey, sm);
    const tokenStr = typeof res === "string" ? res : (res as { token: string }).token;
    setAuthToken(tokenStr);
    return tokenStr;
  }, [signMessage, wallets]);

  const ephemeralConnection = useMemo(() => {
    if (!authToken) return null;
    return new Connection(`${EPHEMERAL_RPC_URL}?token=${authToken}`, "confirmed");
  }, [authToken]);

  return { authToken, ephemeralConnection, ensureAuthToken };
}
