import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TokenSelection } from "@/app/utils/types";

export type CompanionWalletInfo = {
  address: string;
  userAddress: string; // The user's EOA that owns this companion wallet
  createdAt: number;
  lastUsedAt: number;
};

export type LotteryPurchaseState = {
  companionAddress: string;
  depositAddress: string;
  depositData: { minAmountInFormatted?: string } | null;
  executionStep: "quote" | "deposit" | "polling" | "executing" | "complete" | null;
  numTickets: string;
  recipientAddress: string;
  lastUpdated: number;
};

type CompanionWalletState = {
  wallets: Record<string, CompanionWalletInfo>; // key: userAddress.toLowerCase()
  setCompanionWallet: (userAddress: string, companionAddress: string) => void;
  getCompanionWallet: (userAddress: string) => CompanionWalletInfo | null;
  clearCompanionWallet: (userAddress: string) => void;
  // Payment token cache
  selectedPaymentToken: TokenSelection | null;
  setSelectedPaymentToken: (token: TokenSelection | null) => void;
  // Lottery purchase state cache
  lotteryPurchaseState: LotteryPurchaseState | null;
  setLotteryPurchaseState: (state: Partial<LotteryPurchaseState> | null) => void;
  clearLotteryPurchaseState: () => void;
};

export const useCompanionWalletStore = create<CompanionWalletState>()(
  persist(
    (set, get) => ({
      wallets: {},
      selectedPaymentToken: null,
      setCompanionWallet: (userAddress, companionAddress) => {
        const key = userAddress.toLowerCase();
        const now = Date.now();
        set((s) => ({
          wallets: {
            ...s.wallets,
            [key]: {
              address: companionAddress,
              userAddress,
              createdAt: s.wallets[key]?.createdAt || now,
              lastUsedAt: now,
            },
          },
        }));
        console.log("[CompanionWallet Store] Cached companion wallet:", {
          userAddress,
          companionAddress,
          key,
        });
      },
      getCompanionWallet: (userAddress) => {
        const key = userAddress.toLowerCase();
        const wallet = get().wallets[key];
        if (wallet) {
          // Update lastUsedAt
          set((s) => ({
            wallets: {
              ...s.wallets,
              [key]: { ...wallet, lastUsedAt: Date.now() },
            },
          }));
        }
        return wallet || null;
      },
      clearCompanionWallet: (userAddress) => {
        const key = userAddress.toLowerCase();
        set((s) => {
          const next = { ...s.wallets };
          delete next[key];
          return { wallets: next };
        });
      },
      setSelectedPaymentToken: (token) => {
        set({ selectedPaymentToken: token });
        console.log("[CompanionWallet Store] Cached payment token:", token);
      },
      lotteryPurchaseState: null,
      setLotteryPurchaseState: (state) => {
        if (state === null) {
          set({ lotteryPurchaseState: null });
          console.log("[CompanionWallet Store] Cleared lottery purchase state");
        } else {
          set((s) => ({
            lotteryPurchaseState: {
              ...(s.lotteryPurchaseState || {
                companionAddress: "",
                depositAddress: "",
                depositData: null,
                executionStep: null,
                numTickets: "1",
                recipientAddress: "",
                lastUpdated: Date.now(),
              }),
              ...state,
              lastUpdated: Date.now(),
            },
          }));
          console.log("[CompanionWallet Store] Cached lottery purchase state:", state);
        }
      },
      clearLotteryPurchaseState: () => {
        set({ lotteryPurchaseState: null });
        console.log("[CompanionWallet Store] Cleared lottery purchase state");
      },
    }),
    {
      name: "loofta-companion-wallets",
      partialize: (s) => ({ 
        wallets: s.wallets,
        selectedPaymentToken: s.selectedPaymentToken,
        lotteryPurchaseState: s.lotteryPurchaseState,
      }),
    }
  )
);

