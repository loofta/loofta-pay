-- Callout rewards: someone tails a holder's post, and when they then buy that coin the poster earns a share of their fee.
-- Server only: RLS on, no access for anon or authenticated, the backend uses the service role.

-- A person tapping Tail on a post. It opens a 24 hour window for buys of that coin.
CREATE TABLE IF NOT EXISTS public.mini_tails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tailer_privy_id TEXT NOT NULL,
  caller_privy_id TEXT NOT NULL,
  post_id UUID NOT NULL,
  mint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tailer_privy_id, post_id),
  CHECK (tailer_privy_id <> caller_privy_id)
);
CREATE INDEX IF NOT EXISTS idx_mini_tails_tailer_mint ON public.mini_tails(tailer_privy_id, mint, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_mini_tails_caller ON public.mini_tails(caller_privy_id, created_at DESC);

-- The buy that was made under a tail.
ALTER TABLE public.mini_trades ADD COLUMN IF NOT EXISTS tail_id UUID REFERENCES public.mini_tails(id);
CREATE INDEX IF NOT EXISTS idx_mini_trades_tail ON public.mini_trades(tail_id) WHERE tail_id IS NOT NULL;

-- What the poster is owed. One row per confirmed buy. Paid out by hand and marked paid with the transaction.
CREATE TABLE IF NOT EXISTS public.mini_callout_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_privy_id TEXT NOT NULL,
  tail_id UUID NOT NULL REFERENCES public.mini_tails(id),
  trade_id UUID NOT NULL UNIQUE REFERENCES public.mini_trades(id),
  mint TEXT NOT NULL,
  volume_usd NUMERIC NOT NULL,
  amount_usd NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'void')),
  note TEXT,
  paid_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mini_earn_caller ON public.mini_callout_earnings(caller_privy_id, status, created_at DESC);

ALTER TABLE public.mini_tails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mini_callout_earnings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mini_tails, public.mini_callout_earnings FROM anon, authenticated;
