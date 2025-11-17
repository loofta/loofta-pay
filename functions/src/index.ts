import * as functions from 'firebase-functions';
import { sendWelcomeEmail, sendPurchaseEmailEndpoint } from './emails/emailService';

// Export all functions
export {
  sendWelcomeEmail,
  sendPurchaseEmailEndpoint as sendPurchaseEmail,
};

// Export functions namespace for configuration
export const config = functions.config; 