CREATE TABLE IF NOT EXISTS partner_quest_validations (
  user_id text NOT NULL,
  quest_id integer NOT NULL,
  wallet text NOT NULL,
  validated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, quest_id)
);

CREATE INDEX IF NOT EXISTS partner_quest_validations_user_id_idx ON partner_quest_validations (user_id);
CREATE INDEX IF NOT EXISTS partner_quest_validations_quest_id_idx ON partner_quest_validations (quest_id);
