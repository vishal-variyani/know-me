CREATE TABLE memory_entries (
  id                 uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            uuid         NOT NULL,
  content            text         NOT NULL,
  embedding          vector(1536) NOT NULL,
  fact_type          text         NOT NULL CHECK (fact_type IN ('preference','relationship','event','belief','goal','habit')),
  confidence         float        NOT NULL DEFAULT 0.5 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  last_reinforced_at timestamptz  NOT NULL DEFAULT now(),
  is_active          boolean      NOT NULL DEFAULT true,
  source_type        text         NOT NULL CHECK (source_type IN ('conversation','document')),
  supersedes         uuid         NULL REFERENCES memory_entries(id),
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE memory_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_memory_entries"
  ON memory_entries
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_memory_entries_user_id ON memory_entries (user_id);

CREATE INDEX idx_memory_entries_vector
  ON memory_entries
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
