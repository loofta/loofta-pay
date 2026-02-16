import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TokenSelection } from "@/app/utils/types";

export type StoredPayrollDeposit = {
  depositAddress: string;
  minAmountInFormatted?: string;
  timeEstimate?: number;
  memo?: string | null;
  deadline?: string | null;
};

type PayrollPayState = {
  byPaymentId: Record<
    string,
    {
      payWithToken?: TokenSelection | null;
      deposit?: StoredPayrollDeposit | null;
      status?: string | null;
      /** Persisted so receipt stays visible after retry without refetch */
      receipt_on_chain_tx_hash?: string | null;
      updatedAt?: number;
    }
  >;
  setPayWithToken: (paymentId: string, token: TokenSelection | null) => void;
  setDeposit: (paymentId: string, deposit: StoredPayrollDeposit | null) => void;
  setStatus: (paymentId: string, status: string | null) => void;
  setReceiptOnChainTxHash: (paymentId: string, txHash: string | null) => void;
  clearDeposit: (paymentId: string) => void;
  clear: (paymentId: string) => void;
};

export const usePayrollPayStore = create<PayrollPayState>()(
  persist(
    (set) => ({
      byPaymentId: {},
      setPayWithToken: (paymentId, token) =>
        set((s) => ({
          byPaymentId: {
            ...s.byPaymentId,
            [paymentId]: { ...(s.byPaymentId[paymentId] || {}), payWithToken: token ?? undefined, updatedAt: Date.now() },
          },
        })),
      setDeposit: (paymentId, deposit) =>
        set((s) => ({
          byPaymentId: {
            ...s.byPaymentId,
            [paymentId]: { ...(s.byPaymentId[paymentId] || {}), deposit: deposit ?? undefined, updatedAt: Date.now() },
          },
        })),
      setStatus: (paymentId, status) =>
        set((s) => ({
          byPaymentId: {
            ...s.byPaymentId,
            [paymentId]: { ...(s.byPaymentId[paymentId] || {}), status: status ?? undefined, updatedAt: Date.now() },
          },
        })),
      setReceiptOnChainTxHash: (paymentId, txHash) =>
        set((s) => ({
          byPaymentId: {
            ...s.byPaymentId,
            [paymentId]: { ...(s.byPaymentId[paymentId] || {}), receipt_on_chain_tx_hash: txHash ?? undefined, updatedAt: Date.now() },
          },
        })),
      clearDeposit: (paymentId) =>
        set((s) => ({
          byPaymentId: {
            ...s.byPaymentId,
            [paymentId]: { ...(s.byPaymentId[paymentId] || {}), deposit: null, updatedAt: Date.now() },
          },
        })),
      clear: (paymentId) =>
        set((s) => {
          const next = { ...s.byPaymentId };
          delete next[paymentId];
          return { byPaymentId: next };
        }),
    }),
    { name: "loofta-payroll-pay-ui", partialize: (s) => ({ byPaymentId: s.byPaymentId }) }
  )
);
