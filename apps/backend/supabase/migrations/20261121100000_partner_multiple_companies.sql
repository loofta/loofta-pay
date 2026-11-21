-- A person can run more than one company, so the owner no longer has to be unique. The app caps it (5 per person).
DROP INDEX IF EXISTS public.partners_owner_idx;
CREATE INDEX IF NOT EXISTS partners_owner_idx ON public.partners (owner_user_id);
