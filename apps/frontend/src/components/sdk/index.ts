/**
 * Loofta Pay SDK Components
 *
 * Embeddable payment components for integrating Loofta Pay
 * into your application.
 *
 * @example
 * ```tsx
 * import { PayButton } from '@/components/sdk';
 *
 * <PayButton
 *   checkoutUrl="https://pay.loofta.com/checkout/your-short-id"
 *   onSuccess={(id) => console.log('Paid:', id)}
 * />
 * ```
 */

export {
  PayButton,
  generateEmbedCode,
  type PayButtonProps
} from './PayButton';
