-- EASC chunking support on message_embeddings.
-- Adds unified semantic retrieval fields for message/document chunks.

ALTER TABLE message_embeddings
  ALTER COLUMN message_id DROP NOT NULL;

ALTER TABLE message_embeddings
  ADD COLUMN IF NOT EXISTS content text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'message'
    CHECK (source IN ('message', 'document', 'memory')),
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enriched_embedding_text text;

CREATE INDEX IF NOT EXISTS idx_message_embeddings_people
  ON message_embeddings USING GIN ((metadata -> 'people'));

CREATE INDEX IF NOT EXISTS idx_message_embeddings_date
  ON message_embeddings ((metadata ->> 'date'))
  WHERE metadata ->> 'date' IS NOT NULL;
