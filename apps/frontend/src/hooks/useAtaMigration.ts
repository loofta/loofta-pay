"use client";

import { useState, useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignTransaction } from "@privy-io/react-auth/solana";
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { signTransaction: privySolanaSignTransaction } = useSignTransaction() as any;
  const storeUserId = useAuthStore((s) => s.userId); // set after UserSync calls setAuth
  const ataMigratedMainnet = useAuthStore((s) => s.ataMigratedMainnet);
  const ataMigratedDevnet = useAuthStore((s) => s.ataMigratedDevnet);
  const setAtaMigrated = useAuthStore((s) => s.setAtaMigrated);
  const [status, setStatus] = useState<AtaMigrationStatus>("idle");
  const runningRef = useRef(false);
  const ranRef = useRef(false);

  const walletAddress = deriveSolanaEmbeddedAddress(user);
  const wallet = wallets.find((w) => w.address === walletAddress) ?? wallets[0];
  const userId = user?.id;

  useEffect(() => {
    if (!authenticated || !userId || !walletAddress || !wallet || !storeUserId) return;
    if (runningRef.current || ranRef.current) return;

    runningRef.current = true;

    const dbMigrated: Record<NetworkMode, boolean | null> = {
      mainnet: ataMigratedMainnet,
      devnet: ataMigratedDevnet,
    };

    const migrateNetwork = async (
      network: NetworkMode,
      token: string,
    ): Promise<void> => {
      if (isMigrationDone(userId, network)) {
        console.log(`[AtaMigration] ${network}: localStorage done`);
        return;
      }
      if (dbMigrated[network] === true) {
        console.log(`[AtaMigration] ${network}: DB done — backfilling localStorage`);
        setMigrationDone(userId, network);
        return;
      }

      const mint = network === "mainnet" ? MAINNET_USDC_MINT : DEVNET_USDC_MINT;
      const chain = getPrivySolanaChainForMode(network);
      const authHeader: HeadersInit = { Authorization: `Bearer ${token}` };

      const markDone = async () => {
        setMigrationDone(userId, network);
        setAtaMigrated(network, true);
        await fetch("/api/users/set-ata-migrated", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ privyUserId: userId, network }),
        }).catch(() => { /* non-fatal */ });
      };

      console.log(`[AtaMigration] ${network}: checking undelegate`, { payer: walletAddress, mint });
      const undelegateRes = await fetch("/api/payments/undelegate-ephemeral-ata", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ payer: walletAddress, mint, cluster: network }),
      });

      console.log(`[AtaMigration] ${network}: undelegate status`, undelegateRes.status);
      if (!undelegateRes.ok) {
        await markDone();
        return;
      }

      const body = await undelegateRes.json().catch(() => null);
      if (!body?.transactionBase64) {
        await markDone();
        return;
      }

      console.log(`[AtaMigration] ${network}: active delegation — signing`);
      setStatus("migrating");

      const signedOutput = await privySolanaSignTransaction({
        transaction: Buffer.from(body.transactionBase64, "base64") as Uint8Array,
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
          sendTo: body.sendTo,
          ...(body.sendRpcEndpoint ? { sendRpcEndpoint: body.sendRpcEndpoint } : {}),
        }),
      });

      await markDone();
      if (sendRes.ok) {
        setStatus("done");
        setTimeout(() => setStatus("idle"), 3000);
      } else {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 5000);
      }
    };

    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        // Run mainnet then devnet sequentially — each silently marks done if ATA not delegated.
        for (const network of NETWORKS) {
          await migrateNetwork(network, token);
        }
      } catch {
        setStatus("idle");
      } finally {
        runningRef.current = false;
        ranRef.current = true;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, userId, storeUserId, walletAddress, wallets.length]);

  return { status };
}
