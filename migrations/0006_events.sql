ALTER TABLE screenings RENAME TO events;
ALTER TABLE polls RENAME COLUMN screening_id TO event_id;
ALTER TABLE vote_codes RENAME COLUMN screening_id TO event_id;
ALTER TABLE votes RENAME COLUMN screening_id TO event_id;
DROP INDEX IF EXISTS votes_screening_idx;
CREATE INDEX IF NOT EXISTS votes_event_idx ON votes(event_id);
