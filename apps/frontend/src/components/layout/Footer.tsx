import Image from "next/image";

export function Footer() {
  return (
    <footer className="bg-[#18181F] pt-32 md:pt-40 pb-12">
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 md:gap-12">
          {/* Logo */}
          <div className="col-span-2 md:col-span-1">
            <Image
              src="/loofta_white.svg"
              alt="Loofta"
              width={140}
              height={40}
              className="h-10 w-auto"
            />
          </div>

          {/* Products */}
          <div>
            <h4 className="text-white font-semibold mb-4">Products</h4>
            <ul className="space-y-2">
              <li><a href="/swap" className="text-slate-400 hover:text-white transition-colors">Cross-chain swap</a></li>
              <li><a href="/claim" className="text-slate-400 hover:text-white transition-colors">Payment request</a></li>
            </ul>
          </div>

          {/* Socials */}
          <div>
            <h4 className="text-white font-semibold mb-4">Socials</h4>
            <ul className="space-y-2">
              <li><a href="https://medium.com/@looftaxyz" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Medium</a></li>
              <li><a href="https://twitter.com/looftaxyz" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Twitter</a></li>
              <li><a href="https://t.me/looftaxyz" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Telegram</a></li>
            </ul>
          </div>

          {/* Documentation */}
          <div>
            <h4 className="text-white font-semibold mb-4">Documentation</h4>
            <ul className="space-y-2">
              <li><a href="https://loofta.gitbook.io/docs" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Github</a></li>
            </ul>
          </div>

          {/* Routes */}
          <div>
            <h4 className="text-white font-semibold mb-4">Routes</h4>
            <ul className="space-y-2">
              <li><a href="/swap" className="text-slate-400 hover:text-white transition-colors">Bridge to Solana</a></li>
              <li><a href="/swap" className="text-slate-400 hover:text-white transition-colors">Bridge to Bitcoin</a></li>
              <li><a href="/swap" className="text-slate-400 hover:text-white transition-colors">Bridge to Ethereum</a></li>
            </ul>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-12 pt-6 border-t border-gray-800">
          <p className="text-slate-500 text-sm text-center">
            © {new Date().getFullYear()} Loofta. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

