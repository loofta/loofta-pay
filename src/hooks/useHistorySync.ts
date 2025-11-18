"use client";

import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { fetchRemoteHistory, mergeLocalIntoRemote, mergeRemoteIntoLocal } from "@/lib/history";

export function useHistorySync() {
	const { authenticated, userId } = useAuth();
	useEffect(() => {
		let cancelled = false;
		async function run() {
			if (!authenticated || !userId) return;
			await mergeLocalIntoRemote(userId);
			const remote = await fetchRemoteHistory(userId);
			if (!cancelled) mergeRemoteIntoLocal(remote);
		}
		run();
		return () => { cancelled = true; };
	}, [authenticated, userId]);
}
