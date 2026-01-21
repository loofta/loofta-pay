'use client';

import { useState, useCallback } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';

export interface PayButtonProps {
  /** Organization ID (required) - use 'demo' for testing */
  organizationId: string;
  /** Payment amount (optional) */
  amount?: number | string;
  /** Button background color (optional) */
  buttonBgColor?: string;
  /** Checkout page background color (optional - falls back to org settings) */
  pageBgColor?: string;
  /** @deprecated Use buttonBgColor instead */
  bgColor?: string;
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
 * Loofta Pay Button Component
 * 
 * A customizable payment button that opens Loofta Pay checkout.
 * 
 * @example
 * ```tsx
 * <PayButton 
 *   organizationId="your-org-id"
 *   amount={100}
 *   buttonText="Pay $100"
 *   onSuccess={(id) => console.log('Payment:', id)}
 * />
 * ```
 */
export function PayButton({
  organizationId,
  amount,
  buttonBgColor,
  pageBgColor,
  bgColor, // deprecated, use buttonBgColor
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

  // Use buttonBgColor, fall back to deprecated bgColor
  const effectiveButtonBgColor = buttonBgColor || bgColor;

  const getCheckoutUrl = useCallback(() => {
    const baseUrl = typeof window !== 'undefined' 
      ? `${window.location.origin}/checkout`
      : 'https://loofta.pay/checkout';
    
    const params = new URLSearchParams();
    params.set('organizationId', organizationId);
    if (amount) params.set('amount', String(amount));
    if (pageBgColor) params.set('bgColor', encodeURIComponent(pageBgColor));
    if (callbackUrl) params.set('callback', encodeURIComponent(callbackUrl));
    
    return `${baseUrl}?${params.toString()}`;
  }, [organizationId, amount, pageBgColor, callbackUrl]);

  const handleClick = useCallback(() => {
    if (disabled || loading || paid) return;
    
    setLoading(true);
    const url = getCheckoutUrl();

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
  }, [disabled, loading, paid, getCheckoutUrl, openMode, onSuccess]);

  // Success state style (green)
  const successStyle = {
    ...DEFAULT_STYLE,
    background: 'linear-gradient(to right, #10B981, #059669)',
    boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25)',
    cursor: 'default',
  };

  const buttonStyle = {
    ...DEFAULT_STYLE,
    ...(effectiveButtonBgColor ? { background: effectiveButtonBgColor } : {}),
    ...(isHovered && !disabled && !paid ? HOVER_STYLE : {}),
    ...(disabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
  };

  return (
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
  );
}

/**
 * Generate embed code for PayButton
 */
export function generateEmbedCode(props: Partial<PayButtonProps>): string {
  const { organizationId, amount, buttonBgColor, pageBgColor, callbackUrl, buttonText } = props;
  
  const propsStr = [
    `organizationId="${organizationId || 'your-org-id'}"`,
    amount ? `amount={${amount}}` : null,
    buttonBgColor ? `buttonBgColor="${buttonBgColor}"` : null,
    pageBgColor ? `pageBgColor="${pageBgColor}"` : null,
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

/**
 * Generate script embed code (for non-React sites)
 */
export function generateScriptEmbed(props: Partial<PayButtonProps>): string {
  const { organizationId, amount, buttonBgColor, pageBgColor, callbackUrl, buttonText } = props;

  return `<!-- Loofta Pay Button -->
<script src="https://loofta.pay/sdk/loofta-pay.js"></script>
<div 
  id="loofta-pay-button"
  data-organization-id="${organizationId || 'your-org-id'}"
  ${amount ? `data-amount="${amount}"` : ''}
  ${buttonBgColor ? `data-button-bg-color="${buttonBgColor}"` : ''}
  ${pageBgColor ? `data-page-bg-color="${pageBgColor}"` : ''}
  ${buttonText ? `data-button-text="${buttonText}"` : ''}
  ${callbackUrl ? `data-callback="${callbackUrl}"` : ''}
></div>
<script>
  LooftaPay.mount('#loofta-pay-button');
</script>`;
}

export default PayButton;
