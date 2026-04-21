export default function HistoryLoading() {
  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 animate-pulse">
          <div className="h-5 w-36 rounded-full bg-white/10 mb-4" />
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-full bg-white/10" />
                  <div className="h-2.5 w-20 rounded-full bg-white/10" />
                </div>
                <div className="h-8 w-24 rounded-lg bg-white/10" />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mb-3">
            <div className="h-3 w-28 rounded-full bg-white/10" />
            <div className="flex gap-1">
              <div className="w-7 h-7 rounded-lg bg-white/10" />
              <div className="w-7 h-7 rounded-lg bg-white/10" />
            </div>
          </div>
          <ul className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="h-3 w-10 rounded-full bg-white/10" />
                  <div className="h-3 w-16 rounded-full bg-white/10" />
                </div>
                <div className="h-3 w-32 rounded-full bg-white/10 mb-2" />
                <div className="flex items-center justify-between">
                  <div className="h-2.5 w-20 rounded-full bg-white/10" />
                  <div className="h-4 w-16 rounded-full bg-white/10" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
