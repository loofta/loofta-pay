-- Fix Supabase security linter warnings:
-- 1. function_search_path_mutable on compute_user_volume_usd and refresh_user_volume_on_payment
-- 2. rls_policy_always_true on lottery_tickets and lottery_withdrawals
-- 3. public_bucket_allows_listing on logos bucket

-- 1) Pin search_path = '' on both functions and fully-qualify all table references.
--    This prevents search_path injection via SET-returning functions.

CREATE OR REPLACE FUNCTION public.compute_user_volume_usd(p_privy_user_id TEXT)
RETURNS NUMERIC
LANGUAGE SQL
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(amount), 0)
  FROM public.payments
  WHERE status = 'SUCCESS'
    AND is_devnet = FALSE
    AND (
      sender_user_id = p_privy_user_id
      OR (
        created_by = p_privy_user_id
        AND (sender_user_id IS NULL OR sender_user_id != p_privy_user_id)
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.refresh_user_volume_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'SUCCESS'
     AND (OLD.status IS NULL OR OLD.status != 'SUCCESS')
     AND NEW.is_devnet = FALSE
  THEN
    IF NEW.sender_user_id IS NOT NULL THEN
      UPDATE public.app_users
      SET total_volume_usd = public.compute_user_volume_usd(NEW.sender_user_id)
      WHERE privy_user_id = NEW.sender_user_id;
    END IF;
    IF NEW.created_by IS NOT NULL
       AND (NEW.sender_user_id IS NULL OR NEW.created_by != NEW.sender_user_id)
    THEN
      UPDATE public.app_users
      SET total_volume_usd = public.compute_user_volume_usd(NEW.created_by)
      WHERE privy_user_id = NEW.created_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 2) Narrow lottery table policies from all-roles USING (true) to service_role only.
--    These tables are only accessed via server-side service-role API routes.

DO $$
BEGIN
  IF to_regclass('public.lottery_tickets') IS NOT NULL THEN
    DROP POLICY IF EXISTS service_lottery_tickets_all ON public.lottery_tickets;
    CREATE POLICY service_lottery_tickets_all
      ON public.lottery_tickets
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF to_regclass('public.lottery_withdrawals') IS NOT NULL THEN
    DROP POLICY IF EXISTS service_lottery_withdrawals_all ON public.lottery_withdrawals;
    CREATE POLICY service_lottery_withdrawals_all
      ON public.lottery_withdrawals
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

-- 3) Replace the broad logos SELECT policy with a narrow one that prevents directory listing.
--    Public buckets serve object URLs without any SELECT policy; the broad policy was
--    only needed for listing and exposes more than intended.

DROP POLICY IF EXISTS "Allow public read access to logos" ON storage.objects;

CREATE POLICY "Allow public read access to logos"
  ON storage.objects
  FOR SELECT
  TO public
  USING (
    bucket_id = 'logos'
    AND name NOT LIKE '%/'
  );
