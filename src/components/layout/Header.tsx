'use client'

import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useHistoryModal } from "@/contexts/HistoryModalContext";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePrivy } from "@privy-io/react-auth";

export function Header() {
  const { authenticated, email, logout } = useAuth();
  const { login: privyLogin } = usePrivy();
  const { openHistory } = useHistoryModal();
  const pathname = usePathname();
  const showHistory = pathname?.startsWith('/swap') === true;
  // Check if we're on a dark background page
  const isDarkPage = pathname?.startsWith('/claim') === true || pathname?.startsWith('/c/') === true;
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [showAccessRequested, setShowAccessRequested] = useState(false);
  const [pendingAccessRequest, setPendingAccessRequest] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Handle email-only login for request access
  const handleRequestAccess = () => {
    //setPendingAccessRequest(true);
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

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileMenuOpen]);

  return (
    <div ref={headerRef} className="fixed inset-x-0 top-0 z-50" style={{ backdropFilter: 'blur(10px)' }}>
      <div className="max-w-7xl mx-auto px-4 py-6 md:py-8">
        <div className="flex justify-between items-center animate-fade-in">
          <Link href="/" prefetch className="relative inline-block hover:opacity-90 transition-opacity">
            <Image
              src="/loofta.svg"
              alt="Loofta Pay"
              width={120}
              height={44}
            />
            <span
              className="absolute -top-4 -right-6 text-lg font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
            >
              pay
            </span>
          </Link>

          <div className="flex items-center gap-1">
            {/* Desktop menu items */}
            {/* Make a payment link */}
            <Link
              href="/claim"
              prefetch
              className={`hidden sm:flex items-center gap-1.5 font-medium text-sm px-4 py-2 rounded-lg transition-all ${isDarkPage
                ? 'text-white/90 hover:text-white hover:bg-white/10'
                : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                }`}
            >
              Request a payment
            </Link>
            {/* Separator */}
            <div className={`hidden sm:block h-4 w-px ${isDarkPage ? 'bg-white/20' : 'bg-gray-300'}`} />
            {/* B2B Checkout link */}
            <Link
              href="/checkout/b2b"
              prefetch
              className={`hidden sm:flex items-center gap-1.5 font-medium text-sm px-4 py-2 rounded-lg transition-all ${isDarkPage
                ? 'text-white/90 hover:text-white hover:bg-white/10'
                : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                }`}
            >
              B2B Checkout
            </Link>
            {/* Separator */}
            <div className={`hidden sm:block h-4 w-px ${isDarkPage ? 'bg-white/20' : 'bg-gray-300'}`} />
            {/* contact us link */}
            <a
              href="https://t.me/looftaxyz"
              target="_blank"
              rel="noopener noreferrer"
              className={`hidden sm:flex items-center gap-1.5 font-medium text-sm px-4 py-2 rounded-lg transition-all ${isDarkPage
                ? 'text-white/90 hover:text-white hover:bg-white/10'
                : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                }`}
            >
              Contact Us
            </a>
            {/* Separator */}
            <div className={`hidden sm:block h-4 w-px ${isDarkPage ? 'bg-white/20' : 'bg-gray-300'}`} />
            {/* Watch Demo Link */}
            <a
              href="https://www.loom.com/share/fc8337f8a7ed407fa59d68cbdb11fc6f"
              target="_blank"
              rel="noopener noreferrer"
              className={`hidden sm:flex items-center gap-1.5 font-medium text-sm px-4 py-2 rounded-lg transition-all ${isDarkPage
                ? 'text-white/90 hover:text-white hover:bg-white/10'
                : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-current">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
              </svg>
              Watch Demo
            </a>

            {showHistory && (
              <>
                <Button
                  className="hidden sm:flex bg-gray-900 hover:bg-gray-800 text-white font-semibold px-6 py-2.5 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg"
                  onClick={openHistory}
                >
                  History
                </Button>
              </>
            )}
            {!authenticated ? (
              <>
                <Button
                  className="hidden sm:flex font-semibold px-6 py-2.5 rounded-xl transition-all duration-300 hover:scale-105 hover:opacity-90 text-white border-0"
                  style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                  onClick={handleRequestAccess}
                >
                  Log In
                </Button>
                {/* Mobile burger menu button */}
                <button
                  onClick={() => setIsMobileMenuOpen(true)}
                  className={`sm:hidden p-2 rounded-lg transition-all ${isDarkPage
                    ? 'text-white hover:bg-white/10'
                    : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  aria-label="Open menu"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6"></line>
                    <line x1="3" y1="12" x2="21" y2="12"></line>
                    <line x1="3" y1="18" x2="21" y2="18"></line>
                  </svg>
                </button>
              </>
            ) : (
              <>
                <span className={`hidden sm:block text-sm px-4 py-2 ${isDarkPage ? 'text-white/90' : 'text-gray-700'}`}>{email}</span>
                <div className={`hidden sm:block h-4 w-px ${isDarkPage ? 'bg-white/20' : 'bg-gray-300'}`} />
                <Button
                  variant="outline"
                  className="hidden sm:flex font-semibold px-4 py-2 rounded-xl border-gray-300 text-gray-800 hover:bg-gray-100"
                  onClick={() => logout()}
                >
                  Log out
                </Button>
                {/* Mobile burger menu button */}
                <button
                  onClick={() => setIsMobileMenuOpen(true)}
                  className={`sm:hidden p-2 rounded-lg transition-all ${isDarkPage
                    ? 'text-white hover:bg-white/10'
                    : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  aria-label="Open menu"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6"></line>
                    <line x1="3" y1="12" x2="21" y2="12"></line>
                    <line x1="3" y1="18" x2="21" y2="18"></line>
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Menu Modal - Rendered via Portal to escape header stacking context */}
      {isMobileMenuOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] bg-white animate-in fade-in duration-200">
          <div className="flex flex-col h-full">
            {/* Header with close button */}
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <Image
                src="/loofta.svg"
                alt="Loofta Pay"
                width={100}
                height={36}
              />
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                aria-label="Close menu"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            {/* Menu items */}
            <div className="flex-1 overflow-y-auto px-4 py-6">
              <nav className="flex flex-col gap-1">
                <Link
                  href="/claim"
                  prefetch
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-900 font-medium hover:bg-gray-100 transition-colors"
                >
                  Request a payment
                </Link>

                <Link
                  href="/checkout/b2b"
                  prefetch
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-900 font-medium hover:bg-gray-100 transition-colors"
                >
                  B2B Checkout
                </Link>

                <a
                  href="https://t.me/looftaxyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-900 font-medium hover:bg-gray-100 transition-colors"
                >
                  Contact Us
                </a>

                <a
                  href="https://www.loom.com/share/fc8337f8a7ed407fa59d68cbdb11fc6f"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-900 font-medium hover:bg-gray-100 transition-colors"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-gray-600">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                    <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
                  </svg>
                  Watch Demo
                </a>

                {showHistory && (
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      openHistory();
                    }}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-900 font-medium hover:bg-gray-100 transition-colors text-left"
                  >
                    History
                  </button>
                )}

                {authenticated && (
                  <>
                    <div className="h-px bg-gray-200 my-2"></div>
                    <div className="px-4 py-2 text-sm text-gray-600">
                      {email}
                    </div>
                    <button
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        logout();
                      }}
                      className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-900 font-medium hover:bg-gray-100 transition-colors text-left"
                    >
                      Log out
                    </button>
                  </>
                )}

                {!authenticated && (
                  <>
                    <div className="h-px bg-gray-200 my-2"></div>
                    <button
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        handleRequestAccess();
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-white transition-all hover:opacity-90"
                      style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
                    >
                      Log In
                    </button>
                  </>
                )}
              </nav>
            </div>
          </div>
        </div>,
        document.body
      )}

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


