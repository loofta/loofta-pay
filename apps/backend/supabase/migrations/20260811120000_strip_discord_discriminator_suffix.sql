-- Discord's legacy "#0"-style discriminator was being read verbatim off Privy's raw linked-account
-- payload and stored as-is (see users.service.ts findSocialHandle / serverAuth.ts
-- getVerifiedLiveHandle), even though Discord dropped discriminators for migrated accounts. That
-- forced senders in Send/multi-send to type "handle#0" to match, since lookups did an exact-string
-- compare against social_accounts.handle. The app code now strips a trailing "#<digits>" on every
-- read/write path — this backfills existing rows so already-connected Discord accounts benefit too.
-- Guarded against the (platform, handle) unique index: skip a row if stripping its suffix would
-- collide with another row that already has the clean handle (keep the newest, drop nothing here —
-- flag via NOTICE so it can be resolved by hand if it ever happens).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, handle, regexp_replace(handle, '#[0-9]+$', '') AS clean_handle
    FROM public.social_accounts
    WHERE platform = 'discord' AND handle ~ '#[0-9]+$'
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.social_accounts
      WHERE platform = 'discord' AND handle = r.clean_handle AND id <> r.id
    ) THEN
      RAISE NOTICE 'Skipped social_accounts.id=% (handle=%): clean handle % already taken by another row', r.id, r.handle, r.clean_handle;
    ELSE
      UPDATE public.social_accounts SET handle = r.clean_handle WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
