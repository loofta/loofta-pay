"use client";

import { useState, useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignTransaction } from "@privy-io/react-auth/solana";
import { useAuthStore } from "@/store/auth";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";
import { getPrivySolanaChainForMode, MAINNET_USDC_MINT, DEVNET_USDC_MINT } from "@/lib/solanaRpc";
export type AtaMigrationStatus = "idle" | "migrating" | "done" | "error";
type NetworkMode = "mainnet" | "devnet";

function migrationKey(userId: string, network: NetworkMode) {
  return `loofta_ata_migrated_${network}_${userId}`;
}

function isMigrationDone(userId: string, network: NetworkMode): boolean {
  try { return !!localStorage.getItem(migrationKey(userId, network)); } catch { return false; }
}

function setMigrationDone(userId: string, network: NetworkMode) {
  try { localStorage.setItem(migrationKey(userId, network), "1"); } catch { /* */ }
}

export function useAtaMigration() {
  const { authenticated, user, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { signTransaction: privySolanaSignTransaction } = useSignTransaction() as any;
  const networkMode = useAuthStore((s) => s.networkMode);
  const ataMigratedMainnet = useAuthStore((s) => s.ataMigratedMainnet);
  const ataMigratedDevnet = useAuthStore((s) => s.ataMigratedDevnet);
  const setAtaMigrated = useAuthStore((s) => s.setAtaMigrated);
  const [status, setStatus] = useState<AtaMigrationStatus>("idle");
  const runningRef = useRef(false);
  const lastRunKey = useRef("");

  const walletAddress = deriveSolanaEmbeddedAddress(user);
  const wallet = wallets.find((w) => w.address === walletAddress) ?? wallets[0];
  const userId = user?.id;

  // Which DB flag corresponds to the current network
  const dbMigrated = networkMode === "mainnet" ? ataMigratedMainnet : ataMigratedDevnet;

  useEffect(() => {
    if (!authenticated || !userId || !walletAddress || !wallet) return;

    // Fast path: localStorage cache from a previous run on this device
    if (isMigrationDone(userId, networkMode)) return;

    // DB state not yet loaded by UserSync — wait
    if (dbMigrated === null) return;

    // DB says already migrated — backfill localStorage and stop
    if (dbMigrated === true) {
      setMigrationDone(userId, networkMode);
      return;
    }

    const runKey = `${userId}:${networkMode}`;
    if (runningRef.current || lastRunKey.current === runKey) return;

    runningRef.current = true;
    lastRunKey.current = runKey;

    const mint = networkMode === "mainnet" ? MAINNET_USDC_MINT : DEVNET_USDC_MINT;
    const chain = getPrivySolanaChainForMode(networkMode);

    const markDone = async (token: string | null) => {
      setMigrationDone(userId, networkMode);
      setAtaMigrated(networkMode, true);
      const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      await fetch("/api/users/set-ata-migrated", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ privyUserId: userId, network: networkMode }),
      }).catch(() => { /* non-fatal */ });
    };

    (async () => {
      try {
        const token = await getAccessToken();
        const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

        // Ask MagicBlock to build an undelegate transaction for this wallet.
        // If the ATA is not delegated, MagicBlock returns a non-2xx — mark done silently.
        const undelegateRes = await fetch("/api/payments/undelegate-ephemeral-ata", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ payer: walletAddress, mint, cluster: networkMode }),
        });

        if (!undelegateRes.ok) {
          await markDone(token);
          return;
        }

        const undelegateBody = await undelegateRes.json().catch(() => null);
        if (!undelegateBody?.transactionBase64) {
          await markDone(token);
          return;
        }

        // An active delegation was found — show the banner and fix it silently.
        setStatus("migrating");

        const { transactionBase64, sendTo, sendRpcEndpoint } = undelegateBody as {
          transactionBase64: string;
          sendTo: "base" | "ephemeral";
          sendRpcEndpoint?: string;
        };

        const signedOutput = await privySolanaSignTransaction({
          transaction: Buffer.from(transactionBase64, "base64") as Uint8Array,
          wallet,
          chain,
          options: { uiOptions: { showWalletUIs: false } },
        });
        const signedBase64 = Buffer.from(signedOutput.signedTransaction as Uint8Array).toString("base64");

        const sendRes = await fetch("/api/payments/transaction/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({
            transactionBase64: signedBase64,
            sendTo,
            ...(sendRpcEndpoint ? { sendRpcEndpoint } : {}),
          }),
        });

        // Mark done regardless — don't re-run on every login even if submission failed.
        await markDone(token);
        if (sendRes.ok) {
          setStatus("done");
          setTimeout(() => setStatus("idle"), 3000);
        } else {
          setStatus("error");
          setTimeout(() => setStatus("idle"), 5000);
        }
      } catch {
        // On unexpected error, mark done to avoid showing the banner on every visit.
        await markDone(null).catch(() => { });
        setStatus("idle");
      } finally {
        runningRef.current = false;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, userId, walletAddress, wallets.length, networkMode, dbMigrated]);

  return { status };
}
