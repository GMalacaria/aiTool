-- Profiles, a daily budget of paid tokens, and a log of what every request cost.
ALTER TABLE users ADD COLUMN profile TEXT NOT NULL DEFAULT 'professional' CHECK (profile IN ('professional', 'student'));
ALTER TABLE users ADD COLUMN daily_token_limit INTEGER NOT NULL DEFAULT 100000;
ALTER TABLE daily_usage ADD COLUMN paid_tokens INTEGER NOT NULL DEFAULT 0;
-- 1 when the answer came from a free-tier model.
ALTER TABLE messages ADD COLUMN free_model INTEGER NOT NULL DEFAULT 0;

-- One row per chat request. No message content: only what was used and what it cost.
CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'deep', 'document', 'image', 'error')),
  mode TEXT NOT NULL CHECK (mode IN ('paid', 'free')),
  paid_input_tokens INTEGER NOT NULL DEFAULT 0,
  paid_output_tokens INTEGER NOT NULL DEFAULT 0,
  free_input_tokens INTEGER NOT NULL DEFAULT 0,
  free_output_tokens INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  served_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX usage_events_user_day ON usage_events (user_id, day);
