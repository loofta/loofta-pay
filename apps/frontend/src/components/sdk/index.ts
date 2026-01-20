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
 *   organizationId="your-org-id"
 *   amount={100}
 *   onSuccess={(id) => console.log('Paid:', id)}
 * />
 * ```
 */

export { 
  PayButton, 
  generateEmbedCode, 
  generateScriptEmbed,
  type PayButtonProps 
} from './PayButton';
