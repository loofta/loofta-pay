import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CreateSendPaymentResult } from "@/services/api/sendPayment";

export type SendPaymentStep = "form" | "created" | "funded";

type SendPaymentState = {
  /** Current payment link (created, waiting to fund or already funded). Persisted so refresh keeps it. */
  currentLink: CreateSendPaymentResult | null;
  step: SendPaymentStep;
  hydrated: boolean;
  setCurrentLink: (link: CreateSendPaymentResult | null) => void;
  setStep: (step: SendPaymentStep) => void;
  setHydrated: (v: boolean) => void;
  /** Call after creating a link: stores link and sets step to 'created'. */
  setCreated: (link: CreateSendPaymentResult) => void;
  /** Call after funding: updates step to 'funded'. */
  setFunded: () => void;
  /** Clear current link and reset to form (e.g. "Create another link"). */
  clearCurrentLink: () => void;
};

export const useSendPaymentStore = create<SendPaymentState>()(
  persist(
    (set) => ({
      currentLink: null,
      step: "form",
      hydrated: false,

      setCurrentLink: (currentLink) => set({ currentLink }),
      setStep: (step) => set({ step }),
      setHydrated: (hydrated) => set({ hydrated }),

      setCreated: (link) => set({ currentLink: link, step: "created" }),
      setFunded: () => set((s) => (s.currentLink ? { step: "funded" as const } : {})),
      clearCurrentLink: () => set({ currentLink: null, step: "form" }),
    }),
    {
      name: "loofta-send-payment",
      partialize: (s) => ({
        currentLink: s.currentLink,
        step: s.step,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (!error) {
          state?.setHydrated(true);
        }
      },
    }
  )
);
