"use client";

import { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { useMultiSendStore } from "@/store/multiSend";

export function useAuth() {
	const { login, logout, user, ready, authenticated, getAccessToken } = usePrivy();
	const cached = useAuthStore((s) => ({ authenticated: s.authenticated, userId: s.userId, email: s.email }));
	const setAuth = useAuthStore((s) => s.setAuth);

	const privyUserId = user?.id || undefined;
	const privyEmail = user?.email?.address || undefined;

	useEffect(() => {
		if (!ready) return;
		if (!authenticated) {
			// Clear per-user UI state so it doesn't bleed into the next session
			const ms = useMultiSendStore.getState();
			ms.setShowMultiSend(false);
			ms.clear();
		}
		setAuth({ authenticated: !!authenticated, userId: privyUserId, email: privyEmail });
	}, [ready, authenticated, privyUserId, privyEmail, setAuth]);

	// Prefer cached auth while Privy initializes to avoid flicker
	const effectiveAuthenticated = ready ? !!authenticated : !!cached.authenticated;
	const effectiveUserId = ready ? privyUserId : cached.userId;
	const effectiveEmail = ready ? privyEmail : cached.email;

	return {
		ready,
		authenticated: effectiveAuthenticated,
		userId: effectiveUserId,
		email: effectiveEmail,
		login,
		logout,
		getAccessToken,
	};
}
