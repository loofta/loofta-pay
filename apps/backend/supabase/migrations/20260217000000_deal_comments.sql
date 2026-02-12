-- Deal comments: anyone with access to the deal (org or invitee) can add and view comments

CREATE TABLE IF NOT EXISTS public.deal_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_comments_deal ON public.deal_comments(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_comments_created ON public.deal_comments(created_at ASC);

ALTER TABLE public.deal_comments ENABLE ROW LEVEL SECURITY;

-- Allow read/write for users who can access the deal (org members or invitees via RLS on deals)
-- We use service role in backend so RLS may not apply; if using anon key we'd need policies.
-- For NestJS backend using service role, RLS is typically bypassed. Add policies for direct Supabase client use:
CREATE POLICY "Org members and invitees can view deal comments"
  ON public.deal_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = deal_comments.deal_id
      AND (
        EXISTS (SELECT 1 FROM public.payroll_organizations o WHERE o.id = d.organization_id AND o.owner_id = current_setting('request.jwt.claims', true)::json->>'sub')
        OR EXISTS (SELECT 1 FROM public.payroll_org_members m WHERE m.organization_id = d.organization_id AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub')
        OR EXISTS (
          SELECT 1 FROM public.deal_invites di
          JOIN public.freelancer_profiles fp ON fp.id = di.freelancer_profile_id AND fp.user_id = current_setting('request.jwt.claims', true)::json->>'sub'
          WHERE di.deal_id = d.id
        )
      )
    )
  );

CREATE POLICY "Org members and invitees can insert deal comments"
  ON public.deal_comments FOR INSERT
  WITH CHECK (
    author_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    AND EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = deal_comments.deal_id
      AND (
        EXISTS (SELECT 1 FROM public.payroll_organizations o WHERE o.id = d.organization_id AND o.owner_id = current_setting('request.jwt.claims', true)::json->>'sub')
        OR EXISTS (SELECT 1 FROM public.payroll_org_members m WHERE m.organization_id = d.organization_id AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub')
        OR EXISTS (
          SELECT 1 FROM public.deal_invites di
          JOIN public.freelancer_profiles fp ON fp.id = di.freelancer_profile_id AND fp.user_id = current_setting('request.jwt.claims', true)::json->>'sub'
          WHERE di.deal_id = d.id
        )
      )
    )
  );

COMMENT ON TABLE public.deal_comments IS 'Comments on a deal; visible to org and invited freelancer';