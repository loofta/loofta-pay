'use client'

import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useHistoryModal } from "@/contexts/HistoryModalContext";
import { usePathname } from "next/navigation";

export function Header() {
  const { authenticated, login, email, logout } = useAuth();
  const { openHistory } = useHistoryModal();
  const pathname = usePathname();
  const showHistory = pathname === '/';

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 md:py-8 relative z-10">
      <div className="flex justify-between items-center animate-fade-in">
        <div className="relative inline-block">
          <Image
            src="/loofta.svg"
            alt="Loofta"
            width={120}
            height={44}
          />
          <span
            className="absolute -top-2 -right-4 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
          >
            pay
          </span>
        </div>

        <div className="flex items-center gap-2">
          {showHistory && (
            <Button
              className="bg-gray-900 hover:bg-gray-800 text-white font-semibold px-6 py-2.5 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg"
              onClick={openHistory}
            >
              History
            </Button>
          )}
          {!authenticated ? (
            <Button
              variant="outline"
              className="border-gray-300 text-gray-800 font-semibold px-6 py-2.5 rounded-xl transition-all duration-300 hover:scale-105"
              onClick={() => login()}
            >
              Log in
            </Button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-700">{email}</span>
              <Button
                variant="outline"
                className="border-gray-300 text-gray-800 font-semibold px-4 py-2 rounded-xl"
                onClick={() => logout()}
              >
                Log out
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


