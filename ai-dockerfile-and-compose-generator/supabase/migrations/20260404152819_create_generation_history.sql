CREATE TABLE IF NOT EXISTS generation_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now() NOT NULL,
  session_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('github', 'language')),
  input_value text NOT NULL,
  provider text NOT NULL,
  network_type text NOT NULL DEFAULT 'bridge',
  language text,
  framework text,
  detected_ports integer[],
  dockerfile text,
  compose text,
  repo_url text,
  error_message text
);

ALTER TABLE generation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_by_session" ON generation_history
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_gen_history_session ON generation_history(session_id);
CREATE INDEX IF NOT EXISTS idx_gen_history_created ON generation_history(created_at DESC);