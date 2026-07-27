-- Singleton settings row for the Mystery Pack feature — currently just the daily per-user open
-- cap (null = no limit). The `id boolean PRIMARY KEY DEFAULT true CHECK (id)` trick guarantees
-- at most one row can ever exist, since only id=true satisfies the check constraint.
CREATE TABLE IF NOT EXISTS pack_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  daily_open_limit integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO pack_settings (id, daily_open_limit) VALUES (true, NULL)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE pack_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pack_settings FROM anon, authenticated;
