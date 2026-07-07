-- Generic force-update tracking table.
-- Replaces update_jun_26; each mandatory upgrade gets its own update_id ("1", "2", ...).
CREATE TABLE IF NOT EXISTS force_update (
  user_id   text        NOT NULL,
  update_id text        NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, update_id)
);

ALTER TABLE force_update ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'force_update' AND policyname = 'service role only'
  ) THEN
    CREATE POLICY "service role only" ON force_update
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'update_jun_26') THEN
    INSERT INTO force_update (user_id, update_id, completed_at)
    SELECT user_id, '1', completed_at
    FROM update_jun_26
    ON CONFLICT (user_id, update_id) DO NOTHING;

    DROP TABLE update_jun_26;
  END IF;
END $$;
