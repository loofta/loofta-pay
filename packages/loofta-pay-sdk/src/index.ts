/**
 * @loofta/pay-sdk
 *
 * Embeddable Pay Button that opens your Loofta Pay checkout (uses your API when checkout runs on your domain).
 *
 * @example
 * ```tsx
 * import { PayButton } from '@loofta/pay-sdk';
 *
 * <PayButton
 *   organizationId="your-org-id"
 *   amount={100}
 *   checkoutBaseUrl="https://pay.yoursite.com"
 *   onSuccess={(id) => console.log('Paid:', id)}
 * />
 * ```
 */

export {
  PayButton,
  generateEmbedCode,
  generateScriptEmbed,
  type PayButtonProps,
} from './PayButton';
