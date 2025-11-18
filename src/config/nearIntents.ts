export const NEAR_INTENTS_REMOTE_BASE =
  process.env.NEXT_PUBLIC_NEAR_INTENTS_API_BASE || "https://api.test.near-intents.org";

// Client will call these local API routes (proxy -> remote) to avoid CORS
export const NEAR_INTENTS_ENDPOINTS = {
  tokens: `/api/near-intents/tokens`,
  intents: `/api/near-intents/intents`,
};

export const NEAR_INTENTS_TEST_MODE = true;


