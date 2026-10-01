ALTER TABLE vote_codes ADD COLUMN code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS vote_codes_code_idx ON vote_codes(code);
