CREATE INDEX IF NOT EXISTS votes_code_poll_idx ON votes(code_hash, poll_id);
