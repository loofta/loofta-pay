'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Image from 'next/image';

interface RequestAccessOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
}

export function RequestAccessOverlay({
  isOpen,
  onClose,
  title = "Request Access",
  description = "Enter your email to get early access to Loofta Pay",
}: RequestAccessOverlayProps) {
  const { login, ready } = useAuth();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleRequestAccess = async () => {
    if (!email || !email.includes('@')) return;
    setIsSubmitting(true);
    try {
      // Trigger Privy login with email - this will send a magic link
      await login();
    } catch (e) {
      console.error('Login error:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[24px] w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 pb-4 text-center">
          <div className="flex justify-center mb-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, rgba(255,15,0,0.1) 0%, rgba(234,179,8,0.1) 100%)' }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-orange-500">
                <path
                  d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="currentColor"
                  fillOpacity="0.2"
                />
                <path
                  d="M9 12l2 2 4-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
          <h2 className="text-2xl font-semibold text-gray-900">{title}</h2>
          <p className="mt-2 text-gray-500">{description}</p>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Email address
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-12 text-gray-900 placeholder:text-gray-400 border-gray-200 focus:border-orange-400 focus:ring-orange-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRequestAccess();
              }}
            />
          </div>

          <Button
            onClick={handleRequestAccess}
            disabled={!email || !email.includes('@') || isSubmitting || !ready}
            className="w-full h-12 rounded-xl font-semibold text-white border-0"
            style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
          >
            {isSubmitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                Requesting...
              </>
            ) : (
              'Request Access'
            )}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">or</span>
            </div>
          </div>

          <Button
            onClick={() => login()}
            variant="outline"
            className="w-full h-12 rounded-xl font-medium text-gray-700 border-gray-200 hover:bg-gray-50"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="mr-2">
              <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
            </svg>
            Connect Wallet
          </Button>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
          <p className="text-center text-sm text-gray-500">
            By continuing, you agree to our{' '}
            <a href="/terms" className="text-orange-500 hover:underline">Terms</a>
            {' '}and{' '}
            <a href="/privacy" className="text-orange-500 hover:underline">Privacy Policy</a>
          </p>
        </div>
      </div>
    </div>
  );
}

// Inline gate component for embedding in forms
export function RequestAccessGate({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { authenticated, ready, login } = useAuth();
  const [showOverlay, setShowOverlay] = useState(false);

  if (!ready) {
    return (
      <div className="animate-pulse">
        <div className="h-12 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (authenticated) {
    return <>{children}</>;
  }

  return (
    <>
      {fallback || (
        <button
          onClick={() => setShowOverlay(true)}
          className="w-full py-3.5 rounded-xl font-semibold text-white transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
        >
          <span className="flex items-center justify-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z"
                stroke="currentColor"
                strokeWidth="2"
                fill="currentColor"
                fillOpacity="0.2"
              />
            </svg>
            Request Access to Create
          </span>
        </button>
      )}
      <RequestAccessOverlay
        isOpen={showOverlay}
        onClose={() => setShowOverlay(false)}
      />
    </>
  );
}

