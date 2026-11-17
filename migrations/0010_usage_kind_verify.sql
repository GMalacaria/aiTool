-- Sources checked afterwards, on the user's request, are logged as their own kind.
-- SQLite cannot change a CHECK constraint: the table is rebuilt with the same data.
CREATE TABLE usage_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'deep', 'document', 'image', 'error', 'verify')),
  mode TEXT NOT NULL CHECK (mode IN ('paid', 'free')),
  paid_input_tokens INTEGER NOT NULL DEFAULT 0,
  paid_output_tokens INTEGER NOT NULL DEFAULT 0,
  free_input_tokens INTEGER NOT NULL DEFAULT 0,
  free_output_tokens INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  served_by TEXT NOT NULL DEFAULT '',
  searches INTEGER NOT NULL DEFAULT 0,
  sources_cost_micro_usd INTEGER NOT NULL DEFAULT 0
);

INSERT INTO usage_events_new
  (id, user_id, day, created_at, kind, mode, paid_input_tokens, paid_output_tokens, free_input_tokens,
   free_output_tokens, images, cost_micro_usd, served_by, searches, sources_cost_micro_usd)
SELECT id, user_id, day, created_at, kind, mode, paid_input_tokens, paid_output_tokens, free_input_tokens,
       free_output_tokens, images, cost_micro_usd, served_by, searches, sources_cost_micro_usd
FROM usage_events;

DROP TABLE usage_events;
ALTER TABLE usage_events_new RENAME TO usage_events;
CREATE INDEX usage_events_user_day ON usage_events (user_id, day);
