CREATE TABLE IF NOT EXISTS project_tasks (
    profile_id TEXT NOT NULL,
    task_key TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    scope_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    task_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL DEFAULT '',
    end_date TEXT NOT NULL DEFAULT '',
    time_spent_sec REAL NOT NULL DEFAULT 0,
    time_estimated_sec REAL NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    sync_token TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(profile_id, task_key)
);

CREATE INDEX IF NOT EXISTS idx_project_tasks_plan
    ON project_tasks(profile_id, done, end_date, priority);
