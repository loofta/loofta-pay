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

-- Example test organization:
-- INSERT INTO public.organizations (organization_id, name, org_referral, checkout_status)
-- VALUES ('test-org', 'Test Organization', 'test-ref-123', 'active')
-- ON CONFLICT (organization_id) DO NOTHING;
