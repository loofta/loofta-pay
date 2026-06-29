"use client";

import { useState, useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { useAuthStore } from "@/store/auth";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";
import { getPrivySolanaChainForMode, MAINNET_USDC_MINT, DEVNET_USDC_MINT } from "@/lib/solanaRpc";

export type AtaMigrationStatus = "idle" | "migrating" | "done" | "error";
type NetworkMode = "mainnet" | "devnet";

const NETWORKS: NetworkMode[] = ["mainnet", "devnet"];

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
  const storeUserId = useAuthStore((s) => s.userId);
  const ataMigratedMainnet = useAuthStore((s) => s.ataMigratedMainnet);
  const ataMigratedDevnet = useAuthStore((s) => s.ataMigratedDevnet);
  const setAtaMigrated = useAuthStore((s) => s.setAtaMigrated);
  const [status, setStatus] = useState<AtaMigrationStatus>("idle");
  const runningRef = useRef(false);
  const ranRef = useRef(false);

  // deriveSolanaEmbeddedAddress reads from the live Privy user object — always current, no DB staleness.
  const walletAddress = deriveSolanaEmbeddedAddress(user);
  const wallet = walletAddress ? wallets.find((w) => w.address === walletAddress) : undefined;
  const userId = user?.id;

  useEffect(() => {
    if (!authenticated || !userId || !storeUserId || !walletAddress || !wallet) return;
    if (runningRef.current || ranRef.current) return;

    runningRef.current = true;

    const dbMigrated: Record<NetworkMode, boolean | null> = {
      mainnet: ataMigratedMainnet,
      devnet: ataMigratedDevnet,
    };

    const migrateNetwork = async (network: NetworkMode, token: string): Promise<void> => {
      const authHeader: HeadersInit = { Authorization: `Bearer ${token}` };

      const saveToDb = async (undelegated: boolean) => {
        const res = await fetch("/api/users/set-ata-migrated", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ privyUserId: userId, network, walletAddress, undelegated }),
        });
        if (!res.ok) console.warn(`[AtaMigration] ${network}: set-ata-migrated failed`, res.status);
        return res.ok;
      };

      // localStorage done but DB false → just sync DB, no need to re-undelegate
      if (isMigrationDone(userId, network)) {
        if (dbMigrated[network] !== true) {
          console.log(`[AtaMigration] ${network}: localStorage done, DB out of sync — fixing`);
          await saveToDb(false);
          setAtaMigrated(network, true);
        } else {
          console.log(`[AtaMigration] ${network}: done`);
        }
        return;
      }

      if (dbMigrated[network] === true) {
        console.log(`[AtaMigration] ${network}: DB done — backfilling localStorage`);
        setMigrationDone(userId, network);
        setAtaMigrated(network, true);
        return;
      }

      const mint = network === "mainnet" ? MAINNET_USDC_MINT : DEVNET_USDC_MINT;
      const chain = getPrivySolanaChainForMode(network);

      console.log(`[AtaMigration] ${network}: checking delegation`, { payer: walletAddress, mint });

      const undelegateRes = await fetch("/api/payments/undelegate-ephemeral-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ payer: walletAddress, mint, cluster: network }),
      });

      console.log(`[AtaMigration] ${network}: status ${undelegateRes.status}`);

      if (undelegateRes.status === 404) {
        setMigrationDone(userId, network);
        setAtaMigrated(network, true);
        await saveToDb(false);
        return;
      }

      if (!undelegateRes.ok) {
        console.warn(`[AtaMigration] ${network}: error ${undelegateRes.status} — retrying next session`);
        return;
      }

      const body = await undelegateRes.json().catch(() => null);

      if (!body?.transactionBase64) {
        console.log(`[AtaMigration] ${network}: no active delegation`);
        setMigrationDone(userId, network);
        setAtaMigrated(network, true);
        await saveToDb(false);
        return;
      }

      console.log(`[AtaMigration] ${network}: signing with ${walletAddress}`);
      setStatus("migrating");

      let signedBase64: string;
      try {
        const result = await wallet.signTransaction({
          transaction: Buffer.from(body.transactionBase64, "base64") as Uint8Array,
          chain,
        });
        signedBase64 = Buffer.from(result.signedTransaction).toString("base64");
      } catch (signErr) {
        console.error(`[AtaMigration] ${network}: signing failed`, signErr);
        setStatus("error");
        setTimeout(() => setStatus("idle"), 5000);
        return;
      }

      const sendRes = await fetch("/api/payments/transaction/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          transactionBase64: signedBase64,
          sendTo: body.sendTo,
          ...(body.sendRpcEndpoint ? { sendRpcEndpoint: body.sendRpcEndpoint } : {}),
        }),
      });

      if (sendRes.ok) {
        console.log(`[AtaMigration] ${network}: ✅ undelegated ${walletAddress}`);
        setMigrationDone(userId, network);
        setAtaMigrated(network, true);
        await saveToDb(true);
        setStatus("done");
        setTimeout(() => setStatus("idle"), 3000);
      } else {
        const errText = await sendRes.text().catch(() => "");
        console.error(`[AtaMigration] ${network}: send failed ${sendRes.status}`, errText);
        setStatus("error");
        setTimeout(() => setStatus("idle"), 5000);
      }
    };

    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        for (const network of NETWORKS) {
          await migrateNetwork(network, token);
        }
      } catch (err) {
        console.error("[AtaMigration] unexpected error", err);
        setStatus("idle");
      } finally {
        runningRef.current = false;
        ranRef.current = true;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, userId, storeUserId, walletAddress, wallet?.address]);

  return { status };
}
