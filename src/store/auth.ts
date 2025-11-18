import { create } from "zustand";
import { persist } from "zustand/middleware";

type AuthState = {
	authenticated: boolean;
	userId?: string;
	email?: string;
	setAuth: (v: { authenticated: boolean; userId?: string; email?: string }) => void;
};

export const useAuthStore = create<AuthState>()(
	persist(
		(set) => ({
			authenticated: false,
			userId: undefined,
			email: undefined,
			setAuth: (v) => set({ authenticated: !!v.authenticated, userId: v.userId, email: v.email }),
		}),
		{ name: "loofta.auth.v1" }
	)
);
