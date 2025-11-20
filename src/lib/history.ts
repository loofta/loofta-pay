"use client";

export type SwapHistoryItem = {
	id: string; // depositAddress
	createdAt: number;
	updatedAt: number;
	status: "PENDING" | "PENDING_DEPOSIT" | "SUCCESS" | "REFUNDED" | string;
	fromSymbol?: string;
	fromChain?: string;
	toSymbol?: string;
	toChain?: string;
	amount?: string;
	recipient?: string;
	quoteId?: string;
	deadline?: string;
	userId?: string; // privy user id
	userEmail?: string;
	ip?: string;
	country?: string;
	countryCode?: string;
};

const STORAGE_KEY = "loofta.swap.history.v1";

export function getLocalHistory(): SwapHistoryItem[] {
	try {
		const hasStorage = typeof window !== "undefined" && typeof window.localStorage !== "undefined";
		if (!hasStorage) return [];
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? arr : [];
	} catch (e) {
		// Swallow errors silently in non-browser environments
		return [];
	}
}

export function saveLocalHistory(items: SwapHistoryItem[]) {
	try {
		const hasStorage = typeof window !== "undefined" && typeof window.localStorage !== "undefined";
		if (!hasStorage) return;
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
	} catch (e) {
		// Ignore write errors (private mode, quota exceeded, SSR)
	}
}

export function upsertLocal(item: SwapHistoryItem) {
	const arr = getLocalHistory();
	const idx = arr.findIndex((x) => x.id === item.id);
	if (idx >= 0) arr[idx] = { ...arr[idx], ...item, updatedAt: Date.now() };
	else arr.unshift({ ...item, updatedAt: Date.now() });
	saveLocalHistory(arr);
}

// Remote ops disabled (Firebase removed)
export async function upsertRemote(_userId: string, _item: SwapHistoryItem) {
	return;
}

export async function fetchRemoteHistory(_userId: string): Promise<SwapHistoryItem[]> {
	return [];
}

export async function mergeLocalIntoRemote(_userId: string) {
	return;
}

export function mergeRemoteIntoLocal(_remote: SwapHistoryItem[]) {
	return;
}

export async function ensureUser(_userId?: string, _email?: string) {
	return;
}
