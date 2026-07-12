-- Short share-link code for lottery_gifts, mirroring payments.short_id: a public 8-char id used
-- for the /gift/:id share + claim URLs instead of the long claim_token UUID.
ALTER TABLE public.lottery_gifts ADD COLUMN IF NOT EXISTS short_id text;

CREATE UNIQUE INDEX IF NOT EXISTS lottery_gifts_short_id_idx
  ON public.lottery_gifts (short_id) WHERE short_id IS NOT NULL;

-- Backfill existing rows (base62, 8 chars, retry on collision) so old gifts get shareable links too.
DO $$
DECLARE
  r RECORD;
  candidate text;
  alphabet text := '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
BEGIN
  FOR r IN SELECT id FROM public.lottery_gifts WHERE short_id IS NULL LOOP
    LOOP
      candidate := '';
      FOR i IN 1..8 LOOP
        candidate := candidate || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.lottery_gifts WHERE short_id = candidate);
    END LOOP;
    UPDATE public.lottery_gifts SET short_id = candidate WHERE id = r.id;
  END LOOP;
END $$;
