"use client";

import { usePrivy } from "@privy-io/react-auth";

export function useAuth() {
	const { login, logout, user, ready, authenticated } = usePrivy();
	const userId = user?.id || undefined;
	const email = user?.email?.address || undefined;
	return {
		ready,
		authenticated: !!authenticated,
		userId,
		email,
		login,
		logout,
	};
}
