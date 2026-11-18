"use client";

import { useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { clientApiBase } from "@/services/api/client";

const BACKEND = clientApiBase();

export type PartnerRole = "owner" | "admin" | "payer" | "viewer";
export const usd = (n: number | string | null | undefined) =>
  `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One authenticated call into the partner API (same-origin proxy, Privy bearer token). */
export function usePartnerApi() {
  const { getAccessToken } = usePrivy();
  return useCallback(
    async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
      const token = await getAccessToken();
      const res = await fetch(`${BACKEND}/${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
        throw new Error(msg || "Something went wrong.");
      }
      return body as T;
    },
    [getAccessToken],
  );
}

export const post = (body?: unknown): RequestInit => ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });
