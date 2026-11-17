-- What each user chose to share about themselves, to tailor the answers.
-- It survives chat deletion and is removed only with the account. Every change
-- is kept as a version, so nothing is lost and any change can be undone.
CREATE TABLE user_context (
  user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  -- 1: not used in answers and not updated automatically.
  paused INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_context_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  -- auto: noticed in a message; request: the user asked in the chat; manual: edited in Profilo;
  -- undo / restore: an earlier content brought back.
  source TEXT NOT NULL CHECK (source IN ('auto', 'request', 'manual', 'undo', 'restore')),
  -- One short sentence saying what changed, shown to the user.
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX user_context_versions_user ON user_context_versions (user_id, id);

-- The context change made while answering a message, shown under the answer with "Annulla".
ALTER TABLE messages ADD COLUMN context_update TEXT;
