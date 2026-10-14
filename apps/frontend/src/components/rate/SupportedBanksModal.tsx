'use client'

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { clientApiBase } from "@/services/api/client";

interface PajBank {
  id: string;
  name: string;
  code: string;
  logo?: string;
}

// Module-level cache: the bank list is static reference data (see backend paj-banks-static.ts),
// so once fetched in this browser session there's no reason to re-fetch it every time the modal
// reopens.
let cachedBanks: PajBank[] | null = null;

export function SupportedBanksModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [banks, setBanks] = useState<PajBank[] | null>(cachedBanks);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || cachedBanks) return;
    let cancelled = false;
    fetch(`${clientApiBase()}/paj-cash/public-banks`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
      .then((data: PajBank[]) => {
        if (cancelled) return;
        cachedBanks = data;
        setBanks(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const results = useMemo(() => {
    if (!banks) return [];
    const q = query.trim().toLowerCase();
    if (!q) return banks;
    return banks.filter((bank) => bank.name.toLowerCase().includes(q));
  }, [banks, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#0f0f12] text-slate-100 sm:max-w-md max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-slate-100 font-display">Nigerian banks supported</DialogTitle>
          <DialogDescription className="text-slate-300">
            Search for your bank to check it's supported for naira payouts.
          </DialogDescription>
        </DialogHeader>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your bank"
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 font-grotesk text-base text-slate-100 placeholder:text-slate-500 outline-none focus:border-white/20"
          autoFocus
        />

        <div className="overflow-y-auto flex-1 -mx-2 px-2">
          {failed ? (
            <p className="font-grotesk text-base text-slate-300 py-4">
              Couldn't load the bank list right now. Check inside the app instead.
            </p>
          ) : !banks ? (
            <p className="font-grotesk text-base text-slate-300 py-4">Loading banks…</p>
          ) : results.length === 0 ? (
            <p className="font-grotesk text-base text-slate-300 py-4">
              We couldn't find that bank. It may still be supported, check inside the app.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 py-2">
              {results.map((bank) => (
                <li
                  key={bank.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 font-grotesk text-base text-slate-200"
                >
                  {bank.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={bank.logo} alt="" className="h-6 w-6 rounded shrink-0 object-contain bg-white/5" />
                  ) : (
                    <span className="h-6 w-6 rounded shrink-0 bg-white/10" />
                  )}
                  <span className="flex-1">{bank.name}</span>
                  <span className="text-[#4ADE80] font-semibold whitespace-nowrap">Supported ✓</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
