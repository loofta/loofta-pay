-- Recipient groups: named lists of a partner's recipients (like a mailing list). A group can be linked to a public https
-- URL that returns the list as JSON or CSV, and Sync makes the group mirror it. Groups only hold references; they never
-- move money. A batch is still drafted, approved and paid the usual way.
CREATE TABLE IF NOT EXISTS public.partner_recipient_groups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id       UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  source_url       TEXT CHECK (source_url IS NULL OR char_length(source_url) <= 2000),
  last_synced_at   TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_count  INTEGER,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_recipient_groups_name_idx ON public.partner_recipient_groups (partner_id, lower(name));

CREATE TABLE IF NOT EXISTS public.partner_recipient_group_members (
  group_id     UUID NOT NULL REFERENCES public.partner_recipient_groups(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.partner_recipients(id) ON DELETE CASCADE,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS partner_recipient_group_members_recipient_idx ON public.partner_recipient_group_members (recipient_id);

DROP TRIGGER IF EXISTS trg_partner_recipient_groups_updated_at ON public.partner_recipient_groups;
CREATE TRIGGER trg_partner_recipient_groups_updated_at
BEFORE UPDATE ON public.partner_recipient_groups
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Security: all access goes through the backend (service role). Nothing is readable or writable from the browser.
ALTER TABLE public.partner_recipient_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_partner_recipient_groups ON public.partner_recipient_groups;
CREATE POLICY deny_all_partner_recipient_groups ON public.partner_recipient_groups FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.partner_recipient_groups FROM anon, authenticated;

ALTER TABLE public.partner_recipient_group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_partner_recipient_group_members ON public.partner_recipient_group_members;
CREATE POLICY deny_all_partner_recipient_group_members ON public.partner_recipient_group_members FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public.partner_recipient_group_members FROM anon, authenticated;
