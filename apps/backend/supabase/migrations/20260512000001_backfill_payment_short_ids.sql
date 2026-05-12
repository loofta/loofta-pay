-- Backfill short_id for all payments that don't have one yet.
-- Assigns a unique 8-char alphanumeric code to each; retries on collision.
DO $$
DECLARE
  alphabet  TEXT := '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  rec       RECORD;
  candidate TEXT;
  i         INT;
BEGIN
  FOR rec IN SELECT id FROM public.payments WHERE short_id IS NULL ORDER BY created_at LOOP
    LOOP
      candidate := '';
      FOR i IN 1..8 LOOP
        candidate := candidate || substr(alphabet, (floor(random() * 62))::INT + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.payments WHERE short_id = candidate);
    END LOOP;
    UPDATE public.payments SET short_id = candidate WHERE id = rec.id;
  END LOOP;
END $$;
