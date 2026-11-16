-- "More in-depth answer": a separate, smaller daily allowance per user.
ALTER TABLE users ADD COLUMN daily_deep_limit INTEGER NOT NULL DEFAULT 3;
ALTER TABLE daily_usage ADD COLUMN deep_messages INTEGER NOT NULL DEFAULT 0;
