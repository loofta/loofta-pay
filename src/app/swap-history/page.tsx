"use client";

import { useState, useMemo } from "react";
import { useExplorerSwaps } from "@/hooks/useExplorerSwaps";
import { Button } from "@/components/ui/button";

export default function SwapHistoryPage() {
	const [page, setPage] = useState<number>(1);
	const [pageSize, setPageSize] = useState<number>(25);
	const [status, setStatus] = useState<string>("");
	const [symbolIn, setSymbolIn] = useState<string>("");
	const [symbolOut, setSymbolOut] = useState<string>("");

	const { data, isFetching, error, refetch } = useExplorerSwaps({
		referral: "looftaswap",
		page,
		pageSize,
		status,
		symbolIn,
		symbolOut,
	});

	const rows = useMemo(() => {
		const list = (data?.data || data?.transactions || data?.items || []) as any[];
		return Array.isArray(list) ? list : [];
	}, [data]);
	const totalPages = Number((data?.totalPages ?? data?.pages ?? 0) || 0);

	return (
		<div className="max-w-6xl mx-auto px-4 py-6">
			<h1 className="text-2xl font-bold text-gray-900 mb-4">Swap History (looftaswap)</h1>
			<div className="rounded-xl border border-gray-200 bg-white p-3 mb-3">
				<div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
					<div>
						<label className="text-xs text-gray-600">Status</label>
						<select className="w-full border rounded-md px-2 py-1" value={status} onChange={(e) => setStatus(e.target.value)}>
							<option value="">All</option>
							<option value="SUCCESS">SUCCESS</option>
							<option value="REFUNDED">REFUNDED</option>
							<option value="FAILED">FAILED</option>
							<option value="PENDING_DEPOSIT">PENDING_DEPOSIT</option>
						</select>
					</div>
					<div>
						<label className="text-xs text-gray-600">Symbol In</label>
						<input className="w-full border rounded-md px-2 py-1" placeholder="e.g. USDT" value={symbolIn} onChange={(e) => setSymbolIn(e.target.value)} />
					</div>
					<div>
						<label className="text-xs text-gray-600">Symbol Out</label>
						<input className="w-full border rounded-md px-2 py-1" placeholder="e.g. ETH" value={symbolOut} onChange={(e) => setSymbolOut(e.target.value)} />
					</div>
					<div>
						<label className="text-xs text-gray-600">Page size</label>
						<input className="w-full border rounded-md px-2 py-1" type="number" min={1} max={100} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value || 25))} />
					</div>
					<div className="flex gap-2">
						<Button variant="outline" onClick={() => { setPage(1); refetch(); }}>Apply</Button>
					</div>
				</div>
			</div>

			<div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-gray-50 text-gray-600">
						<tr>
							<th className="text-left px-3 py-2">Time</th>
							<th className="text-left px-3 py-2">Status</th>
							<th className="text-left px-3 py-2">From</th>
							<th className="text-left px-3 py-2">To</th>
							<th className="text-left px-3 py-2">Amount In</th>
							<th className="text-left px-3 py-2">Amount Out</th>
							<th className="text-left px-3 py-2">Deposit</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((r: any) => (
							<tr key={r.id || r.depositAddress} className="border-t">
								<td className="px-3 py-2 text-gray-800">{r.createdAt ? new Date(r.createdAt).toLocaleString() : (r.timestamp ? new Date(r.timestamp).toLocaleString() : "")}</td>
								<td className="px-3 py-2">{r.status}</td>
								<td className="px-3 py-2">{r.originSymbol || r.originAsset}</td>
								<td className="px-3 py-2">{r.destinationSymbol || r.destinationAsset}</td>
								<td className="px-3 py-2">{r.amountInFormatted || r.amountIn}</td>
								<td className="px-3 py-2">{r.amountOutFormatted || r.amountOut}</td>
								<td className="px-3 py-2">
									{r.depositAddress ? (
										<a className="underline text-gray-700" href={`https://explorer.near-intents.org/transactions/${r.depositAddress}`} target="_blank" rel="noreferrer">{short(r.depositAddress)}</a>
									) : null}
								</td>
							</tr>
						))}
						{rows.length === 0 ? (
							<tr><td className="px-3 py-6 text-center text-gray-600" colSpan={7}>{isFetching ? "Loading…" : error ? error.message : "No swaps found"}</td></tr>
						) : null}
					</tbody>
				</table>
			</div>

			<div className="flex items-center justify-between mt-3">
				<Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
				<div className="text-sm text-gray-600">Page {page}{totalPages ? ` of ${totalPages}` : ""}</div>
				<Button variant="outline" disabled={totalPages ? page >= totalPages : false} onClick={() => setPage((p) => p + 1)}>Next</Button>
			</div>
		</div>
	);
}

function short(v?: string) {
	if (!v) return "";
	return v.length > 12 ? `${v.slice(0, 6)}...${v.slice(-4)}` : v;
}
