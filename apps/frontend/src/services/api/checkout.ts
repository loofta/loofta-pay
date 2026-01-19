/**
 * Checkout API Service
 * 
 * High-level checkout flow operations.
 * Combines organization, claim, and payment operations
 * for the checkout use case.
 */

import { getOrganizationByReferral, getOrganizationByOrganizationId } from './organizations';
import { createClaim, getClaimWithLatestIntent } from './claims';
import { requestDeposit, getQuote, getStatus, pollStatus } from './payments';
import type { Organization, PublicOrganization } from './organizations';
import type { Claim, ClaimIntent, CreateClaimInput } from './claims';
import type { DepositRequest, DepositResult, QuoteRequest, QuoteResult, IntentStatus } from './payments';

// ===========================================
// Types
// ===========================================

export interface CheckoutSession {
  organization: PublicOrganization;
  claim?: Claim;
  intent?: ClaimIntent | null;
}

export interface CheckoutInitParams {
  organizationId?: string;
  referralCode?: string;
}

export interface PaymentFlowParams {
  claimId: string;
  fromToken: DepositRequest['fromToken'];
  amount: string;
  userAddress?: string;
  orgReferral?: string;
}

// ===========================================
// Checkout Flow Functions
// ===========================================

/**
 * Initialize a checkout session by loading organization details
 */
export async function initCheckout(params: CheckoutInitParams): Promise<CheckoutSession> {
  let organization: PublicOrganization;

  if (params.organizationId) {
    const result = await getOrganizationByOrganizationId(params.organizationId);
    organization = {
      name: result.organization.name,
      logo_url: result.organization.logo_url,
      bg_color: result.organization.bg_color,
      checkout_status: result.organization.checkout_status,
      token_symbol: result.organization.token_symbol || undefined,
      token_chain: result.organization.token_chain || undefined,
    };
  } else if (params.referralCode) {
    organization = await getOrganizationByReferral(params.referralCode);
  } else {
    throw new Error('Either organizationId or referralCode is required');
  }

  if (organization.checkout_status !== 'active') {
    throw new Error('This organization\'s checkout is currently inactive');
  }

  return { organization };
}

/**
 * Create a payment claim as part of checkout
 */
export async function createCheckoutClaim(
  session: CheckoutSession,
  params: Omit<CreateClaimInput, 'toSel'> & {
    toSymbol?: string;
    toChain?: string;
  }
): Promise<CheckoutSession> {
  const claim = await createClaim({
    ...params,
    toSel: {
      symbol: params.toSymbol || session.organization.token_symbol || 'USDC',
      chain: params.toChain || session.organization.token_chain || 'base',
    },
  });

  return {
    ...session,
    claim: claim.claim,
  };
}

/**
 * Start the payment flow for a checkout
 */
export async function startPaymentFlow(params: PaymentFlowParams): Promise<DepositResult> {
  return requestDeposit({
    claimId: params.claimId,
    fromToken: params.fromToken,
    amount: params.amount,
    userAddress: params.userAddress,
    orgReferral: params.orgReferral,
  });
}

/**
 * Get a quote for the checkout payment
 */
export async function getCheckoutQuote(params: QuoteRequest): Promise<QuoteResult> {
  return getQuote(params);
}

/**
 * Monitor payment status
 */
export async function monitorPayment(
  depositAddress: string,
  options: {
    interval?: number;
    timeout?: number;
    onUpdate?: (status: IntentStatus) => void;
  } = {}
): Promise<IntentStatus> {
  return pollStatus({ depositAddress }, options);
}

/**
 * Get current checkout status
 */
export async function getCheckoutStatus(claimId: string): Promise<CheckoutSession & { status: IntentStatus | null }> {
  const { claim, intent } = await getClaimWithLatestIntent(claimId);

  let status: IntentStatus | null = null;
  if (intent?.deposit_address) {
    try {
      status = await getStatus({ depositAddress: intent.deposit_address });
    } catch {
      // Status might not be available yet
    }
  }

  return {
    organization: {} as PublicOrganization, // Would need to be loaded separately
    claim,
    intent,
    status,
  };
}

// ===========================================
// Default export
// ===========================================

export const checkoutApi = {
  init: initCheckout,
  createClaim: createCheckoutClaim,
  startPayment: startPaymentFlow,
  getQuote: getCheckoutQuote,
  monitorPayment,
  getStatus: getCheckoutStatus,
};
