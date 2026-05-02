import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getSolanaCluster } from "@/lib/solanaCluster";

// On devnet deployments, default to devnet mode so cross-chain options stay hidden.
const CLUSTER_DEFAULT_NETWORK_MODE: "devnet" | "mainnet" =
	getSolanaCluster() === "mainnet-beta" ? "mainnet" : "devnet";

type AuthState = {
	authenticated: boolean;
	userId?: string;
	email?: string;
	username?: string | null;
	mainnetAccess: boolean;
	networkMode: "devnet" | "mainnet";
	openShareModal: boolean;
	openSettingsModal: boolean;
	setAuth: (v: { authenticated: boolean; userId?: string; email?: string; username?: string | null }) => void;
	setUsername: (username: string | null) => void;
	setMainnetAccess: (access: boolean) => void;
	setNetworkMode: (mode: "devnet" | "mainnet") => void;
	setOpenShareModal: (open: boolean) => void;
	setOpenSettingsModal: (open: boolean) => void;
};

// SSR-safe storage: only use localStorage on client so Next.js build/SSR doesn't break
function getAuthStorage() {
	if (typeof window === "undefined") {
		return {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {},
		};
	}
	return localStorage;
}

function loadUserNetworkMode(userId: string): "devnet" | "mainnet" | null {
	if (typeof window === "undefined") return null;
	const v = localStorage.getItem(`loofta.net.${userId}`);
	return v === "devnet" || v === "mainnet" ? v : null;
}

export const useAuthStore = create<AuthState>()(
	persist(
		(set) => ({
			authenticated: false,
			userId: undefined,
			email: undefined,
			username: undefined,
			mainnetAccess: false,
			networkMode: CLUSTER_DEFAULT_NETWORK_MODE,
			openShareModal: false,
			openSettingsModal: false,
			setAuth: (v) =>
				set((state) => {
					const authenticated = !!v.authenticated;
					if (!authenticated) {
						return {
							authenticated: false,
							userId: undefined,
							email: undefined,
							username: null,
							mainnetAccess: false,
							networkMode: CLUSTER_DEFAULT_NETWORK_MODE,
						};
					}
					const newUserId = v.userId ?? state.userId;
					// Load per-user network preference when switching accounts
					const savedMode = newUserId && newUserId !== state.userId
						? loadUserNetworkMode(newUserId)
						: null;
					return {
						authenticated: true,
						userId: newUserId,
						email: v.email ?? state.email,
						...(v.username !== undefined && { username: v.username }),
						...(savedMode !== null && { networkMode: savedMode }),
					};
				}),
			setUsername: (username) => set({ username }),
			setMainnetAccess: (access) => set({ mainnetAccess: access }),
			setNetworkMode: (mode) =>
				set((state) => {
					if (state.userId && typeof window !== "undefined") {
						localStorage.setItem(`loofta.net.${state.userId}`, mode);
					}
					return { networkMode: mode };
				}),
			setOpenShareModal: (open) => set({ openShareModal: open }),
			setOpenSettingsModal: (open) => set({ openSettingsModal: open }),
		}),
		{
			name: "loofta.auth.v1",
			storage: createJSONStorage(() => getAuthStorage()),
			partialize: (state) => ({
				authenticated: state.authenticated,
				userId: state.userId,
				email: state.email,
				username: state.username,
				mainnetAccess: state.mainnetAccess,
				networkMode: state.networkMode,
			}),
		}
	)
);
