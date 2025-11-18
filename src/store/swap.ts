import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TokenSelection } from "@/app/utils/types";

type SwapState = {
	fromSel: TokenSelection | null;
	toSel: TokenSelection | null;
	amount: string;
	hydrated: boolean;
	setFromSel: (s: TokenSelection | null) => void;
	setToSel: (s: TokenSelection | null) => void;
	setAmount: (a: string) => void;
	setHydrated: (h: boolean) => void;
	reset: () => void;
};

export const useSwapStore = create<SwapState>()(
	persist(
		(set) => ({
			fromSel: null,
			toSel: null,
			amount: "",
			hydrated: false,
			setFromSel: (s) => set({ fromSel: s }),
			setToSel: (s) => set({ toSel: s }),
			setAmount: (a) => set({ amount: a }),
			setHydrated: (h) => set({ hydrated: h }),
			reset: () => set({ fromSel: null, toSel: null, amount: "" }),
		}),
		{
			name: "loofta-swap-ui",
			partialize: (s) => ({ fromSel: s.fromSel, toSel: s.toSel, amount: s.amount }),
			onRehydrateStorage: () => (state, error) => {
				if (!error) {
					state?.setHydrated(true);
				}
			},
		}
	)
);


