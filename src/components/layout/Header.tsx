'use client'

import Image from "next/image";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useHistoryModal } from "@/contexts/HistoryModalContext";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

export function Header() {
  const { authenticated, email, logout } = useAuth();
  const { login: privyLogin } = usePrivy();
  const { openHistory } = useHistoryModal();
  const pathname = usePathname();
  const showHistory = pathname?.startsWith('/swap') === true;
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [showAccessRequested, setShowAccessRequested] = useState(false);
  const [pendingAccessRequest, setPendingAccessRequest] = useState(false);

  // Handle email-only login for request access
  const handleRequestAccess = () => {
    setPendingAccessRequest(true);
    privyLogin({
      loginMethods: ['email'],
      disableSignup: false,
    });
  };

  // Show success message when user authenticates after requesting access
  useEffect(() => {
    if (authenticated && pendingAccessRequest) {
      setShowAccessRequested(true);
      setPendingAccessRequest(false);
    }
  }, [authenticated, pendingAccessRequest]);

  useEffect(() => {
    const updateHeaderVar = () => {
      const h = headerRef.current?.offsetHeight || 0;
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty('--header-h', `${h}px`);
      }
    };
    updateHeaderVar();
    window.addEventListener('resize', updateHeaderVar);
    return () => {
      window.removeEventListener('resize', updateHeaderVar);
    };
  }, []);

  return (
    <div ref={headerRef} className="fixed inset-x-0 top-0 z-50" style={{ backdropFilter: 'blur(10px)' }}>
      <div className="max-w-7xl mx-auto px-4 py-6 md:py-8">
        <div className="flex justify-between items-center animate-fade-in">
          <div className="relative inline-block">
            <Image
              src="/loofta.svg"
              alt="Loofta"
              width={120}
              height={44}
            />
            <span
              className="absolute -top-4 -right-6 text-lg font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
            >
              pay
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Watch Demo Link */}
            <a
              href="https://www.loom.com/share/fc8337f8a7ed407fa59d68cbdb11fc6f"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-gray-600 hover:text-gray-900 font-medium text-sm transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-current">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
              </svg>
              Watch Demo
            </a>

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
                className="font-semibold px-6 py-2.5 rounded-xl transition-all duration-300 hover:scale-105 hover:opacity-90 text-white border-0"
                style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                onClick={handleRequestAccess}
              >
                Request Access
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

      {/* Access Requested Success Modal */}
      {showAccessRequested && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowAccessRequested(false)}>
          <div
            className="bg-white rounded-[24px] w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-8 text-center">
              {/* Success Icon */}
              <div className="flex justify-center mb-6">
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(16,185,129,0.15) 100%)' }}
                >
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-green-500">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              {/* Title */}
              <h2 className="text-2xl font-semibold text-gray-900 mb-3">
                You're on the list!
              </h2>

              {/* Message */}
              <p className="text-gray-600 mb-2">
                Thanks for your interest in Loofta Pay!
              </p>
              <p className="text-gray-500 text-sm mb-6">
                We'll notify you at <span className="font-medium text-gray-700">{email}</span> as soon as we're ready for you.
              </p>

              {/* Party emoji decoration */}
              <div className="flex justify-center gap-2 mb-6">
                <span className="text-3xl">🎉</span>
              </div>

              {/* CTA Button */}
              <button
                onClick={() => setShowAccessRequested(false)}
                className="w-full py-3.5 rounded-xl font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


