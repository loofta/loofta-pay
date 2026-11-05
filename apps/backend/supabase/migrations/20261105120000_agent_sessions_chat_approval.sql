-- An agent session can be allowed to approve its own pending payments when the person says so in chat.
-- Off by default: approving normally happens in the Loofta app or from Telegram.
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS chat_approval BOOLEAN NOT NULL DEFAULT false;
