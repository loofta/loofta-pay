"use client";

import { db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp, getDocs, collection, query, where } from "firebase/firestore";

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
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? arr : [];
	} catch {
		return [];
	}
}

export function saveLocalHistory(items: SwapHistoryItem[]) {
	try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch {}
}

export function upsertLocal(item: SwapHistoryItem) {
	const arr = getLocalHistory();
	const idx = arr.findIndex((x) => x.id === item.id);
	if (idx >= 0) arr[idx] = { ...arr[idx], ...item, updatedAt: Date.now() };
	else arr.unshift({ ...item, updatedAt: Date.now() });
	saveLocalHistory(arr);
}

export async function upsertRemote(userId: string, item: SwapHistoryItem) {
	if (!userId) return;
	const ref = doc(db, "swapHistory", `${userId}:${item.id}`);
	await setDoc(ref, { ...item, userId, updatedAt: Date.now(), updatedAtServer: serverTimestamp() }, { merge: true });
}

export async function fetchRemoteHistory(userId: string): Promise<SwapHistoryItem[]> {
	if (!userId) return [];
	const q = query(collection(db, "swapHistory"), where("userId", "==", userId));
	const snap = await getDocs(q);
	const items: SwapHistoryItem[] = [];
	snap.forEach((d) => items.push(d.data() as any));
	return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function mergeLocalIntoRemote(userId: string) {
	if (!userId) return;
	const local = getLocalHistory();
	for (const it of local) {
		await upsertRemote(userId, it);
	}
}

export function mergeRemoteIntoLocal(remote: SwapHistoryItem[]) {
	for (const it of remote) {
		upsertLocal(it);
	}
}
