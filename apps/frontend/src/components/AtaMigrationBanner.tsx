"use client";

import { useAtaMigration } from "@/hooks/useAtaMigration";

export function AtaMigrationBanner() {
  const { status } = useAtaMigration();

  if (status === "idle") return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#13131f] border border-white/[0.08] rounded-2xl px-8 py-8 flex flex-col items-center gap-5 shadow-2xl max-w-xs w-full mx-4">
        {status === "migrating" && (
          <>
            <div className="relative flex items-center justify-center w-14 h-14">
              <svg className="absolute inset-0 w-14 h-14 animate-spin text-[#FF7A2A]" fill="none" viewBox="0 0 56 56">
                <circle className="opacity-20" cx="28" cy="28" r="24" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-80" fill="currentColor" d="M4 28a24 24 0 0124-24v8a16 16 0 00-16 16H4z" />
              </svg>
              <img src="/loofta-icon.png" alt="" className="w-7 h-7 rounded-full" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            </div>
            <div className="text-center">
              <p className="text-white font-semibold text-base">Updating Loofta</p>
              <p className="text-slate-400 text-sm mt-1">One-time setup, just a few seconds</p>
            </div>
          </>
        )}

        {status === "done" && (
          <>
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <svg className="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-white font-semibold text-base">Loofta updated</p>
              <p className="text-slate-400 text-sm mt-1">You&apos;re all set</p>
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center">
              <svg className="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-white font-semibold text-base">Update incomplete</p>
              <p className="text-slate-400 text-sm mt-1">Will retry on next visit</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
