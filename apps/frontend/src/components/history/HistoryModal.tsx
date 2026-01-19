"use client";

import { useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { getLocalHistory, type SwapHistoryItem, upsertLocal } from "@/lib/history";
import { Button } from "@/components/ui/button";
import { getExecutionStatus } from "@/services/nearIntents";
import { useHistoryQuery } from "@/hooks/useHistoryQuery";

function statusColor(s?: string) {
	const k = String(s || "").toUpperCase();
	if (k === "SUCCESS") return "bg-green-100 text-green-800 border-green-200";
	if (k === "REFUNDED" || k === "FAILED" || k === "CANCELLED") return "bg-red-100 text-red-800 border-red-200";
	if (k === "PROCESSING" || k === "KNOWN_DEPOSIT_TX") return "bg-blue-100 text-blue-800 border-blue-200";
	return "bg-amber-100 text-amber-800 border-amber-200"; // pending/incomplete
}

export function HistoryModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
	const { authenticated } = useAuth();
	const { data: items = [], isFetching, refetch } = useHistoryQuery();
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
				return merged;
			} catch {
				return it;
			}
		}));
		const updated = results.map((r, i) => r.status === "fulfilled" ? r.value as SwapHistoryItem : list[i]);
		refreshingRef.current = false;
	}

	useEffect(() => {
		if (!open) return;
		refreshStatuses(items);
		clearInterval(intervalRef.current);
		intervalRef.current = setInterval(() => {
			refreshStatuses(getLocalHistory());
		}, 10000);
		return () => { clearInterval(intervalRef.current); };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Your swaps</DialogTitle>
				</DialogHeader>
				<div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-sm px-3 py-2">
					History is stored locally on this device.
				</div>
				<div className="flex items-center justify-between mb-3">
					<div className="text-xs text-gray-600">Auto-refreshing every 10s</div>
					<Button variant="outline" size="sm" onClick={() => refetch()}>Refresh</Button>
				</div>
				<div className="space-y-2 max-h-[60vh] overflow-auto">
					{isFetching && items.length === 0 ? (
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
