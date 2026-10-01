ALTER TABLE polls ADD COLUMN voting TEXT NOT NULL DEFAULT 'scheduled';
ALTER TABLE polls ADD COLUMN start_at TEXT;
ALTER TABLE polls ADD COLUMN stop_at TEXT;

UPDATE polls
SET
  start_at = (SELECT start_at FROM screenings WHERE screenings.id = polls.screening_id),
  stop_at = (SELECT stop_at FROM screenings WHERE screenings.id = polls.screening_id),
  voting = COALESCE((SELECT voting FROM screenings WHERE screenings.id = polls.screening_id), 'scheduled')
WHERE start_at IS NULL OR stop_at IS NULL;
