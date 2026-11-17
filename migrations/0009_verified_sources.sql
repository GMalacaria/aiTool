-- Verified sources: the legend of an answer, and what searching and checking cost.
ALTER TABLE messages ADD COLUMN sources TEXT;
-- Web search calls made for the request, and their cost (searches plus checking), included in cost_micro_usd.
ALTER TABLE usage_events ADD COLUMN searches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_events ADD COLUMN sources_cost_micro_usd INTEGER NOT NULL DEFAULT 0;
