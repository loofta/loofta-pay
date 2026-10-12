"use client";

import { createContext, useContext } from "react";

export type GiveawayDraft = {
  locMode?: "any" | "only" | "except";
  requiredCountries?: string[];
  excludedCountries?: string[];
  requiredContinents?: string[];
  excludedContinents?: string[];
};

export const RewardsDraftContext = createContext<{
  gw: GiveawayDraft;
  patchGw: (partial: GiveawayDraft) => void;
} | null>(null);

export function useRewardsDraft() {
  const ctx = useContext(RewardsDraftContext);
  if (!ctx) throw new Error("Region select is outside the rewards draft");
  return ctx;
}
