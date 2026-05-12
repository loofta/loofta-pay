import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0f0f12] flex flex-col items-center justify-center px-4 text-center">
      <p className="text-[180px] font-bold text-white/10 leading-none mb-6 font-grotesk">404</p>
      <h1 className="text-xl font-semibold text-white mb-2">Page not found</h1>
      <p className="text-base md:text-sm text-white/50 mb-8 max-w-xs">
        This URL doesn't exist or may have been moved.
      </p>

      <Link
        href="/app"
        className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-base md:text-sm font-medium transition-colors"
      >
        Go to app
      </Link>
    </div>
  );
}
