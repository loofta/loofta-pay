'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type HistoryModalContextValue = {
  open: boolean;
  openHistory: () => void;
  closeHistory: () => void;
  setOpen: (open: boolean) => void;
};

const HistoryModalContext = createContext<HistoryModalContextValue | undefined>(undefined);

export function HistoryModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openHistory = useCallback(() => setOpen(true), []);
  const closeHistory = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ open, setOpen, openHistory, closeHistory }),
    [open, openHistory, closeHistory]
  );

  return <HistoryModalContext.Provider value={value}>{children}</HistoryModalContext.Provider>;
}

export function useHistoryModal(): HistoryModalContextValue {
  const ctx = useContext(HistoryModalContext);
  if (!ctx) {
    throw new Error('useHistoryModal must be used within HistoryModalProvider');
  }
  return ctx;
}


