-- Ensure demo organization exists for SDK testing
-- This migration ensures the demo organization is available in production

INSERT INTO public.organizations (organization_id, name, logo_url, checkout_status, org_referral, recipient_wallet, token_symbol, token_chain, bg_color)
VALUES (
  'demo',
  'Demo Store',
  NULL,
  'active',
  'org_demo123456789012',
  '0xd28d8e18537a6De75900D2eafE8E718aA4A2Df11',
  'USDC',
  'base',
  '#FF0F00'
)
ON CONFLICT (organization_id) DO UPDATE SET
  name = EXCLUDED.name,
  checkout_status = EXCLUDED.checkout_status,
  recipient_wallet = EXCLUDED.recipient_wallet,
  token_symbol = EXCLUDED.token_symbol,
  token_chain = EXCLUDED.token_chain,
  bg_color = EXCLUDED.bg_color,
  updated_at = NOW();

-- Add comment
COMMENT ON TABLE public.organizations IS 'Organizations table - includes demo organization for SDK testing';
