"use client";

import { useEffect, useState } from "react";
import { Connection } from "@solana/web3.js";
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  decodeGachaRoomState,
  deriveGachaRoomStatePda,
  type GachaRoomStateAccount,
} from "@/lib/gachaRoomState";

const DEFAULT_ROUTER_ENDPOINT = "https://devnet-router.magicblock.app";
const RETRY_MS = 3_000;

export type GachaErSubscriptionStatus =
  | "disabled"
  | "discovering"
  | "waiting-for-delegation"
  | "subscribed"
  | "retrying";

function websocketEndpoint(httpEndpoint: string): string {
  return httpEndpoint
    .replace(/^https:\/\//, "wss://")
    .replace(/^http:\/\//, "ws://");
}

/**
 * Subscribes directly to the delegated room PDA on its assigned MagicBlock validator.
 * The Magic Router is used only to discover that validator; account snapshots and websocket
 * updates come from the ER itself. Socket.IO remains available to the room page as a fallback
 * and for DB-only lifecycle events that are not represented by GachaRoomState.
 */
export function useGachaRoomStateSubscription(roomId: string | null) {
  const enabled = process.env.NEXT_PUBLIC_GACHA_ER_SUBSCRIPTION === "true";
  const [state, setState] = useState<GachaRoomStateAccount | null>(null);
  const [status, setStatus] = useState<GachaErSubscriptionStatus>(
    enabled ? "discovering" : "disabled",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !roomId) {
      setState(null);
      setStatus("disabled");
      setError(null);
      return;
    }

    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let erConnection: Connection | null = null;
    let subscriptionId: number | null = null;

    const removeSubscription = async () => {
      const connection = erConnection;
      const id = subscriptionId;
      erConnection = null;
      subscriptionId = null;
      if (connection && id !== null) {
        await connection.removeAccountChangeListener(id).catch(() => undefined);
      }
    };

    const scheduleRetry = (nextStatus: GachaErSubscriptionStatus) => {
      if (disposed) return;
      setStatus(nextStatus);
      retryTimer = setTimeout(() => void connect(), RETRY_MS);
    };

    const connect = async () => {
      if (disposed) return;
      setStatus("discovering");
      try {
        const roomPda = await deriveGachaRoomStatePda(roomId);
        if (disposed) return;

        const routerEndpoint = (
          process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL ||
          DEFAULT_ROUTER_ENDPOINT
        ).replace(/\/+$/, "");
        const router = new ConnectionMagicRouter(routerEndpoint);
        const delegation = (await router.getDelegationStatus(roomPda)) as
          | {
              isDelegated: boolean;
              fqdn?: string;
            }
          | undefined;

        if (!delegation?.isDelegated || !delegation.fqdn) {
          setState(null);
          setError(null);
          scheduleRetry("waiting-for-delegation");
          return;
        }

        const connection = new Connection(delegation.fqdn, {
          commitment: "processed",
          wsEndpoint: websocketEndpoint(delegation.fqdn),
        });
        const initial = await connection.getAccountInfo(roomPda, "processed");
        if (disposed) return;
        if (!initial) {
          scheduleRetry("waiting-for-delegation");
          return;
        }

        const initialState = decodeGachaRoomState(initial.data);
        const id = connection.onAccountChange(
          roomPda,
          (accountInfo) => {
            if (disposed || erConnection !== connection) return;
            try {
              setState(decodeGachaRoomState(accountInfo.data));
              setStatus("subscribed");
              setError(null);
            } catch (subscriptionError) {
              setError(
                subscriptionError instanceof Error
                  ? subscriptionError.message
                  : String(subscriptionError),
              );
            }
          },
          { commitment: "processed" },
        );

        if (disposed) {
          await connection
            .removeAccountChangeListener(id)
            .catch(() => undefined);
          return;
        }
        await removeSubscription();
        if (disposed) {
          await connection
            .removeAccountChangeListener(id)
            .catch(() => undefined);
          return;
        }
        erConnection = connection;
        subscriptionId = id;
        setState(initialState);
        setStatus("subscribed");
        setError(null);
      } catch (subscriptionError) {
        await removeSubscription();
        if (disposed) return;
        setError(
          subscriptionError instanceof Error
            ? subscriptionError.message
            : String(subscriptionError),
        );
        scheduleRetry("retrying");
      }
    };

    void connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      void removeSubscription();
    };
  }, [enabled, roomId]);

  return { enabled, state, status, error };
}
