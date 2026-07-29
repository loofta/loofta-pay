import { Wrench } from "lucide-react";

export default function MaintenancePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0f0f12] flex flex-col items-center justify-center px-4 text-center">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[420px] w-[420px] rounded-full bg-gradient-to-r from-[#FF0F00]/20 to-yellow-500/20 blur-[120px]" />
      </div>

      <div className="relative flex flex-col items-center">
        <p className="text-sm font-medium tracking-wide text-white/40 uppercase mb-8">Loofta</p>

        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-r from-[#FF0F00] to-yellow-500 shadow-lg">
          <Wrench className="h-7 w-7 text-white" />
        </div>

        <h1 className="text-2xl md:text-3xl font-semibold text-slate-100 mb-3 font-grotesk">
          We&apos;ll be back shortly
        </h1>
        <p className="text-base text-white/50 max-w-sm">
          We&apos;re performing scheduled maintenance. Your funds are safe, please check back in a few minutes.
        </p>
      </div>
    </div>
  );
}
