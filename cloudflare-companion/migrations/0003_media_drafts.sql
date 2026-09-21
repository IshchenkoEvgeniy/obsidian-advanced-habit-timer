CREATE TABLE IF NOT EXISTS telegram_media_drafts (
    profile_id TEXT PRIMARY KEY,
    step TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
);
