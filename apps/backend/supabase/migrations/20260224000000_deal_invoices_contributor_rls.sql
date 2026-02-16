-- Allow contributors (freelancers) to SELECT deal_invoices where they are the recipient.
-- Backend should use service_role key (bypasses RLS); this policy helps when using user JWT.
CREATE POLICY "Contributor can view own deal_invoices"
  ON public.deal_invoices FOR SELECT
  USING (
    recipient_email IS NOT NULL
    AND recipient_email IN (
      SELECT fp.email FROM public.freelancer_profiles fp
      WHERE fp.user_id = (current_setting('request.jwt.claims', true)::json->>'sub')
    )
  );
