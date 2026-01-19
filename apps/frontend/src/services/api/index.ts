/**
 * API Services
 * 
 * Centralized exports for all backend API services.
 * 
 * Usage:
 * ```ts
 * // Import specific service
 * import { organizationsApi } from '@/services/api';
 * 
 * // Or import specific functions
 * import { getOrganizationByReferral } from '@/services/api/organizations';
 * 
 * // Or import everything
 * import { api } from '@/services/api';
 * api.organizations.getByReferral('code');
 * ```
 */

// Re-export all services
export * from './client';
export * from './organizations';
export * from './claims';
export * from './payments';
export * from './tokens';
export * from './lottery';
export * from './checkout';
export * from './adminClaims';
export * from './payroll';

// Import for unified API object
import { organizationsApi } from './organizations';
import { claimsApi } from './claims';
import { paymentsApi } from './payments';
import { tokensApi } from './tokens';
import { lotteryApi } from './lottery';
import { checkoutApi } from './checkout';
import { adminClaimsApi } from './adminClaims';
import { payrollApi } from './payroll';
import { BACKEND_URL, fetchApi } from './client';

/**
 * Unified API object for convenient access
 */
export const api = {
  organizations: organizationsApi,
  claims: claimsApi,
  payments: paymentsApi,
  tokens: tokensApi,
  lottery: lotteryApi,
  checkout: checkoutApi,
  adminClaims: adminClaimsApi,
  payroll: payrollApi,
  // Direct access
  fetch: fetchApi,
  BACKEND_URL,
};

export default api;
