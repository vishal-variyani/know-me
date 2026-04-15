CREATE TABLE people (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid        NOT NULL,
  name       text        NOT NULL,
  aliases    text[],
  facts      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE people ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_people"
  ON people
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_people_user_id ON people (user_id);
