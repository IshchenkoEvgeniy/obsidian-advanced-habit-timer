CREATE TABLE project_scopes (profile_id TEXT PRIMARY KEY, data_json TEXT NOT NULL);
CREATE TABLE project_documents (
 profile_id TEXT NOT NULL, task_key TEXT NOT NULL, data_json TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0,
 deleted INTEGER NOT NULL DEFAULT 0, sync_token TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(profile_id, task_key)
);
ALTER TABLE active_timers ADD COLUMN task_json TEXT;
