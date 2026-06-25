ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS ata_migrated_mainnet BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS ata_migrated_devnet BOOLEAN NOT NULL DEFAULT false;
