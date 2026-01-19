-- Add payment configuration fields to organizations table
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS recipient_wallet TEXT,
ADD COLUMN IF NOT EXISTS token_symbol TEXT,
ADD COLUMN IF NOT EXISTS token_chain TEXT;

-- Add comment for documentation
COMMENT ON COLUMN organizations.recipient_wallet IS 'Wallet address where organization receives payments';
COMMENT ON COLUMN organizations.token_symbol IS 'Token symbol for receiving payments (e.g., USDT, USDC)';
COMMENT ON COLUMN organizations.token_chain IS 'Chain ID where the token is located (e.g., ethereum, base, arbitrum)';
