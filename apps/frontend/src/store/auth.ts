import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
const CLUSTER_DEFAULT_NETWORK_MODE: "devnet" | "mainnet" = "mainnet";

type AuthState = {
	authenticated: boolean;
	userId?: string;
	email?: string;
	username?: string | null;
	looUsername?: string | null;
	twitterUsername?: string | null;
	mainnetAccess: boolean;
	networkMode: "devnet" | "mainnet";
	openShareModal: boolean;
	openSettingsModal: boolean;
	isOnboardingOpen: boolean;
	tier: string;
	totalVolumeUsd: number;
	ataMigratedMainnet: boolean | null; // null = not yet loaded from DB
	ataMigratedDevnet: boolean | null;
	setAtaMigrated: (network: "mainnet" | "devnet", value: boolean) => void;
	setAuth: (v: { authenticated: boolean; userId?: string; email?: string; username?: string | null; looUsername?: string | null; twitterUsername?: string | null }) => void;
	setUsername: (username: string | null) => void;
	setLooUsername: (v: string | null) => void;
	setTwitterUsername: (v: string | null) => void;
	setMainnetAccess: (access: boolean) => void;
	setNetworkMode: (mode: "devnet" | "mainnet") => void;
	setOpenShareModal: (open: boolean) => void;
	setOpenSettingsModal: (open: boolean) => void;
	setIsOnboardingOpen: (open: boolean) => void;
	setTier: (tier: string, totalVolumeUsd: number) => void;
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


export const useAuthStore = create<AuthState>()(
	persist(
		(set) => ({
			authenticated: false,
			userId: undefined,
			email: undefined,
			username: undefined,
			looUsername: undefined,
			twitterUsername: undefined,
			mainnetAccess: true,
			networkMode: CLUSTER_DEFAULT_NETWORK_MODE,
			openShareModal: false,
			openSettingsModal: false,
			isOnboardingOpen: false,
			tier: 'noob',
			totalVolumeUsd: 0,
			ataMigratedMainnet: null,
			ataMigratedDevnet: null,
			setAtaMigrated: (network, value) =>
				set(network === "mainnet"
					? { ataMigratedMainnet: value }
					: { ataMigratedDevnet: value }),
			setTier: (tier, totalVolumeUsd) => set({ tier, totalVolumeUsd }),
			setAuth: (v) =>
				set((state) => {
					const authenticated = !!v.authenticated;
					if (!authenticated) {
						return {
							authenticated: false,
							userId: undefined,
							email: undefined,
							username: null,
							looUsername: null,
							twitterUsername: null,
							mainnetAccess: true,
							networkMode: CLUSTER_DEFAULT_NETWORK_MODE,
							tier: 'noob',
							totalVolumeUsd: 0,
							ataMigratedMainnet: null,
							ataMigratedDevnet: null,
						};
					}
					const newUserId = v.userId ?? state.userId;
					return {
						authenticated: true,
						userId: newUserId,
						networkMode: "mainnet",
						mainnetAccess: true,
						email: v.email ?? state.email,
						...(v.username !== undefined && { username: v.username }),
						...(v.looUsername !== undefined && { looUsername: v.looUsername }),
						...(v.twitterUsername !== undefined && { twitterUsername: v.twitterUsername }),
					};
				}),
			setUsername: (username) => set({ username }),
			setLooUsername: (looUsername) => set({ looUsername }),
			setTwitterUsername: (twitterUsername) => set({ twitterUsername }),
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
			setIsOnboardingOpen: (open) => set({ isOnboardingOpen: open }),
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
				// networkMode is NOT persisted here — per-user preference lives in loofta.net.${userId}.
			}),
			// Devnet retired: always force mainnet on rehydration regardless of any stored preference.
			onRehydrateStorage: () => (state) => {
				if (!state) return;
				state.networkMode = "mainnet";
				state.mainnetAccess = true;
			},
		}
	)
);
