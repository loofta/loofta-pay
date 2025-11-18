"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { fetchRemoteHistory, getLocalHistory, mergeRemoteIntoLocal, type SwapHistoryItem, upsertLocal, upsertRemote } from "@/lib/history";
import { Button } from "@/components/ui/button";
import { getExecutionStatus } from "@/services/nearIntents";

function statusColor(s?: string) {
	const k = String(s || "").toUpperCase();
	if (k === "SUCCESS") return "bg-green-100 text-green-800 border-green-200";
	if (k === "REFUNDED" || k === "FAILED" || k === "CANCELLED") return "bg-red-100 text-red-800 border-red-200";
	if (k === "PROCESSING" || k === "KNOWN_DEPOSIT_TX") return "bg-blue-100 text-blue-800 border-blue-200";
	return "bg-amber-100 text-amber-800 border-amber-200"; // pending/incomplete
}

export function HistoryModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
	const { authenticated, userId } = useAuth();
	const [items, setItems] = useState<SwapHistoryItem[]>([]);
	const [loading, setLoading] = useState(false);
	const intervalRef = useRef<any>(null);
	const refreshingRef = useRef<boolean>(false);

	async function refreshStatuses(list: SwapHistoryItem[]) {
		if (refreshingRef.current) return;
		refreshingRef.current = true;
		const now = Date.now();
		const results = await Promise.allSettled(list.map(async (it) => {
			const terminal = ["SUCCESS", "REFUNDED", "FAILED", "CANCELLED"].includes(String(it.status || "").toUpperCase());
			if (terminal || !it.id) return it;
			try {
				const r = await getExecutionStatus(it.id);
				const apiStatus = String(r?.status || "");
				let finalStatus = apiStatus;
				const expired = it.deadline ? new Date(it.deadline).getTime() < now : false;
				if (expired && !["SUCCESS","REFUNDED","FAILED"].includes(apiStatus)) {
					finalStatus = "CANCELLED";
				}
				const merged: SwapHistoryItem = { ...it, status: finalStatus, updatedAt: Date.now() };
				upsertLocal(merged);
				if (authenticated && userId) await upsertRemote(userId, merged);
				return merged;
			} catch {
				return it;
			}
		}));
		const updated = results.map((r, i) => r.status === "fulfilled" ? r.value as SwapHistoryItem : list[i]);
		setItems(updated.sort((a,b) => b.createdAt - a.createdAt));
		refreshingRef.current = false;
	}

	async function load() {
		setLoading(true);
		try {
			const local = getLocalHistory();
			let combined = local;
			if (authenticated && userId) {
				try {
					const remote = await fetchRemoteHistory(userId);
					mergeRemoteIntoLocal(remote);
					combined = getLocalHistory();
				} catch {}
			}
			setItems(combined.sort((a, b) => b.createdAt - a.createdAt));
			setLoading(false);
			// Kick off background status refresh without blocking UI
			refreshStatuses(combined);
		} finally {
			// no-op
		}
	}

	useEffect(() => {
		if (!open) return;
		load();
		clearInterval(intervalRef.current);
		intervalRef.current = setInterval(() => {
			const list = getLocalHistory();
			refreshStatuses(list);
		}, 10000);
		return () => { clearInterval(intervalRef.current); };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, authenticated, userId]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Your swaps</DialogTitle>
				</DialogHeader>
				{!authenticated ? (
					<div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-sm px-3 py-2">
						Log in to sync your history across devices.
					</div>
				) : null}
				<div className="flex items-center justify-between mb-3">
					<div className="text-xs text-gray-600">Auto-refreshing every 10s</div>
					<Button variant="outline" size="sm" onClick={() => load()}>Refresh</Button>
				</div>
				<div className="space-y-2 max-h-[60vh] overflow-auto">
					{loading && items.length === 0 ? (
						<div className="text-sm text-gray-600">Loading…</div>
					) : items.length === 0 ? (
						<div className="text-sm text-gray-600">No history yet.</div>
					) : items.map((it) => (
						<div key={it.id} className="rounded-xl border border-gray-200 bg-white p-3">
							<div className="flex items-center justify-between">
								<div className="text-sm text-gray-900 font-semibold">{it.fromSymbol} → {it.toSymbol}</div>
								<div className={`text-[11px] px-2 py-1 rounded-md border ${statusColor(it.status)}`}>{String(it.status || "PENDING").replaceAll("_"," ")}</div>
							</div>
							<div className="mt-1 text-xs text-gray-600 break-all">Deposit: {it.id}</div>
							{it.quoteId ? <div className="text-xs text-gray-600">Quote ID: {it.quoteId}</div> : null}
							{it.deadline ? <div className="text-xs text-gray-600">Deadline: {new Date(it.deadline).toLocaleString()}</div> : null}
						</div>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
