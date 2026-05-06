"use client";

export type WithdrawalHistoryItem = {
  id: string;
  createdAt: number;
  amountUSDC: number;
  txSignature: string;
  destinationAddress: string;
  destinationChain: string;
  destinationToken: string;
  isNearIntents: boolean;
  depositAddress?: string;       // Near Intents relay address for status polling
  estimatedOut?: string;         // Estimated output amount (human-readable)
  nearIntentsStatus?: string;    // Latest status from 1Click API
  nearIntentsComplete?: boolean; // True once bridge confirms SUCCESS/REFUNDED
};

const STORAGE_KEY = "loofta.withdrawal.history.v1";

export function getWithdrawalHistory(): WithdrawalHistoryItem[] {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return [];
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveWithdrawalHistory(items: WithdrawalHistoryItem[]) {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // private mode, quota, etc.
  }
}

export function addWithdrawal(item: Omit<WithdrawalHistoryItem, "createdAt">) {
  const list = getWithdrawalHistory();
  const entry: WithdrawalHistoryItem = { ...item, createdAt: Date.now() };
  const filtered = list.filter((x) => x.id !== entry.id);
  filtered.unshift(entry);
  saveWithdrawalHistory(filtered);
  return entry;
}

export function updateWithdrawalStatus(id: string, status: string, complete: boolean) {
  const list = getWithdrawalHistory();
  const idx = list.findIndex((x) => x.id === id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], nearIntentsStatus: status, nearIntentsComplete: complete };
    saveWithdrawalHistory(list);
  }
}
