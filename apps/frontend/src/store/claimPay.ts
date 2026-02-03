import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TokenSelection } from "@/app/utils/types";

export type StoredDeposit = {
  depositAddress?: string;
  memo?: string | null;
  deadline?: string;
  quoteId?: string;
  minDepositFormatted?: string;
  minAmountInFormatted?: string; // The actual amount user needs to send
};

type ClaimUiState = {
  byId: Record<
    string,
    {
      fromSel?: TokenSelection | null;
      deposit?: StoredDeposit | null;
      status?: string | null;
      refundAddress?: string | null;
      updatedAt?: number;
    }
  >;
  setFromSel: (claimId: string, sel: TokenSelection | null) => void;
  setDeposit: (claimId: string, dep: StoredDeposit | null) => void;
  setStatus: (claimId: string, status: string | null) => void;
  setRefundAddress: (claimId: string, address: string | null) => void;
  clear: (claimId: string) => void;
};

export const useClaimPayStore = create<ClaimUiState>()(
  persist(
    (set, get) => ({
      byId: {},
      setFromSel: (claimId, sel) =>
        set((s) => ({
          byId: { ...s.byId, [claimId]: { ...(s.byId[claimId] || {}), fromSel: sel, updatedAt: Date.now() } },
        })),
      setDeposit: (claimId, dep) =>
        set((s) => ({
          byId: { ...s.byId, [claimId]: { ...(s.byId[claimId] || {}), deposit: dep, updatedAt: Date.now() } },
        })),
      setStatus: (claimId, status) =>
        set((s) => ({
          byId: { ...s.byId, [claimId]: { ...(s.byId[claimId] || {}), status, updatedAt: Date.now() } },
        })),
      setRefundAddress: (claimId, address) =>
        set((s) => ({
          byId: { ...s.byId, [claimId]: { ...(s.byId[claimId] || {}), refundAddress: address, updatedAt: Date.now() } },
        })),
      clear: (claimId) =>
        set((s) => {
          const next = { ...s.byId };
          delete next[claimId];
          return { byId: next };
        }),
    }),
    {
      name: "loofta-claim-pay-ui",
      partialize: (s) => ({ byId: s.byId }),
    }
  )
);


