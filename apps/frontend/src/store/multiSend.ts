import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MultiSendRecipientType = "email" | "username" | "twitter" | "discord" | "github" | "telegram";

export interface MultiSendRow {
  id: string;
  recipient: string;
  amount: string;
  message: string;
  gif?: string;
  /** Explicit type picked from the row's selector. Optional so rows persisted before this field existed still load (falls back to "email" at usage sites). */
  recipientType?: MultiSendRecipientType;
}

export interface MultiSendLink {
  id: string;
  link: string;
  recipient_identifier: string;
  amount: string;
}

type MultiSendState = {
  showMultiSend: boolean;
  rows: MultiSendRow[];
  reviewPending: boolean;
  completedLinks: MultiSendLink[] | null;
  hydrated: boolean;
  setShowMultiSend: (v: boolean) => void;
  setRows: (rows: MultiSendRow[]) => void;
  setReviewPending: (v: boolean) => void;
  setCompletedLinks: (links: MultiSendLink[]) => void;
  setHydrated: (v: boolean) => void;
  clear: () => void;
};

const defaultRows = (): MultiSendRow[] => [
  { id: "ms-row-0", recipient: "", amount: "100", message: "", recipientType: "email" },
  { id: "ms-row-1", recipient: "", amount: "100", message: "", recipientType: "email" },
];

export const useMultiSendStore = create<MultiSendState>()(
  persist(
    (set) => ({
      showMultiSend: false,
      rows: defaultRows(),
      reviewPending: false,
      completedLinks: null,
      hydrated: false,

      setShowMultiSend: (showMultiSend) => set({ showMultiSend }),
      setRows: (rows) => set({ rows }),
      setReviewPending: (reviewPending) => set({ reviewPending }),
      setCompletedLinks: (completedLinks) => set({ completedLinks }),
      setHydrated: (hydrated) => set({ hydrated }),
      clear: () => set({ rows: defaultRows(), reviewPending: false, completedLinks: null }),
    }),
    {
      name: "loofta-multi-send",
      partialize: (s) => ({
        showMultiSend: s.showMultiSend,
        rows: s.rows,
        reviewPending: s.reviewPending,
        completedLinks: s.completedLinks,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (!error) state?.setHydrated(true);
      },
    },
  ),
);
