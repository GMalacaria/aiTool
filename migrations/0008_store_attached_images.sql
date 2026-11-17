-- Attached images are now kept (owner's decision, 2026-11-17) so they can be
-- edited later without attaching them again. They share the table and the R2
-- bucket of generated images; `source` tells them apart.
ALTER TABLE generated_images ADD COLUMN source TEXT NOT NULL DEFAULT 'generated' CHECK (source IN ('generated', 'attached'));
ALTER TABLE generated_images ADD COLUMN name TEXT;
