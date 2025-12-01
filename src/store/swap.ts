import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TokenSelection } from "@/app/utils/types";

type SwapState = {
	fromSel: TokenSelection | null;
	toSel: TokenSelection | null;
	amount: string;
	provider: "near-intents" | "biconomy";
	hydrated: boolean;
	setFromSel: (s: TokenSelection | null) => void;
	setToSel: (s: TokenSelection | null) => void;
	setAmount: (a: string) => void;
	setProvider: (p: "near-intents" | "biconomy") => void;
	setHydrated: (h: boolean) => void;
	reset: () => void;
};

export const useSwapStore = create<SwapState>()(
	persist(
		(set) => ({
			fromSel: null,
			toSel: null,
			amount: "",
			provider: "near-intents",
			hydrated: false,
			setFromSel: (s) => set({ fromSel: s }),
			setToSel: (s) => set({ toSel: s }),
			setAmount: (a) => set({ amount: a }),
			setProvider: (p) => set({ provider: p }),
			setHydrated: (h) => set({ hydrated: h }),
			reset: () => set({ fromSel: null, toSel: null, amount: "" }),
		}),
		{
			name: "loofta-swap-ui",
			partialize: (s) => ({ fromSel: s.fromSel, toSel: s.toSel, amount: s.amount, provider: s.provider }),
			onRehydrateStorage: () => (state, error) => {
				if (!error) {
					state?.setHydrated(true);
				}
			},
		}
	)
);


