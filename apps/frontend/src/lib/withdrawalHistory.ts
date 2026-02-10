"use client";

export type WithdrawalHistoryItem = {
  id: string; // tx signature (unique per withdrawal)
  createdAt: number;
  amountUSDC: number;
  txSignature: string;
  destinationAddress: string;
  destinationChain: string;
  destinationToken: string;
  isNearIntents: boolean;
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
  const entry: WithdrawalHistoryItem = {
    ...item,
    createdAt: Date.now(),
  };
  // Prepend; avoid duplicate by id (tx signature)
  const filtered = list.filter((x) => x.id !== entry.id);
  filtered.unshift(entry);
  saveWithdrawalHistory(filtered);
}
