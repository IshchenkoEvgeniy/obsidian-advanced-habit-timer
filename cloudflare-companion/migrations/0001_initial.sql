CREATE TABLE IF NOT EXISTS companion_config (
    profile_id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL DEFAULT '',
    timezone TEXT NOT NULL DEFAULT 'Europe/Kyiv',
    language TEXT NOT NULL DEFAULT 'ru',
    habits_json TEXT NOT NULL DEFAULT '[]',
    morning_enabled INTEGER NOT NULL DEFAULT 0,
    morning_time TEXT NOT NULL DEFAULT '08:00',
    evening_enabled INTEGER NOT NULL DEFAULT 0,
    evening_time TEXT NOT NULL DEFAULT '22:00',
    weekly_enabled INTEGER NOT NULL DEFAULT 0,
    last_morning_date TEXT NOT NULL DEFAULT '',
    last_evening_date TEXT NOT NULL DEFAULT '',
    last_weekly_key TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS habit_values (
    profile_id TEXT NOT NULL,
    habit_name TEXT NOT NULL,
    habit_date TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0,
    state TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, habit_name, habit_date)
);

CREATE INDEX IF NOT EXISTS idx_habit_values_date
    ON habit_values(profile_id, habit_date);

CREATE TABLE IF NOT EXISTS active_timers (
    profile_id TEXT PRIMARY KEY,
    habit_name TEXT NOT NULL,
    started_at INTEGER,
    elapsed_seconds INTEGER NOT NULL DEFAULT 0,
    target_seconds INTEGER,
    timer_state TEXT NOT NULL DEFAULT 'running',
    start_time TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS companion_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    profile_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    habit_name TEXT NOT NULL,
    habit_date TEXT NOT NULL,
    amount REAL,
    state TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    acknowledged_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_companion_events_sync
    ON companion_events(profile_id, sequence);

CREATE TABLE IF NOT EXISTS telegram_updates (
    update_id INTEGER PRIMARY KEY,
    processed_at INTEGER NOT NULL
);
