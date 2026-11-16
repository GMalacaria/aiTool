-- 'document' messages hold a JSON document description in `content`.
ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'document'));
