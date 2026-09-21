CREATE TABLE IF NOT EXISTS library_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL,
    item_path TEXT NOT NULL,
    title TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL DEFAULT '',
    rating TEXT NOT NULL DEFAULT '',
    total REAL NOT NULL DEFAULT 0,
    progress REAL NOT NULL DEFAULT 0,
    authors_json TEXT NOT NULL DEFAULT '[]',
    genres_json TEXT NOT NULL DEFAULT '[]',
    series TEXT NOT NULL DEFAULT '',
    series_index REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL DEFAULT '',
    end_date TEXT NOT NULL DEFAULT '',
    reading_status TEXT NOT NULL DEFAULT '',
    finished_status TEXT NOT NULL DEFAULT '',
    search_text TEXT NOT NULL DEFAULT '',
    sync_token TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    UNIQUE(profile_id, item_path)
);

CREATE INDEX IF NOT EXISTS idx_library_items_collection
    ON library_items(profile_id, collection_id, title);

CREATE INDEX IF NOT EXISTS idx_library_items_status
    ON library_items(profile_id, status);
