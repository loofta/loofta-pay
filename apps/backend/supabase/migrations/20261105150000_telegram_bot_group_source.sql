-- A payment started in a group is confirmed in the person's private chat. These remember the group message,
-- so only the outcome (never fees or balance) is posted back there.
ALTER TABLE telegram_bot_actions ADD COLUMN IF NOT EXISTS source_chat_id BIGINT;
ALTER TABLE telegram_bot_actions ADD COLUMN IF NOT EXISTS source_message_id BIGINT;
