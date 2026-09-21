CREATE TABLE IF NOT EXISTS daily_tasks (
 profile_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, data_json TEXT NOT NULL,
 PRIMARY KEY(profile_id,id)
);
CREATE TABLE IF NOT EXISTS daily_task_requests (
 profile_id TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(profile_id,id)
);
