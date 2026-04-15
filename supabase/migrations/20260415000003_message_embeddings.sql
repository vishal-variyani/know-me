CREATE TABLE message_embeddings (
  id         uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id uuid         NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  user_id    uuid         NOT NULL,
  embedding  vector(1536) NOT NULL,
  created_at timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE message_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_message_embeddings"
  ON message_embeddings
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_message_embeddings_user_id ON message_embeddings (user_id);

CREATE INDEX idx_message_embeddings_vector
  ON message_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
