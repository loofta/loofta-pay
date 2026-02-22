'use client'

import Link from "next/link";
import { usePathname } from "next/navigation";

export function BottomNav() {
  const pathname = usePathname();
  const isHome = pathname === '/';
  const isHistory = pathname === '/history';
  const isSettings = pathname === '/settings';

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0f0f12] border-t border-white/10 safe-area-pb">
      <div className="flex items-center justify-around h-14 max-w-lg mx-auto">
        <Link
          href="/"
          className={`flex flex-col items-center justify-center flex-1 py-2 text-xs font-medium transition-colors ${
            isHome ? 'text-amber-400' : 'text-slate-400 hover:text-white'
          }`}
        >
          <span className="text-lg mb-0.5">📤</span>
          Send
        </Link>
        <Link
          href="/?tab=receive"
          className="flex flex-col items-center justify-center flex-1 py-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <span className="text-lg mb-0.5">📥</span>
          Receive
        </Link>
        <Link
          href="/history"
          className={`flex flex-col items-center justify-center flex-1 py-2 text-xs font-medium transition-colors ${
            isHistory ? 'text-amber-400' : 'text-slate-400 hover:text-white'
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mb-0.5">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          History
        </Link>
        <Link
          href="/settings"
          className={`flex flex-col items-center justify-center flex-1 py-2 text-xs font-medium transition-colors ${
            isSettings ? 'text-amber-400' : 'text-slate-400 hover:text-white'
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mb-0.5">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Profile
        </Link>
      </div>
    </nav>
  );
}
