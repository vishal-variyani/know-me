CREATE TABLE conversation_messages (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id uuid        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL,
  role            text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_conversation_messages"
  ON conversation_messages
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_conversation_messages_user_id ON conversation_messages (user_id);
