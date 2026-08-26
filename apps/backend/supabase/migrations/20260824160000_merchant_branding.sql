-- =====================================================
-- Merchant branding for self-serve payment links, reusing the existing organizations table
-- (name, logo_url) rather than duplicating those columns onto integrators. A self-serve
-- integrator gets its own organizations row lazily, the first time it sets branding.
--
-- Branding is snapshotted onto each payments row at link-creation time (merchant_name,
-- merchant_logo_url below) so /checkout/[id] never needs to join back to organizations to
-- render it, and an already-shared link keeps showing the branding it was created with even if
-- the merchant later changes their logo.
-- =====================================================

ALTER TABLE public.integrators
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);

ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS merchant_name TEXT,
ADD COLUMN IF NOT EXISTS merchant_logo_url TEXT;
