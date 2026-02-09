import { useState, useCallback } from 'react';

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
  /** Callback URL after payment (optional) */
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
  /**
   * Base URL for checkout (your Loofta Pay frontend).
   * When using in another project, set this to your deployed app (e.g. https://pay.loofta.com).
   * If not set, uses current origin /checkout or Loofta default.
   */
  checkoutBaseUrl?: string;
}

const DEFAULT_STYLE: React.CSSProperties = {
  background: 'linear-gradient(to right, #FF0F00, #EAB308)',
  color: '#ffffff',
  border: 'none',
  borderRadius: '12px',
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  minWidth: '160px',
  transition: 'transform 0.2s, box-shadow 0.2s',
  boxShadow: '0 4px 14px rgba(255, 15, 0, 0.25)',
};

const HOVER_STYLE: React.CSSProperties = {
  transform: 'scale(1.02)',
  boxShadow: '0 6px 20px rgba(255, 15, 0, 0.35)',
};

function LoaderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        style={{ transformOrigin: '12px 12px' }}
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}

/**
 * Loofta Pay Button – opens your Loofta Pay checkout (same API as your app).
 */
export function PayButton({
  organizationId,
  amount,
  buttonBgColor,
  pageBgColor,
  bgColor,
  callbackUrl,
  onSuccess,
  buttonText = 'Pay with Loofta',
  successText = 'Paid Successfully',
  className,
  openMode = 'popup',
  disabled = false,
  checkoutBaseUrl,
}: PayButtonProps) {
  const [loading, setLoading] = useState(false);
  const [paid, setPaid] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const effectiveButtonBgColor = buttonBgColor || bgColor;

  const getCheckoutUrl = useCallback(() => {
    const base =
      checkoutBaseUrl != null && checkoutBaseUrl !== ''
        ? checkoutBaseUrl.replace(/\/$/, '')
        : typeof window !== 'undefined'
          ? `${window.location.origin}/checkout`
          : 'https://pay.loofta.com/checkout';

    const path = base.endsWith('/checkout') ? base : `${base}/checkout`;
    const params = new URLSearchParams();
    params.set('organizationId', organizationId);
    if (amount) params.set('amount', String(amount));
    if (pageBgColor) params.set('bgColor', encodeURIComponent(pageBgColor));
    if (callbackUrl) params.set('callback', encodeURIComponent(callbackUrl));

    return `${path}?${params.toString()}`;
  }, [checkoutBaseUrl, organizationId, amount, pageBgColor, callbackUrl]);

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

    const width = 500;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      url,
      'loofta-pay-checkout',
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
    );

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

    const checkClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkClosed);
        setLoading(false);
        window.removeEventListener('message', handleMessage);
      }
    }, 500);
  }, [disabled, loading, paid, getCheckoutUrl, openMode, onSuccess]);

  const successStyle: React.CSSProperties = {
    ...DEFAULT_STYLE,
    background: 'linear-gradient(to right, #10B981, #059669)',
    boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25)',
    cursor: 'default',
  };

  const buttonStyle: React.CSSProperties = {
    ...DEFAULT_STYLE,
    ...(effectiveButtonBgColor ? { background: effectiveButtonBgColor } : {}),
    ...(isHovered && !disabled && !paid ? HOVER_STYLE : {}),
    ...(disabled ? { opacity: 0.6, cursor: 'not-allowed' as const } : {}),
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading || paid}
      className={className}
      style={className ? undefined : paid ? successStyle : buttonStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {paid ? (
        <>
          <CheckIcon />
          {successText}
        </>
      ) : loading ? (
        <>
          <LoaderIcon />
          Processing...
        </>
      ) : (
        <>
          <PayIcon />
          {buttonText}
        </>
      )}
    </button>
  );
}

export function generateEmbedCode(props: Partial<PayButtonProps>): string {
  const { organizationId, amount, buttonBgColor, pageBgColor, callbackUrl, buttonText, checkoutBaseUrl } = props;

  const propsStr = [
    `organizationId="${organizationId || 'your-org-id'}"`,
    amount ? `amount={${amount}}` : null,
    buttonBgColor ? `buttonBgColor="${buttonBgColor}"` : null,
    pageBgColor ? `pageBgColor="${pageBgColor}"` : null,
    callbackUrl ? `callbackUrl="${callbackUrl}"` : null,
    buttonText ? `buttonText="${buttonText}"` : null,
    checkoutBaseUrl ? `checkoutBaseUrl="${checkoutBaseUrl}"` : null,
  ]
    .filter(Boolean)
    .join('\n  ');

  return `import { PayButton } from '@loofta/pay-sdk';

<PayButton
  ${propsStr}
  onSuccess={(paymentId) => {
    console.log('Payment completed:', paymentId);
  }}
/>`;
}

export function generateScriptEmbed(props: Partial<PayButtonProps>): string {
  const { organizationId, amount, buttonBgColor, pageBgColor, callbackUrl, buttonText, checkoutBaseUrl } = props;
  const base = checkoutBaseUrl || 'https://pay.loofta.com';

  return `<!-- Loofta Pay Button -->
<script src="${base}/sdk/loofta-pay.js"></script>
<div 
  id="loofta-pay-button"
  data-organization-id="${organizationId || 'your-org-id'}"
  data-checkout-base-url="${base}"
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
