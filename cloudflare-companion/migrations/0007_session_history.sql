ALTER TABLE active_timers ADD COLUMN session_id TEXT;
ALTER TABLE active_timers ADD COLUMN original_started_at INTEGER;
CREATE TABLE session_history (
 profile_id TEXT NOT NULL, id TEXT NOT NULL, started_at INTEGER, ended_at INTEGER NOT NULL,
 habit_name TEXT NOT NULL, duration_sec INTEGER NOT NULL, status TEXT NOT NULL,
 data_json TEXT NOT NULL, result_json TEXT,
 PRIMARY KEY(profile_id,id)
);
CREATE INDEX session_history_date ON session_history(profile_id,ended_at DESC);
