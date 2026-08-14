import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isNonMainnetCluster } from "@/lib/solanaCluster";

// Derived from NEXT_PUBLIC_SOLANA_CLUSTER (build-time), not hardcoded: production builds set
// that to mainnet-beta, so this still always resolves to "mainnet" there — same end behavior as
// the "Devnet retired" mainnet-launch hardening this replaces (see git history on this file,
// commit 7f5c202: before mainnet launch, networkMode was a real per-user persisted preference;
// that commit force-pinned it to mainnet so a real user could never get stuck in devnet mode from
// stale localStorage). Deriving from the cluster env instead of a literal keeps that exact
// production guarantee while letting a genuine devnet build (.env.development.local) default to
// devnet, which the literal could never do.
const CLUSTER_DEFAULT_NETWORK_MODE: "devnet" | "mainnet" = isNonMainnetCluster() ? "devnet" : "mainnet";

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
						networkMode: CLUSTER_DEFAULT_NETWORK_MODE,
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
			// Force networkMode to the build-time cluster default on every rehydration, regardless of
			// any stored preference (see CLUSTER_DEFAULT_NETWORK_MODE above for why).
			onRehydrateStorage: () => (state) => {
				if (!state) return;
				state.networkMode = CLUSTER_DEFAULT_NETWORK_MODE;
				state.mainnetAccess = true;
			},
		}
	)
);
