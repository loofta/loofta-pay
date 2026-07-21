export default function HomePage() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-lg font-semibold">Loofta Link</h1>
      <p className="text-sm text-slate-400 max-w-sm">
        This link is missing or expired. Ask whoever sent it to check the claim link and try again.
      </p>
    </div>
  );
}
