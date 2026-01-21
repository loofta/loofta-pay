-- =============================================================================
-- LOOFTA SWAP - Seed Data for Local Development
-- This file adds test data after migrations run
-- =============================================================================

-- Insert admin user (if not exists from migrations)
INSERT INTO public.users (privy_user_id, role, email)
VALUES ('did:privy:cmi521k5500p4k00cd2uxmhxf', 'admin', NULL)
ON CONFLICT (privy_user_id) DO UPDATE SET role = 'admin';

-- Create the 'logos' storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'logos',
  'logos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (drop first to avoid conflicts)
DROP POLICY IF EXISTS "Allow authenticated users to upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access to logos" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update logos" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete logos" ON storage.objects;

CREATE POLICY "Allow authenticated users to upload logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'logos');

CREATE POLICY "Allow public read access to logos"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'logos');

CREATE POLICY "Allow authenticated users to update logos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'logos');

CREATE POLICY "Allow authenticated users to delete logos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'logos');

-- =============================================================================
-- Add any test data below for local development
-- =============================================================================

-- Production organization (exported from prod)
INSERT INTO public.organizations (id, organization_id, name, logo_url, checkout_status, org_referral, recipient_wallet, token_symbol, token_chain, bg_color)
VALUES (
  '6be941fd-0d01-40c3-9b27-22067793e591',
  'theinternettoken',
  'Internet Token',
  'https://rfxzswjefgxwgmjvcckf.supabase.co/storage/v1/object/public/logos/organizations/theinternettoken_1768386052213.png',
  'active',
  'org_bjgds0xyjt9n0ybo',
  '0xEC523839fd5Aa275115d382A996Db616A3a7465F',
  'USDC',
  'base',
  '#001C5C'
)
ON CONFLICT (organization_id) DO NOTHING;

-- Demo organization for SDK testing
-- Note: recipient_wallet should be empty by default - users configure it locally
INSERT INTO public.organizations (organization_id, name, logo_url, checkout_status, org_referral, recipient_wallet, token_symbol, token_chain, bg_color)
VALUES (
  'demo',
  'Demo Store',
  NULL,
  'active',
  'org_demo123456789012',
  NULL,
  'USDC',
  'base',
  '#FFFFFF'
)
ON CONFLICT (organization_id) DO NOTHING;
