-- Payroll payment runs, entries, intents, and audit events
-- Enables creating payment runs (individual or bulk), one intent per entry via NEAR Intents, and operator audit log.

-- Payment run (batch)
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.payroll_organizations(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_deposit', 'processing', 'completed', 'failed', 'cancelled')),
  total_entries INTEGER NOT NULL DEFAULT 0,
  completed_entries INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_org ON public.payroll_runs(organization_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_status ON public.payroll_runs(status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_created_at ON public.payroll_runs(created_at DESC);

-- Run entry (one per recipient)
CREATE TABLE IF NOT EXISTS public.payroll_run_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  contributor_id UUID NOT NULL REFERENCES public.payroll_contributors(id) ON DELETE CASCADE,
  amount TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  network TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'intent_created', 'pending_deposit', 'processing', 'completed', 'failed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_run_entries_run ON public.payroll_run_entries(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_run_entries_status ON public.payroll_run_entries(status);

-- Intent per entry (quote/deposit from NEAR Intents)
CREATE TABLE IF NOT EXISTS public.payroll_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_entry_id UUID NOT NULL REFERENCES public.payroll_run_entries(id) ON DELETE CASCADE UNIQUE,
  quote_id TEXT,
  deposit_address TEXT,
  memo TEXT,
  deadline TIMESTAMPTZ,
  status TEXT,
  last_status_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_intents_entry ON public.payroll_intents(payroll_run_entry_id);
CREATE INDEX IF NOT EXISTS idx_payroll_intents_deposit ON public.payroll_intents(deposit_address) WHERE deposit_address IS NOT NULL;

-- Audit events (operator log)
CREATE TABLE IF NOT EXISTS public.payroll_events (
  id BIGSERIAL PRIMARY KEY,
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  payroll_run_entry_id UUID REFERENCES public.payroll_run_entries(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_events_run ON public.payroll_events(payroll_run_id, created_at DESC);

-- RLS
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_run_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_events ENABLE ROW LEVEL SECURITY;

-- Runs: org members can read; owners/admins can insert/update (same as contributors)
CREATE POLICY "Members can view payroll runs"
  ON public.payroll_runs FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.payroll_org_members WHERE organization_id = payroll_runs.organization_id AND user_id = current_setting('request.jwt.claims', true)::json->>'sub')
    OR EXISTS (SELECT 1 FROM public.payroll_organizations WHERE id = payroll_runs.organization_id AND owner_id = current_setting('request.jwt.claims', true)::json->>'sub')
  );

CREATE POLICY "Admins can manage payroll runs"
  ON public.payroll_runs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.payroll_organizations WHERE id = payroll_runs.organization_id AND owner_id = current_setting('request.jwt.claims', true)::json->>'sub')
    OR EXISTS (SELECT 1 FROM public.payroll_org_members WHERE organization_id = payroll_runs.organization_id AND user_id = current_setting('request.jwt.claims', true)::json->>'sub' AND role IN ('owner', 'admin'))
  );

-- Entries and intents: same as runs (access via run -> org)
CREATE POLICY "Members can view payroll run entries"
  ON public.payroll_run_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.payroll_runs r
      WHERE r.id = payroll_run_entries.payroll_run_id
      AND (EXISTS (SELECT 1 FROM public.payroll_org_members m WHERE m.organization_id = r.organization_id AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub')
           OR EXISTS (SELECT 1 FROM public.payroll_organizations o WHERE o.id = r.organization_id AND o.owner_id = current_setting('request.jwt.claims', true)::json->>'sub'))
    )
  );

CREATE POLICY "Admins can manage payroll run entries"
  ON public.payroll_run_entries FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.payroll_runs r
      WHERE r.id = payroll_run_entries.payroll_run_id
      AND (EXISTS (SELECT 1 FROM public.payroll_organizations o WHERE o.id = r.organization_id AND o.owner_id = current_setting('request.jwt.claims', true)::json->>'sub')
           OR EXISTS (SELECT 1 FROM public.payroll_org_members m WHERE m.organization_id = r.organization_id AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub' AND m.role IN ('owner', 'admin')))
    )
  );

CREATE POLICY "Members can view payroll intents"
  ON public.payroll_intents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.payroll_run_entries e
      JOIN public.payroll_runs r ON r.id = e.payroll_run_id
      WHERE e.id = payroll_intents.payroll_run_entry_id
      AND (EXISTS (SELECT 1 FROM public.payroll_org_members m WHERE m.organization_id = r.organization_id AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub')
           OR EXISTS (SELECT 1 FROM public.payroll_organizations o WHERE o.id = r.organization_id AND o.owner_id = current_setting('request.jwt.claims', true)::json->>'sub'))
    )
  );

CREATE POLICY "Admins can manage payroll intents"
  ON public.payroll_intents FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.payroll_run_entries e
      JOIN public.payroll_runs r ON r.id = e.payroll_run_id
      WHERE e.id = payroll_intents.payroll_run_entry_id
      AND (EXISTS (SELECT 1 FROM public.payroll_organizations o WHERE o.id = r.organization_id AND o.owner_id = current_setting('request.jwt.claims', true)::json->>'sub')
           OR EXISTS (SELECT 1 FROM public.payroll_org_members m WHERE m.organization_id = r.organization_id AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub' AND m.role IN ('owner', 'admin')))
    )
  );

CREATE POLICY "Members can view payroll events"
  ON public.payroll_events FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.payroll_org_members m WHERE m.organization_id = (SELECT organization_id FROM public.payroll_runs WHERE id = payroll_events.payroll_run_id) AND m.user_id = current_setting('request.jwt.claims', true)::json->>'sub')
    OR EXISTS (SELECT 1 FROM public.payroll_runs r WHERE r.id = payroll_events.payroll_run_id AND EXISTS (SELECT 1 FROM public.payroll_organizations o WHERE o.id = r.organization_id AND o.owner_id = current_setting('request.jwt.claims', true)::json->>'sub'))
  );

CREATE POLICY "System can insert payroll events"
  ON public.payroll_events FOR INSERT
  WITH CHECK (true);

-- Trigger updated_at for runs and entries
CREATE TRIGGER trg_payroll_runs_updated_at
  BEFORE UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_payroll_run_entries_updated_at
  BEFORE UPDATE ON public.payroll_run_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_payroll_intents_updated_at
  BEFORE UPDATE ON public.payroll_intents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.payroll_runs IS 'Payroll payment runs (batch of payments to execute via NEAR Intents)';
COMMENT ON TABLE public.payroll_run_entries IS 'One entry per recipient in a run';
COMMENT ON TABLE public.payroll_intents IS 'One intent per entry: quote/deposit address from NEAR Intents API';
COMMENT ON TABLE public.payroll_events IS 'Operator audit log: what happened, when, why';
