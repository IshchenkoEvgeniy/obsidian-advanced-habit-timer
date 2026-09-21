CREATE TABLE IF NOT EXISTS task_reminders (
 profile_id TEXT NOT NULL, task_id TEXT NOT NULL, occurrence TEXT NOT NULL,
 sent_at INTEGER, lease_until INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(profile_id,task_id,occurrence)
);
