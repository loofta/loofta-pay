import { create } from "zustand";
import { persist } from "zustand/middleware";

type AuthState = {
	authenticated: boolean;
	userId?: string;
	email?: string;
	username?: string | null;
	setAuth: (v: { authenticated: boolean; userId?: string; email?: string; username?: string | null }) => void;
	setUsername: (username: string | null) => void;
};

export const useAuthStore = create<AuthState>()(
	persist(
		(set) => ({
			authenticated: false,
			userId: undefined,
			email: undefined,
			username: undefined,
			setAuth: (v) => set({ 
				authenticated: !!v.authenticated, 
				userId: v.userId, 
				email: v.email,
				username: v.username,
			}),
			setUsername: (username) => set({ username }),
		}),
		{ name: "loofta.auth.v1" }
	)
);
