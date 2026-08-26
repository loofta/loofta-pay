'use client';

import { useState, useCallback } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';

export interface PayButtonProps {
  /** A pre-built checkout URL from POST /payment-links, if you already have one on hand. Mutually
   *  exclusive with onGenerateLink — pass exactly one. Fine for a one-off/manually-shared link,
   *  but a real storefront button should almost always use onGenerateLink instead: reusing one
   *  static URL across purchases means every buyer lands on the same payment record. */
  checkoutUrl?: string;
  /** Called when the button is clicked, before opening checkout — return a fresh checkout URL.
   *  This is how a real "Buy now" button should work: one new payment link per click, not one
   *  link reused across orders. Call your OWN backend here, not Loofta's API directly — creating
   *  a link needs your API key (POST /payment-links, see /docs/receive-payments), and that key
   *  must never reach the browser. Your backend holds the key and calls Loofta; this callback
   *  just fetches the resulting URL from your backend. */
  onGenerateLink?: () => Promise<string>;
  /** Button background color (optional) */
  buttonBgColor?: string;
  /** Callback URL after payment (optional - if not set, stays on current page) */
  callbackUrl?: string;
  /** Callback function after payment (optional) */
  onSuccess?: (paymentId: string) => void;
  /** Button text (optional) */
  buttonText?: string;
  /** Success text shown after payment (optional) */
  successText?: string;
  /** Custom className for button styling */
  className?: string;
  /** Open checkout in new tab vs popup (default: popup) */
  openMode?: 'popup' | 'redirect' | 'tab';
  /** Disable button */
  disabled?: boolean;
}

// Default Loofta Pay button style
const DEFAULT_STYLE = {
  background: 'linear-gradient(to right, #FF0F00, #EAB308)',
  color: '#ffffff',
  border: 'none',
  borderRadius: '12px',
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: '600',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  minWidth: '160px',
  transition: 'transform 0.2s, box-shadow 0.2s',
  boxShadow: '0 4px 14px rgba(255, 15, 0, 0.25)',
};

const HOVER_STYLE = {
  transform: 'scale(1.02)',
  boxShadow: '0 6px 20px rgba(255, 15, 0, 0.35)',
};

/**
 * Loofta Pay Button — opens a checkout link created via POST /payment-links.
 *
 * @example Storefront pattern (recommended) — one fresh link per click, via your own backend:
 * ```tsx
 * <PayButton
 *   onGenerateLink={async () => {
 *     const res = await fetch('/api/create-checkout', { method: 'POST' });
 *     const { url } = await res.json();
 *     return url;
 *   }}
 *   buttonText="Buy now — $25"
 * />
 * ```
 *
 * @example Pre-built link (a one-off invoice, an already-generated URL):
 * ```tsx
 * <PayButton
 *   checkoutUrl="https://pay.loofta.xyz/checkout/aB3xK9pQ"
 *   buttonText="Pay $25"
 *   onSuccess={(id) => console.log('Payment:', id)}
 * />
 * ```
 */
export function PayButton({
  checkoutUrl,
  onGenerateLink,
  buttonBgColor,
  callbackUrl,
  onSuccess,
  buttonText = 'Pay with Loofta',
  successText = 'Paid Successfully',
  className,
  openMode = 'popup',
  disabled = false,
}: PayButtonProps) {
  const [loading, setLoading] = useState(false);
  const [paid, setPaid] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const withCallback = useCallback((url: string) => {
    if (!callbackUrl) return url;
    const u = new URL(url);
    u.searchParams.set('callback', callbackUrl);
    return u.toString();
  }, [callbackUrl]);

  const openCheckout = useCallback((url: string) => {
    if (openMode === 'redirect') {
      window.location.href = url;
      return;
    }

    if (openMode === 'tab') {
      window.open(url, '_blank', 'noopener,noreferrer');
      setLoading(false);
      return;
    }

    // Popup mode
    const width = 500;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      url,
      'loofta-pay-checkout',
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
    );

    // Listen for payment completion message
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'loofta-payment-success') {
        setLoading(false);
        setPaid(true);
        onSuccess?.(event.data.paymentId);
        popup?.close();
        window.removeEventListener('message', handleMessage);
      }
    };
    window.addEventListener('message', handleMessage);

    // Check if popup was closed
    const checkClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkClosed);
        setLoading(false);
        window.removeEventListener('message', handleMessage);
      }
    }, 500);
  }, [openMode, onSuccess]);

  const handleClick = useCallback(async () => {
    if (disabled || loading || paid) return;
    setGenerateError(null);
    setLoading(true);

    let url: string;
    if (onGenerateLink) {
      try {
        url = await onGenerateLink();
      } catch (e: any) {
        setLoading(false);
        setGenerateError(e?.message || 'Could not start checkout');
        return;
      }
    } else if (checkoutUrl) {
      url = checkoutUrl;
    } else {
      setLoading(false);
      setGenerateError('PayButton needs either checkoutUrl or onGenerateLink');
      return;
    }

    openCheckout(withCallback(url));
  }, [disabled, loading, paid, onGenerateLink, checkoutUrl, withCallback, openCheckout]);

  // Success state style (green)
  const successStyle = {
    ...DEFAULT_STYLE,
    background: 'linear-gradient(to right, #10B981, #059669)',
    boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25)',
    cursor: 'default',
  };

  const buttonStyle = {
    ...DEFAULT_STYLE,
    ...(buttonBgColor ? { background: buttonBgColor } : {}),
    ...(isHovered && !disabled && !paid ? HOVER_STYLE : {}),
    ...(disabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '6px' }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || loading || paid}
        className={className}
        style={className ? undefined : (paid ? successStyle : buttonStyle)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {paid ? (
          <>
            <CheckCircle2 className="w-5 h-5" />
            {successText}
          </>
        ) : loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
            {buttonText}
          </>
        )}
      </button>
      {generateError && (
        <span style={{ fontSize: '13px', color: '#EF4444' }}>{generateError}</span>
      )}
    </div>
  );
}

/**
 * Generate embed code for PayButton
 */
export function generateEmbedCode(props: Partial<PayButtonProps>): string {
  const { checkoutUrl, buttonBgColor, callbackUrl, buttonText } = props;

  const propsStr = [
    `checkoutUrl="${checkoutUrl || 'https://pay.loofta.xyz/checkout/your-short-id'}"`,
    buttonBgColor ? `buttonBgColor="${buttonBgColor}"` : null,
    callbackUrl ? `callbackUrl="${callbackUrl}"` : null,
    buttonText ? `buttonText="${buttonText}"` : null,
  ].filter(Boolean).join('\n  ');

  return `import { PayButton } from '@loofta/pay-sdk';

<PayButton
  ${propsStr}
  onSuccess={(paymentId) => {
    console.log('Payment completed:', paymentId);
  }}
/>`;
}

export default PayButton;
