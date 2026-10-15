"use client";

import { useEffect, useRef } from "react";
import { usePrivy, useWallets as useEvmWallets, useSendTransaction as useEvmSendTransaction } from "@privy-io/react-auth";
import { getPlatform, recordPlatformWithdraw } from "@/lib/peerPlatforms";
import { cashoutDepositAtomic } from "@/services/peerCash";

const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const LOG = "[peer-resume]";
const PEER_SESSION_KEY = "loofta_peer_session";
const MAX_ATTEMPTS_PER_SESSION = 2;
const BRIDGE_POLL_MS = 5000;
const BRIDGE_MAX_WAIT_MS = 5 * 60_000;

/** Ids being resumed in this tab, so a re-render or a second mount can never sign twice. */
const inFlight = new Set<string>();

type PendingRecord = {
  id: string;
  status: string;
  platform: string;
  platform_identifier: string;
  currency: string;
  amount_usdc: string;
  zkp2p_deposit_id: string | null;
  near_intents_memo?: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A pay or cash out to a Venmo / Cash App / Revolut handle finishes by signing the Peer deposit on Base
 * from the user's own Privy wallet. That used to run only inside the open balance modal, so a closed tab
 * after the bridge stranded the money on Base. Privy signs without a prompt, so this finishes the job
 * on its own the next time the user is in the app. If anything fails it hands over to the modal's
 * manual retry instead of looping.
 */
export function useResumePeerCashout(authenticated: boolean, onNeedsManualRetry?: () => void) {
  const { getAccessToken, user } = usePrivy();
  const { wallets: evmWallets } = useEvmWallets();
  const { sendTransaction: privySendEvmTx } = useEvmSendTransaction();
  const walletsRef = useRef(evmWallets);
  const sendRef = useRef(privySendEvmTx);
  const tokenRef = useRef(getAccessToken);
  const failRef = useRef(onNeedsManualRetry);
  useEffect(() => { walletsRef.current = evmWallets; }, [evmWallets]);
  useEffect(() => { tokenRef.current = getAccessToken; }, [getAccessToken]);
  useEffect(() => { failRef.current = onNeedsManualRetry; }, [onNeedsManualRetry]);
  useEffect(() => { sendRef.current = privySendEvmTx; }, [privySendEvmTx]);

  const hasPrivyEvmWallet = evmWallets.some((w) => w.walletClientType === "privy" && typeof (w as any).getEthereumProvider === "function");
  const userId = user?.id;

  useEffect(() => {
    if (!authenticated || !userId || !hasPrivyEvmWallet) return;
    // No cancel flag on purpose: once signing starts it must run to the end even if a re-render
    // re-runs this effect. inFlight stops a second copy from starting.
    const openModalForManualRetry = () => {
      if (failRef.current) { failRef.current(); return; }
      window.dispatchEvent(new CustomEvent("openBalanceModal", { detail: { tab: "withdraw", method: "peer" } }));
    };

    const authedFetch = async (path: string, init?: RequestInit) => {
      const token = await tokenRef.current();
      return fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
    };

    const run = async () => {
      const res = await authedFetch("/api/offramp");
      if (!res.ok) return;
      const record = await res.json() as PendingRecord | null;
      if (!record?.id || record.status !== "BRIDGING" || record.zkp2p_deposit_id) return;

      let isRelay = false;
      try { isRelay = JSON.parse(record.near_intents_memo ?? "{}")?.bridge === "relay"; } catch { /* not JSON */ }
      if (!isRelay || inFlight.has(record.id)) return;

      const attemptsKey = `loofta_peer_resume_${record.id}`;
      const attempts = Number(sessionStorage.getItem(attemptsKey) ?? "0");
      if (attempts >= MAX_ATTEMPTS_PER_SESSION) return;
      sessionStorage.setItem(attemptsKey, String(attempts + 1));

      const platform = getPlatform(record.platform);
      if (!platform) return;

      inFlight.add(record.id);
      try {
        // 1. Wait for Relay to confirm the bridge landed on Base.
        const deadline = Date.now() + BRIDGE_MAX_WAIT_MS;
        for (;;) {
          const r = await authedFetch(`/api/offramp/${record.id}?action=relay-status`);
          const s = String((await r.json().catch(() => ({})) as { status?: string }).status ?? "PENDING").toUpperCase();
          if (s === "SUCCESS") break;
          if (s === "FAILED") { console.warn(LOG, "bridge failed, leaving to manual"); openModalForManualRetry(); return; }
          if (Date.now() > deadline) return;
          await sleep(BRIDGE_POLL_MS);
        }

        // 2. The bridge pays the user's Base wallet. Pick whichever of their Privy wallets holds the
        //    deposit amount, and wait for it: Relay can report done before Base shows the USDC.
        const { base } = await import("viem/chains");
        const { createPublicClient, createWalletClient, custom, http, erc20Abi } = await import("viem");
        const grossAtomic = BigInt(Math.round(Number(record.amount_usdc) * 1_000_000));
        const depositAtomic = cashoutDepositAtomic(grossAtomic);
        const pub = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
        let evmWallet: any = null;
        for (let i = 0; i < 15 && !evmWallet; i++) {
          const candidates = walletsRef.current.filter((w) => w.walletClientType === "privy" && typeof (w as any).getEthereumProvider === "function");
          for (const w of candidates) {
            const bal = await pub.readContract({ address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [w.address as `0x${string}`] }) as bigint;
            if (bal >= depositAtomic) { evmWallet = w; break; }
          }
          if (!evmWallet) await sleep(4000);
        }
        // Nothing to deposit means it is spent already, or never landed. Don't guess, hand over.
        if (!evmWallet) { console.warn(LOG, "no wallet holds the deposit amount"); openModalForManualRetry(); return; }
        const baseWallet = evmWallet.address as `0x${string}`;

        // 3. Claim the saved modal session for this row so the modal can't also sign it on reload.
        try {
          const saved = JSON.parse(localStorage.getItem(PEER_SESSION_KEY) ?? "null");
          if (saved?.peerOfframpId === record.id) localStorage.removeItem(PEER_SESSION_KEY);
        } catch { /* unreadable, ignore */ }

        // Same sponsorship gate the modal uses. Fails open on network errors.
        try {
          const gate = await authedFetch("/api/payments/sponsor-check", { method: "POST", body: JSON.stringify({ walletAddress: baseWallet }) });
          if (gate.status === 429 || gate.status === 403) throw new Error("sponsorship limit reached");
        } catch (err) {
          if (err instanceof Error && err.message.includes("limit")) throw err;
        }

        const rawProvider = await evmWallet.getEthereumProvider();
        const transport = custom({
          async request({ method, params }: { method: string; params: any[] }) {
            if (method === "eth_chainId") return "0x2105";
            if (method === "eth_sendTransaction") {
              const tx = params[0];
              const result = await sendRef.current(
                { to: tx.to, data: tx.data, ...(tx.value ? { value: BigInt(tx.value) } : {}), chainId: base.id },
                { sponsor: true },
              );
              return result.hash;
            }
            return rawProvider.request({ method, params });
          },
        });
        const signer = createWalletClient({ chain: base, transport, account: baseWallet });

        // 4. Create the Peer deposit. One gas top-up and retry, like the modal does.
        const { peerCashout } = await import("@/services/peerCash");
        const makeDeposit = () => peerCashout({
          amountAtomicUsdc: depositAtomic,
          grossAtomicUsdc: grossAtomic,
          platform: platform.processorName,
          currency: record.currency,
          payee: record.platform_identifier.trim().replace(/^[@$]/, ""),
          signer: signer as any,
          exactFill: false,
        });
        let created;
        try {
          created = await makeDeposit();
        } catch (err) {
          const partial = (err as { cashout?: Awaited<ReturnType<typeof makeDeposit>> })?.cashout;
          const msg = err instanceof Error ? err.message : String(err);
          if (partial) {
            // Deposit exists on-chain, only the follow-up pricing step failed. Record it, never redo it.
            console.warn(LOG, "deposit created but pricing step failed:", msg);
            created = partial;
          } else if (msg.includes("insufficient funds for gas") || msg.includes("exceeds the balance of the account")) {
            await authedFetch(`/api/offramp/${record.id}?action=fund-gas`, { method: "POST", body: JSON.stringify({ baseWalletAddress: baseWallet }) }).catch(() => null);
            await sleep(8000);
            created = await makeDeposit();
          } else {
            throw err;
          }
        }

        // 5. Record it so the row leaves BRIDGING and the status cron takes over.
        const recorded = await authedFetch(`/api/offramp/${record.id}?action=record-deposit`, {
          method: "POST",
          body: JSON.stringify({ depositId: created.depositId, txHash: created.txHash, accessPolicyTxHash: created.accessPolicyTxHash ?? null, etaSeconds: null, etaLabel: null }),
        });
        if (!recorded.ok) console.error(LOG, "deposit created on-chain but record-deposit failed", created.depositId, recorded.status);
        recordPlatformWithdraw(platform.id);
        console.log(LOG, "resumed", record.id, created.depositId);
      } catch (err) {
        console.error(LOG, "resume failed", err);
        openModalForManualRetry();
      } finally {
        inFlight.delete(record.id);
      }
    };

    run().catch((err) => console.warn(LOG, err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, userId, hasPrivyEvmWallet, getAccessToken]);
}
