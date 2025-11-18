"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { fetchRemoteHistory, getLocalHistory, SwapHistoryItem } from "@/lib/history";

export default function HistoryPage() {
	const { authenticated, userId } = useAuth();
	const [items, setItems] = useState<SwapHistoryItem[]>([]);

	useEffect(() => {
		let cancelled = false;
		async function run() {
			const local = getLocalHistory();
			let combined = local;
			if (authenticated && userId) {
				try {
					const remote = await fetchRemoteHistory(userId);
					combined = [...remote, ...local.filter(l => !remote.find(r => r.id === l.id))];
				} catch {}
			}
			if (!cancelled) setItems(combined.sort((a,b) => b.createdAt - a.createdAt));
		}
		run();
		return () => { cancelled = true; };
	}, [authenticated, userId]);

	return (
		<div className="max-w-3xl mx-auto px-4 py-8">
			<h1 className="text-2xl font-bold text-gray-900 mb-4">Your swaps</h1>
			<div className="space-y-2">
				{items.length === 0 ? (
					<div className="text-sm text-gray-600">No history yet.</div>
				) : items.map((it) => (
					<div key={it.id} className="rounded-xl border border-gray-200 bg-white p-3">
						<div className="text-sm text-gray-900 font-semibold">{it.fromSymbol} → {it.toSymbol} ({it.status})</div>
						<div className="text-xs text-gray-600">Deposit: {it.id}</div>
						{it.quoteId ? <div className="text-xs text-gray-600">Quote ID: {it.quoteId}</div> : null}
						{it.deadline ? <div className="text-xs text-gray-600">Deadline: {new Date(it.deadline).toLocaleString()}</div> : null}
					</div>
				))}
			</div>
		</div>
	);
}
