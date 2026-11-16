-- Uploaded profile pictures for the mini app. A small square image (the app shrinks it to 256px first), kept in the row
-- and served from a public, cache-friendly URL keyed by a random token. Server only, same as the rest of mini_profiles.
ALTER TABLE public.mini_profiles ADD COLUMN IF NOT EXISTS avatar_image TEXT;
ALTER TABLE public.mini_profiles ADD COLUMN IF NOT EXISTS avatar_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mini_profiles_avatar_token ON public.mini_profiles (avatar_token) WHERE avatar_token IS NOT NULL;
ALTER TABLE public.mini_profiles DROP CONSTRAINT IF EXISTS mini_profiles_avatar_kind_check;
ALTER TABLE public.mini_profiles ADD CONSTRAINT mini_profiles_avatar_kind_check CHECK (avatar_kind IN ('telegram', 'twitter', 'color', 'upload'));
