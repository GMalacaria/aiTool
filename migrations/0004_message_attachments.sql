-- JSON: text extracted from attached documents and the names of attached
-- images. Original files and images are never stored.
ALTER TABLE messages ADD COLUMN attachments TEXT;
