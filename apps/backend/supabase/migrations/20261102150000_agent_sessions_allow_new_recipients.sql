-- A session the person chose to let pay people it has not paid before without asking (still inside the
-- session's own per-payment, daily and auto-approve limits). Off by default.
ALTER TABLE public.agent_sessions ADD COLUMN IF NOT EXISTS allow_new_recipients BOOLEAN NOT NULL DEFAULT false;
