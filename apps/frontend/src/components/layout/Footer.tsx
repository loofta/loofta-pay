import Image from "next/image";
import { looftaXyz } from "@/lib/looftaXyzUrls";

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
            <h4 className="text-white font-semibold mb-4">For you</h4>
            <ul className="space-y-2">
              <li><a href="/" className="text-slate-400 hover:text-white transition-colors">Send</a></li>
              <li><a href="/?tab=receive" className="text-slate-400 hover:text-white transition-colors">Receive</a></li>
              <li><a href="/history" className="text-slate-400 hover:text-white transition-colors">History</a></li>
              <li><a href="/settings" className="text-slate-400 hover:text-white transition-colors">Settings</a></li>
            </ul>
          </div>

          {/* For business */}
          <div>
            <h4 className="text-white font-semibold mb-4">For business</h4>
            <ul className="space-y-2">
              <li><a href={looftaXyz.checkout} className="text-slate-400 hover:text-white transition-colors">Checkout</a></li>
              <li><a href={looftaXyz.partners} className="text-slate-400 hover:text-white transition-colors">Partners</a></li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-white font-semibold mb-4">Company</h4>
            <ul className="space-y-2">
              <li><a href={looftaXyz.about} className="text-slate-400 hover:text-white transition-colors">About</a></li>
            </ul>
          </div>

          {/* Socials & Docs */}
          <div>
            <h4 className="text-white font-semibold mb-4">Socials & Docs</h4>
            <ul className="space-y-2">
              <li><a href="https://medium.com/@looftaxyz" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Medium</a></li>
              <li><a href="https://twitter.com/looftapay" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Twitter</a></li>
              <li><a href="https://t.me/looftapay" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Telegram</a></li>
              <li><a href="https://loofta.gitbook.io/docs" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Docs</a></li>
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
