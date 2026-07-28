"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "next/navigation";
import { Settings, Landmark } from "lucide-react";
import { useTranslations } from "next-intl";
import { TIERS, getTierForVolume } from "@/lib/tiers";
import { getClientGeo } from "@/lib/geo";
import { pajLinkStatus, pajListBankAccounts, type PajSavedBankAccount } from "@/services/pajCash";

const PAJ_CASH_ENABLED = process.env.NEXT_PUBLIC_PAJ_CASH_ENABLED === "true";

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function formatVol(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `$${n.toFixed(0)}`;
}

export default function ProfilePage() {
  const t = useTranslations('SettingsPage');
  const router = useRouter();
  const { authenticated, logout, getAccessToken } = useAuth();
  const username = useAuthStore((s) => s.username ?? null);
  const email = useAuthStore((s) => s.email);
  const tier = useAuthStore((s) => s.tier);
  const totalVolumeUsd = useAuthStore((s) => s.totalVolumeUsd);
  const setOpenShareModal = useAuthStore((s) => s.setOpenShareModal);
  const setOpenSettingsModal = useAuthStore((s) => s.setOpenSettingsModal);
  const [statusOpen, setStatusOpen] = useState(false);

  // Naira payout card — shown for users in Nigeria (by IP) or already linked to PAJ Cash, so it
  // doesn't clutter profiles for the vast majority this never applies to.
  const [showNairaCard, setShowNairaCard] = useState(false);
  const [defaultBankAccount, setDefaultBankAccount] = useState<PajSavedBankAccount | null>(null);
  useEffect(() => {
    if (!PAJ_CASH_ENABLED || !authenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const status = await pajLinkStatus(accessToken);
        if (cancelled) return;
        if (status.linked) {
          setShowNairaCard(true);
          const accounts = await pajListBankAccounts(accessToken);
          if (!cancelled) setDefaultBankAccount(accounts.find((a) => a.is_default) ?? null);
          return;
        }
        const geo = await getClientGeo();
        if (!cancelled && geo.countryCode === "NG") setShowNairaCard(true);
      } catch {
        // leave hidden — this is a nice-to-have surface, not critical path
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated, getAccessToken]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (!authenticated) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
        <div className="max-w-lg mx-auto px-4 py-8">
          <p className="text-slate-400 text-center mb-6">{t('signInPrompt')}</p>
          <Link
            href="/"
            className="block w-full text-center rounded-xl px-4 py-3 font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
          >
            {t('goToHome')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <h1 className="text-xl font-bold text-white mb-6">{t('title')}</h1>

        {/* User info box */}
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-4">
          {username && (
            <div className="mb-3 last:mb-0">
              <p className="text-base font-medium text-slate-400 mb-1">{t('username')}</p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-base font-semibold text-white truncate">@{username}</p>
                <button
                  type="button"
                  onClick={() => copyToClipboard(`@${username}`)}
                  className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white shrink-0 transition-colors"
                  title={t('copyUsername')}
                  aria-label={t('copyUsername')}
                >
                  <CopyIcon className="text-slate-400" />
                </button>
              </div>
            </div>
          )}
          {email && (
            <div>
              <p className="text-base font-medium text-slate-400 mb-1">{t('email')}</p>
              <p className="text-base text-white/90">{email}</p>
            </div>
          )}
        </div>

        {/* Tier status card */}
        {(() => {
          const info = getTierForVolume(totalVolumeUsd);
          const nextTier = TIERS.find((t) => t.minVolume > totalVolumeUsd);
          const remaining = nextTier ? nextTier.minVolume - totalVolumeUsd : 0;
          return (
            <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-base font-medium text-slate-400">Status</p>
                <span className={`text-base font-semibold px-2.5 py-0.5 rounded-full ${info.color} ${info.bg}`}>
                  {info.label}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-base text-slate-500 mb-0.5">Total volume</p>
                  <p className="text-base font-medium text-white">{formatVol(totalVolumeUsd)}</p>
                </div>
                {nextTier && (
                  <p className="text-base text-slate-500 text-right">
                    {formatVol(remaining)} to <span className="text-slate-300">{nextTier.label}</span>
                  </p>
                )}
                {!nextTier && (
                  <p className="text-base text-slate-400">Top tier 🏆</p>
                )}
              </div>

              {/* About status levels accordion */}
              <button
                type="button"
                onClick={() => setStatusOpen((v) => !v)}
                className="mt-3 w-full flex items-center justify-between pt-3 border-t border-white/10 text-base text-slate-400 hover:text-slate-200 transition-colors"
              >
                <span>About status levels</span>
                <span className={`transition-transform duration-200 ${statusOpen ? "rotate-45" : ""}`}>+</span>
              </button>

              <div className={`grid transition-all duration-200 ease-out ${statusOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                <div className="overflow-hidden">
                  <p className="text-base text-slate-400 mt-3 mb-2">
                    Your status is based on total USDC volume sent and received on Loofta — mainnet only.
                  </p>
                  <div className="space-y-1.5">
                    {TIERS.map((t) => {
                      const isActive = t.key === info.key;
                      return (
                        <div
                          key={t.key}
                          className={`flex items-center justify-between rounded-lg px-3 py-2 ${isActive ? "bg-white/8 border border-white/10" : ""}`}
                        >
                          <span className={`text-base font-semibold ${t.color}`}>{t.label}</span>
                          <span className="text-base text-slate-500">
                            {formatVol(t.minVolume)}{t.maxVolume ? ` – ${formatVol(t.maxVolume)}` : "+"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {showNairaCard && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("openBalanceModal", { detail: { tab: "withdraw" } }))}
            className="w-full rounded-xl bg-white/5 border border-white/10 p-4 mb-4 text-left hover:bg-white/10 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Landmark className="w-5 h-5 text-orange-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-base font-medium text-slate-400">Naira payout account</p>
                {defaultBankAccount ? (
                  <p className="text-base font-semibold text-white truncate">
                    {defaultBankAccount.bank_name} · ····{defaultBankAccount.account_number.slice(-4)}
                  </p>
                ) : (
                  <p className="text-base font-semibold text-white">Set up Naira payouts</p>
                )}
              </div>
            </div>
          </button>
        )}

        <div className="h-px bg-white/10 my-2" />

        {username && (
          <button
            type="button"
            onClick={() => setOpenShareModal(true)}
            className="w-full text-left px-3 py-3 rounded-lg text-base font-medium transition-colors flex items-center gap-3 text-orange-400 hover:bg-orange-400/10"
          >
            <ShareIcon />
            {t('shareYourLink')}
          </button>
        )}

        <button
          type="button"
          onClick={() => setOpenSettingsModal(true)}
          className="w-full text-left px-3 py-3 rounded-lg text-base font-medium transition-colors flex items-center gap-3 text-white hover:bg-white/10"
        >
          <Settings className="w-4 h-4 shrink-0" />
          {t('settings')}
        </button>

        <div className="h-px bg-white/10 my-2" />

        <button
          type="button"
          onClick={() => {
            logout();
            router.push("/");
          }}
          className="w-full text-left px-3 py-3 rounded-lg text-base font-medium transition-colors text-red-400 hover:bg-red-400/10"
        >
          {t('logOut')}
        </button>

      </div>
    </div>
  );
}
