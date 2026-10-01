CREATE INDEX IF NOT EXISTS idx_companion_events_pending_project
    ON companion_events(profile_id, habit_name)
    WHERE acknowledged_at IS NULL
      AND event_type IN ('project_change', 'project_timer');
