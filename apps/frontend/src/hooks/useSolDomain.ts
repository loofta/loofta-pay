"use client";

import { useEffect, useRef, useState } from "react";
import { Connection } from "@solana/web3.js";
import { resolve } from "@bonfida/spl-name-service";
import { getRpcForMode, type NetworkMode } from "@/lib/solanaRpc";
import { isSolDomain } from "@/lib/refundAddresses";

export type SolDomainState =
  | { status: "idle"; address: null }
  | { status: "resolving"; address: null }
  | { status: "resolved"; address: string }
  | { status: "not-found"; address: null }
  | { status: "error"; address: null };

const IDLE: SolDomainState = { status: "idle", address: null };

/**
 * Resolves a Solana Name Service domain (`vitalik.sol`) to the wallet it points at.
 *
 * Returns `idle` for anything that isn't domain-shaped, so a caller can pass whatever the user is
 * typing straight in and treat a resolved address as "use this instead of the raw input". Debounced
 * because it runs per keystroke and each attempt is an RPC round-trip.
 *
 * SNS lives on mainnet only — there is no devnet registry — so devnet resolves nothing rather than
 * quietly returning a mainnet wallet for a devnet transfer.
 */
export function useSolDomain(input: string, networkMode: NetworkMode): SolDomainState {
  const [state, setState] = useState<SolDomainState>(IDLE);
  // Guards against a slow lookup for an earlier keystroke resolving after a later one and
  // overwriting it with a stale address — which on a withdrawal form means sending to the wrong
  // wallet, so it matters more here than the usual out-of-order-render case.
  const requestRef = useRef(0);

  useEffect(() => {
    const domain = (input || "").trim().toLowerCase();
    const requestId = ++requestRef.current;

    if (!isSolDomain(domain) || networkMode !== "mainnet") {
      setState(IDLE);
      return;
    }

    setState({ status: "resolving", address: null });
    const timer = setTimeout(async () => {
      try {
        const conn = new Connection(getRpcForMode("mainnet"), "confirmed");
        const owner = await resolve(conn, domain);
        if (requestRef.current !== requestId) return;
        setState({ status: "resolved", address: owner.toBase58() });
      } catch (e) {
        if (requestRef.current !== requestId) return;
        // The library distinguishes "no such domain" from transport/parse failures; only the
        // former means the user typed something wrong, so don't blame them for an RPC blip.
        const type = (e as { type?: string })?.type;
        setState(
          type === "DomainDoesNotExist" || type === "AccountDoesNotExist"
            ? { status: "not-found", address: null }
            : { status: "error", address: null },
        );
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [input, networkMode]);

  return state;
}
