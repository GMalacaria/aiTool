-- Image generation: a separate daily allowance and the generated images.
-- The image files live in R2 (key = images.id); only the owner can read them.
ALTER TABLE users ADD COLUMN daily_image_limit INTEGER NOT NULL DEFAULT 3;
ALTER TABLE daily_usage ADD COLUMN images INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN image_id TEXT;

CREATE TABLE generated_images (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX generated_images_conversation ON generated_images (conversation_id);
CREATE INDEX generated_images_user ON generated_images (user_id);
