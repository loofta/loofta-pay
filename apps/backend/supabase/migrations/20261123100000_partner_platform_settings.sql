-- Loofta's own withdrawal fee on partner payouts, editable from the admin dashboard. One row only: the
-- `id boolean ... CHECK (id)` trick means no second row can ever exist. The backend falls back to $0.05 + 0.3%
-- when the row is missing, so the withdraw flow never depends on this table being filled in.
CREATE TABLE IF NOT EXISTS public.partner_platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  loofta_fee_flat_usd numeric(10,6) NOT NULL DEFAULT 0.05 CHECK (loofta_fee_flat_usd >= 0 AND loofta_fee_flat_usd <= 2),
  loofta_fee_bps integer NOT NULL DEFAULT 30 CHECK (loofta_fee_bps >= 0 AND loofta_fee_bps <= 300),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.partner_platform_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Security: all access goes through service-role API routes
ALTER TABLE public.partner_platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_platform_settings FROM anon, authenticated;
