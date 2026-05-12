"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";

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

export default function SettingsPage() {
  const router = useRouter();
  const { authenticated, logout } = useAuth();
  const username = useAuthStore((s) => s.username ?? null);
  const email = useAuthStore((s) => s.email);
  const setOpenShareModal = useAuthStore((s) => s.setOpenShareModal);
  const setOpenSettingsModal = useAuthStore((s) => s.setOpenSettingsModal);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (!authenticated) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
        <div className="max-w-lg mx-auto px-4 py-8">
          <p className="text-slate-400 text-center mb-6">Sign in to view your profile.</p>
          <Link
            href="/"
            className="block w-full text-center rounded-xl px-4 py-3 font-semibold bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90"
          >
            Go to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white mobile-first">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <h1 className="text-xl font-bold text-white mb-6">Profile</h1>

        {/* User info box – same as desktop username submenu */}
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-4">
          {username && (
            <div className="mb-3 last:mb-0">
              <p className="text-base md:text-sm font-medium text-slate-400 mb-1">Username</p>
              <div className="flex items-center justify-between gap-2">
                <p className="text-base md:text-sm font-semibold text-white truncate">@{username}</p>
                <button
                  type="button"
                  onClick={() => copyToClipboard(`@${username}`)}
                  className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white shrink-0 transition-colors"
                  title="Copy username"
                  aria-label="Copy username"
                >
                  <CopyIcon className="text-slate-400" />
                </button>
              </div>
            </div>
          )}
          {email && (
            <div className={username ? "" : ""}>
              <p className="text-base md:text-sm font-medium text-slate-400 mb-1">Email</p>
              <p className="text-base md:text-sm text-white/90">{email}</p>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-white/10 my-2" />

        {/* Share your link – orange */}
        {username && (
          <button
            type="button"
            onClick={() => setOpenShareModal(true)}
            className="w-full text-left px-3 py-3 rounded-lg text-base md:text-sm font-medium transition-colors flex items-center gap-3 text-orange-400 hover:bg-orange-400/10"
          >
            <ShareIcon />
            Share your link
          </button>
        )}

        {/* Settings – white */}
        <button
          type="button"
          onClick={() => setOpenSettingsModal(true)}
          className="w-full text-left px-3 py-3 rounded-lg text-base md:text-sm font-medium transition-colors flex items-center gap-3 text-white hover:bg-white/10"
        >
          <Settings className="w-4 h-4 shrink-0" />
          Settings
        </button>

        {/* Divider */}
        <div className="h-px bg-white/10 my-2" />

        {/* Log out – red */}
        <button
          type="button"
          onClick={() => {
            logout();
            router.push("/");
          }}
          className="w-full text-left px-3 py-3 rounded-lg text-base md:text-sm font-medium transition-colors text-red-400 hover:bg-red-400/10"
        >
          Log out
        </button>
      </div>
    </div>
  );
}
