import { create } from "zustand";
import { persist } from "zustand/middleware";

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

export const useAuthStore = create<AuthState>()(
	persist(
		(set) => ({
			authenticated: false,
			userId: undefined,
			email: undefined,
			username: undefined,
			openShareModal: false,
			setAuth: (v) => set({ 
				authenticated: !!v.authenticated, 
				userId: v.userId, 
				email: v.email,
				username: v.username,
			}),
			setUsername: (username) => set({ username }),
			setOpenShareModal: (open) => set({ openShareModal: open }),
		}),
		{
			name: "loofta.auth.v1",
			partialize: (state) => ({
				authenticated: state.authenticated,
				userId: state.userId,
				email: state.email,
				username: state.username,
			}),
		}
	)
);
