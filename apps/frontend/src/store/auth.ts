import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type AuthState = {
	authenticated: boolean;
	userId?: string;
	email?: string;
	username?: string | null;
	openShareModal: boolean;
	setAuth: (v: { authenticated: boolean; userId?: string; email?: string; username?: string | null }) => void;
	setUsername: (username: string | null) => void;
	setOpenShareModal: (open: boolean) => void;
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
			openShareModal: false,
			setAuth: (v) =>
				set((state) => {
					const authenticated = !!v.authenticated;
					// When logging out, clear all user data so persisted state is clean
					if (!authenticated) {
						return {
							authenticated: false,
							userId: undefined,
							email: undefined,
							username: null,
						};
					}
					// When logging in / syncing: only update fields that are provided;
					// never overwrite username with undefined (keeps persisted username across Privy rehydration)
					return {
						authenticated: true,
						userId: v.userId ?? state.userId,
						email: v.email ?? state.email,
						...(v.username !== undefined && { username: v.username }),
					};
				}),
			setUsername: (username) => set({ username }),
			setOpenShareModal: (open) => set({ openShareModal: open }),
		}),
		{
			name: "loofta.auth.v1",
			storage: createJSONStorage(() => getAuthStorage()),
			partialize: (state) => ({
				authenticated: state.authenticated,
				userId: state.userId,
				email: state.email,
				username: state.username,
			}),
		}
	)
);
