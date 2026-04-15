CREATE TABLE conversations (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid        NOT NULL,
  title      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_conversations"
  ON conversations
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_conversations_user_id ON conversations (user_id);
