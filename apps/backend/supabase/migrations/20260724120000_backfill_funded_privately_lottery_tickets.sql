-- Backfill: every lottery_tickets row created before funded_privately existed was, in practice,
-- always paid via a private MagicBlock transfer (the public route is new) — the previous
-- migration's DEFAULT false undersold that history. Only touches rows still at that default;
-- application code sets funded_privately explicitly on every insert going forward, so this can't
-- clobber a real public purchase made after the app-level fix went live.
UPDATE lottery_tickets SET funded_privately = true WHERE funded_privately = false;
