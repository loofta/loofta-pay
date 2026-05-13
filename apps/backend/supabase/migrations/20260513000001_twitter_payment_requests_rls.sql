-- Enable RLS on twitter_payment_requests.
-- No policies are defined, so anon/authenticated roles have zero direct access.
-- service_role (used by the NestJS backend and Next.js API routes) bypasses RLS automatically.

ALTER TABLE public.twitter_payment_requests ENABLE ROW LEVEL SECURITY;
