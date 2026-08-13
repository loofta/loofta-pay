-- Attribute each bot-created request to the integrator that created it (the @looftapay bot's
-- own integrator row), so twitter-payments.service.ts can charge the right balance at fund time
-- and derive devnet/mainnet from the same per-integrator is_devnet_only flag everything else uses.
ALTER TABLE public.twitter_payment_requests
ADD COLUMN IF NOT EXISTS integrator_id UUID REFERENCES public.integrators(id);

CREATE INDEX IF NOT EXISTS twitter_payment_requests_integrator_id_idx
ON public.twitter_payment_requests (integrator_id) WHERE integrator_id IS NOT NULL;
