'use client'

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = 'send' | 'receive';

export interface SendReceiveTabsProps {
  /** Which tab is active; null = neither (e.g. on History page) */
  activeTab: Tab | null;
  onTabChange?: (tab: Tab) => void;
  /** When true, tabs are links to / and /?tab=receive (e.g. on claim or history page) */
  visualOnly?: boolean;
}

export function SendReceiveTabs({ activeTab, onTabChange, visualOnly }: SendReceiveTabsProps) {
  const pathname = usePathname();
  const isHistoryPage = pathname === "/history";
  const tabClass = (tab: Tab) =>
    `flex-1 min-w-[100px] py-2.5 px-4 rounded-lg text-lg font-semibold transition-all text-center ${activeTab === tab ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'
    }`;

  return (
    <div className="flex items-center justify-between gap-2 mb-6">
      <div className="flex rounded-xl bg-white/5 p-1">
        {visualOnly ? (
          <>
            <Link href="/" className={tabClass('send')}>
              Send
            </Link>
            <Link href="/?tab=receive" className={tabClass('receive')}>
              Receive
            </Link>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onTabChange?.('send')}
              className={tabClass('send')}
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => onTabChange?.('receive')}
              className={tabClass('receive')}
            >
              Receive
            </button>
          </>
        )}
      </div>
      <Link
        href="/history"
        className={`p-2.5 rounded-xl transition-colors ${isHistoryPage ? "bg-white/10 text-amber-400" : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
          }`}
        title="History"
      >
        <span className="sr-only">History</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </Link>
    </div>
  );
}
