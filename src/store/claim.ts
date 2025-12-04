import { create } from "zustand";
import { persist } from "zustand/middleware";

type ClaimState = {
  isPrivateMode: boolean;
  createdLink: string | null;
  hydrated: boolean;
  setIsPrivateMode: (v: boolean) => void;
  setCreatedLink: (link: string | null) => void;
  clearLink: () => void;
  setHydrated: (h: boolean) => void;
};

export const useClaimStore = create<ClaimState>()(
  persist(
    (set) => ({
      isPrivateMode: false,
      createdLink: null,
      hydrated: false,
      setIsPrivateMode: (v) => set({ isPrivateMode: v }),
      setCreatedLink: (link) => set({ createdLink: link }),
      clearLink: () => set({ createdLink: null }),
      setHydrated: (h) => set({ hydrated: h }),
    }),
    {
      name: "loofta-claim-mode",
      partialize: (s) => ({ isPrivateMode: s.isPrivateMode, createdLink: s.createdLink }),
      onRehydrateStorage: () => (state, error) => {
        if (!error) {
          state?.setHydrated(true);
        }
      },
    }
  )
);

