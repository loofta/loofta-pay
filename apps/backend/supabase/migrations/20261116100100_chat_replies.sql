-- Replies on takes. A reply points at the take it answers (always the top-level one, never a reply to a reply).
-- When the author of a take replies to it, that reply is an update: the feed shows the original take plus the latest update
-- instead of a pile of new posts. Server only: the table already has RLS on and no access for anon or authenticated.

ALTER TABLE public.coin_chat_messages ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.coin_chat_messages(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_coin_chat_parent_created ON public.coin_chat_messages(parent_id, created_at) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coin_chat_top_created ON public.coin_chat_messages(created_at DESC) WHERE parent_id IS NULL;
