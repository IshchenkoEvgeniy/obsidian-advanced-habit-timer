import type {
  CompanionConfigRow, CompanionEventRow, D1Database, HabitConfig, HabitState,
  HabitValueRow, LibraryItemRow, LibrarySyncItem, MediaDraftRow, ProjectTaskRow, SyncPushBody, TimerRow
} from './types';
import { syncBoard, recordProjectTime } from './project-board';
import { recordSession } from './session-history';

export async function getConfig(db: D1Database, profileId: string): Promise<CompanionConfigRow | null> {
  return db.prepare('SELECT * FROM companion_config WHERE profile_id = ?').bind(profileId).first<CompanionConfigRow>();
}

export function parseHabits(config: CompanionConfigRow | null): HabitConfig[] {
  if (!config) return [];
  try {
    const parsed: unknown = JSON.parse(config.habits_json);
    return Array.isArray(parsed) ? parsed as HabitConfig[] : [];
  } catch { return []; }
}

export async function pushSnapshot(db: D1Database, profileId: string, body: SyncPushBody): Promise<void> {
  if (body.boardTasks && body.projectScopes) await syncBoard(db, profileId, body.boardTasks, body.projectScopes);
  const now = Date.now();
  const librarySyncToken = body.library ? crypto.randomUUID() : '';
  const projectsSyncToken = body.projects ? crypto.randomUUID() : '';
  const statements = [
    db.prepare(`INSERT INTO companion_config (
      profile_id, chat_id, timezone, language, habits_json,
      morning_enabled, morning_time, evening_enabled, evening_time, weekly_enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      chat_id=excluded.chat_id, timezone=excluded.timezone, language=excluded.language,
      habits_json=excluded.habits_json, morning_enabled=excluded.morning_enabled,
      morning_time=excluded.morning_time, evening_enabled=excluded.evening_enabled,
      evening_time=excluded.evening_time, weekly_enabled=excluded.weekly_enabled,
      updated_at=excluded.updated_at`).bind(
        profileId, body.chatId, body.timezone, body.language, JSON.stringify(body.habits),
        body.notifications.morningEnabled ? 1 : 0, body.notifications.morningTime,
        body.notifications.eveningEnabled ? 1 : 0, body.notifications.eveningTime,
        body.notifications.weeklyEnabled ? 1 : 0, now
      )
  ];
  for (const value of body.values) {
    statements.push(db.prepare(`INSERT INTO habit_values
      (profile_id, habit_name, habit_date, value, state, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, habit_name, habit_date) DO UPDATE SET
        value=excluded.value, state=excluded.state, updated_at=excluded.updated_at`)
      .bind(profileId, value.habitName, value.date, value.value, value.state || null, now));
  }
  for (const item of body.library || []) {
    statements.push(db.prepare(`INSERT INTO library_items (
      profile_id, item_path, title, collection_id, status, format, rating, total, progress,
      authors_json, genres_json, series, series_index, unit, cover_url, start_date, end_date,
      reading_status, finished_status, season, episode, search_text, sync_token, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, item_path) DO UPDATE SET
      title=excluded.title, collection_id=excluded.collection_id, status=excluded.status,
      format=excluded.format, rating=excluded.rating, total=excluded.total, progress=excluded.progress,
      authors_json=excluded.authors_json, genres_json=excluded.genres_json, series=excluded.series,
      series_index=excluded.series_index, unit=excluded.unit, cover_url=excluded.cover_url,
      start_date=excluded.start_date, end_date=excluded.end_date,
      reading_status=excluded.reading_status, finished_status=excluded.finished_status,
      season=excluded.season, episode=excluded.episode,
      search_text=excluded.search_text, sync_token=excluded.sync_token, updated_at=excluded.updated_at`).bind(
        profileId, item.path, item.title, item.collectionId, item.status, item.format, item.rating,
        item.total, item.progress, JSON.stringify(item.authors), JSON.stringify(item.genres),
        item.series, item.seriesIndex, item.unit, item.coverUrl, item.startDate, item.endDate,
        item.readingStatus, item.finishedStatus, item.season, item.episode,
        [item.title, ...item.authors, ...item.genres, item.series].join(' ').toLocaleLowerCase(),
        librarySyncToken, now
      ));
  }
  if (body.library) {
    statements.push(db.prepare('DELETE FROM library_items WHERE profile_id = ? AND sync_token <> ?')
      .bind(profileId, librarySyncToken));
  }
  for (const task of body.projects || []) {
    statements.push(db.prepare(`INSERT INTO project_tasks (
      profile_id, task_key, scope_id, scope_name, file_path, task_name, status, priority,
      start_date, end_date, time_spent_sec, time_estimated_sec, done, sync_token, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, task_key) DO UPDATE SET
      scope_id=excluded.scope_id, scope_name=excluded.scope_name, file_path=excluded.file_path,
      task_name=excluded.task_name, status=excluded.status, priority=excluded.priority,
      start_date=excluded.start_date, end_date=excluded.end_date,
      time_spent_sec=excluded.time_spent_sec, time_estimated_sec=excluded.time_estimated_sec,
      done=excluded.done, sync_token=excluded.sync_token, updated_at=excluded.updated_at`).bind(
        profileId, task.key, task.scopeId, task.scopeName, task.path, task.name, task.status,
        task.priority, task.startDate, task.endDate, task.timeSpentSec, task.timeEstimatedSec,
        task.done ? 1 : 0, projectsSyncToken, now
      ));
  }
  if (body.projects) {
    statements.push(db.prepare('DELETE FROM project_tasks WHERE profile_id = ? AND sync_token <> ?')
      .bind(profileId, projectsSyncToken));
  }
  for (let index = 0; index < statements.length; index += 80) {
    await db.batch(statements.slice(index, index + 80));
  }
}

export async function replaceLibrarySnapshot(
  db: D1Database, profileId: string, library: LibrarySyncItem[]
): Promise<void> {
  const now = Date.now();
  const syncToken = crypto.randomUUID();
  const statements = library.map(item => db.prepare(`INSERT INTO library_items (
      profile_id, item_path, title, collection_id, status, format, rating, total, progress,
      authors_json, genres_json, series, series_index, unit, cover_url, start_date, end_date,
      reading_status, finished_status, season, episode, search_text, sync_token, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, item_path) DO UPDATE SET
      title=excluded.title, collection_id=excluded.collection_id, status=excluded.status,
      format=excluded.format, rating=excluded.rating, total=excluded.total, progress=excluded.progress,
      authors_json=excluded.authors_json, genres_json=excluded.genres_json, series=excluded.series,
      series_index=excluded.series_index, unit=excluded.unit, cover_url=excluded.cover_url,
      start_date=excluded.start_date, end_date=excluded.end_date,
      reading_status=excluded.reading_status, finished_status=excluded.finished_status,
      season=excluded.season, episode=excluded.episode,
      search_text=excluded.search_text, sync_token=excluded.sync_token, updated_at=excluded.updated_at`).bind(
        profileId, item.path, item.title, item.collectionId, item.status, item.format, item.rating,
        item.total, item.progress, JSON.stringify(item.authors), JSON.stringify(item.genres),
        item.series, item.seriesIndex, item.unit, item.coverUrl, item.startDate, item.endDate,
        item.readingStatus, item.finishedStatus, item.season, item.episode,
        [item.title, ...item.authors, ...item.genres, item.series].join(' ').toLocaleLowerCase(),
        syncToken, now
      ));
  statements.push(db.prepare('DELETE FROM library_items WHERE profile_id = ? AND sync_token <> ?')
    .bind(profileId, syncToken));
  for (let index = 0; index < statements.length; index += 80) {
    await db.batch(statements.slice(index, index + 80));
  }
}

export async function getActiveProjectTasks(db: D1Database, profileId: string, today: string, limit = 20): Promise<ProjectTaskRow[]> {
  const result = await db.prepare(`SELECT * FROM project_tasks WHERE profile_id=? AND done=0
    ORDER BY CASE WHEN end_date <> '' AND end_date < ? THEN 0 WHEN end_date = ? THEN 1 ELSE 2 END,
      CASE LOWER(priority) WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
      end_date = '', end_date, task_name COLLATE NOCASE LIMIT ?`).bind(profileId, today, today, limit).all<ProjectTaskRow>();
  return result.results || [];
}

export async function getCompletedProjectTasks(
  db: D1Database, profileId: string, startDate: string, endDate: string
): Promise<ProjectTaskRow[]> {
  const result = await db.prepare(`SELECT * FROM project_tasks WHERE profile_id=? AND done=1
    AND end_date >= ? AND end_date <= ? ORDER BY end_date DESC`).bind(profileId, startDate, endDate).all<ProjectTaskRow>();
  return result.results || [];
}

export async function getCompletedMedia(
  db: D1Database, profileId: string, startDate: string, endDate: string
): Promise<LibraryItemRow[]> {
  const result = await db.prepare(`SELECT * FROM library_items WHERE profile_id=?
    AND end_date >= ? AND end_date <= ? ORDER BY end_date DESC`).bind(profileId, startDate, endDate).all<LibraryItemRow>();
  return result.results || [];
}

export async function getLibraryProgressEvents(
  db: D1Database, profileId: string, startDate: string, endDate: string
): Promise<CompanionEventRow[]> {
  const result = await db.prepare(`SELECT sequence, event_id, event_type, habit_name, habit_date,
    amount, state, payload_json, created_at FROM companion_events WHERE profile_id=?
    AND event_type='library_update' AND habit_date >= ? AND habit_date <= ? ORDER BY sequence ASC`)
    .bind(profileId, startDate, endDate).all<CompanionEventRow>();
  return result.results || [];
}

export async function getLibraryItem(db: D1Database, profileId: string, id: number): Promise<LibraryItemRow | null> {
  return db.prepare('SELECT * FROM library_items WHERE profile_id = ? AND id = ?')
    .bind(profileId, id).first<LibraryItemRow>();
}

export async function getLibraryItems(
  db: D1Database, profileId: string, collectionId: string | null, offset = 0, limit = 8
): Promise<LibraryItemRow[]> {
  const statement = collectionId
    ? db.prepare(`SELECT * FROM library_items WHERE profile_id = ? AND collection_id = ?
        ORDER BY title COLLATE NOCASE LIMIT ? OFFSET ?`).bind(profileId, collectionId, limit, offset)
    : db.prepare(`SELECT * FROM library_items WHERE profile_id = ?
        ORDER BY title COLLATE NOCASE LIMIT ? OFFSET ?`).bind(profileId, limit, offset);
  const result = await statement.all<LibraryItemRow>();
  return result.results || [];
}

export async function getLibraryCollections(
  db: D1Database, profileId: string
): Promise<Array<{ collection_id: string; item_count: number }>> {
  const result = await db.prepare(`SELECT collection_id, COUNT(*) AS item_count FROM library_items
    WHERE profile_id = ? GROUP BY collection_id ORDER BY collection_id COLLATE NOCASE`)
    .bind(profileId).all<{ collection_id: string; item_count: number }>();
  return result.results || [];
}

export async function getReadingItems(
  db: D1Database, profileId: string, offset = 0, limit = 8
): Promise<LibraryItemRow[]> {
  const result = await db.prepare(`SELECT * FROM library_items WHERE profile_id = ?
    AND reading_status <> '' AND LOWER(TRIM(status)) = LOWER(TRIM(reading_status))
    ORDER BY updated_at DESC, title COLLATE NOCASE LIMIT ? OFFSET ?`)
    .bind(profileId, limit, offset).all<LibraryItemRow>();
  return result.results || [];
}

export async function searchLibrary(
  db: D1Database, profileId: string, query: string, limit = 10
): Promise<LibraryItemRow[]> {
  const normalized = query.trim().toLocaleLowerCase();
  const pattern = `%${normalized}%`;
  const result = await db.prepare(`SELECT * FROM library_items WHERE profile_id = ? AND search_text LIKE ?
    ORDER BY CASE WHEN search_text LIKE ? THEN 0 ELSE 1 END, title COLLATE NOCASE LIMIT ?`)
    .bind(profileId, pattern, `${normalized}%`, limit).all<LibraryItemRow>();
  return result.results || [];
}

export async function getLibrarySuggestions(
  db: D1Database, profileId: string, kind: 'authors' | 'genres' | 'series', query = '', limit = 8
): Promise<string[]> {
  const result = await db.prepare(`SELECT authors_json, genres_json, series FROM library_items
    WHERE profile_id = ? ORDER BY updated_at DESC LIMIT 250`).bind(profileId).all<LibraryItemRow>();
  const normalized = query.trim().toLocaleLowerCase();
  const counts = new Map<string, number>();
  for (const item of result.results || []) {
    const values = kind === 'series' ? [item.series] : parseJsonStrings(kind === 'authors' ? item.authors_json : item.genres_json);
    for (const value of values.filter(Boolean)) {
      if (normalized && !value.toLocaleLowerCase().includes(normalized)) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([value]) => value);
}

export async function findLibraryDuplicate(
  db: D1Database, profileId: string, title: string, authors: string[]
): Promise<LibraryItemRow | null> {
  const normalizedTitle = title.toLocaleLowerCase();
  const result = await db.prepare('SELECT * FROM library_items WHERE profile_id = ? AND search_text LIKE ? LIMIT 50')
    .bind(profileId, `%${normalizedTitle}%`).all<LibraryItemRow>();
  const sameTitle = (result.results || []).filter(item => item.title.toLocaleLowerCase() === normalizedTitle);
  if (!sameTitle.length) return null;
  if (!authors.length) return sameTitle[0] || null;
  const expected = new Set(authors.map(value => value.toLocaleLowerCase()));
  return sameTitle.find(item => parseJsonStrings(item.authors_json).some(value => expected.has(value.toLocaleLowerCase()))) || null;
}

export async function nextSeriesIndex(db: D1Database, profileId: string, series: string): Promise<number> {
  if (!series.trim()) return 0;
  const normalized = series.trim().toLocaleLowerCase();
  const result = await db.prepare(`SELECT series, series_index FROM library_items
    WHERE profile_id = ? AND search_text LIKE ? LIMIT 250`).bind(profileId, `%${normalized}%`).all<{ series: string; series_index: number }>();
  const max = (result.results || []).filter(item => item.series.toLocaleLowerCase() === normalized)
    .reduce((value, item) => Math.max(value, Number(item.series_index) || 0), 0);
  return Math.max(1, Math.floor(max) + 1);
}

export async function getLibraryByAuthor(db: D1Database, profileId: string, author: string): Promise<LibraryItemRow[]> {
  const pattern = `%${author.toLocaleLowerCase()}%`;
  const result = await db.prepare(`SELECT * FROM library_items WHERE profile_id = ? AND search_text LIKE ?
    ORDER BY title COLLATE NOCASE LIMIT 50`).bind(profileId, pattern).all<LibraryItemRow>();
  return (result.results || []).filter(item => parseJsonStrings(item.authors_json).some(value => value.toLocaleLowerCase() === author.toLocaleLowerCase()));
}

export async function getLibraryBySeries(db: D1Database, profileId: string, series: string): Promise<LibraryItemRow[]> {
  const normalized = series.toLocaleLowerCase();
  const result = await db.prepare(`SELECT * FROM library_items WHERE profile_id = ? AND search_text LIKE ?
    ORDER BY series_index ASC, title COLLATE NOCASE LIMIT 100`).bind(profileId, `%${normalized}%`).all<LibraryItemRow>();
  return (result.results || []).filter(item => item.series.toLocaleLowerCase() === normalized);
}

export async function setLibraryProgress(
  db: D1Database, profileId: string, id: number, progressValue: number, date: string,
  details: { delta?: number; note?: string; time?: string; season?: number; episode?: number; sessionId?: string } = {}
): Promise<LibraryItemRow | null> {
  const item = await getLibraryItem(db, profileId, id);
  if (!item) return null;
  if(details.sessionId){
    const session=await db.prepare('SELECT data_json,result_json FROM session_history WHERE profile_id=? AND id=?').bind(profileId,details.sessionId).first<{data_json:string;result_json:string|null}>();
    if(!session||JSON.parse(session.data_json).media?.id!==id)throw new Error('session_media_mismatch');
    if(session.result_json)return item;
    const context=JSON.parse(session.data_json);
    date=context.date||date;
    details={...details,time:context.endTime||details.time};
  }
  const { progress, delta: actualDelta } = resolveLibraryProgress(item.progress, item.total, progressValue);
  const season = details.season ?? item.season;
  const episode = details.episode ?? item.episode;
  const now = Date.now();
  const statements = [
    db.prepare(`UPDATE library_items SET progress=?, season=?, episode=?, updated_at=? WHERE profile_id=? AND id=?`)
      .bind(progress, season, episode, now, profileId, id),
    eventStatement(db, profileId, 'library_update', item.item_path, date, progress, item.status, now, {
      path: item.item_path, progress, season, episode, progressLog: {
        date, time: details.time || '', delta: actualDelta,
        progress, total: item.total, note: details.note || '-', sessionId: details.sessionId || ''
      }
    })
  ];
  if(details.sessionId)statements.push(db.prepare('UPDATE session_history SET result_json=? WHERE profile_id=? AND id=? AND result_json IS NULL')
    .bind(JSON.stringify({delta:actualDelta,progress,total:item.total,unit:item.unit,note:details.note||'',date,time:details.time||''}),profileId,details.sessionId));
  await db.batch(statements);
  return { ...item, progress, season, episode, updated_at: now };
}

export function resolveLibraryProgress(
  current: number, total: number, requested: number
): { progress: number; delta: number } {
  const progress = Math.max(0, total > 0 ? Math.min(total, requested) : requested);
  return { progress, delta: progress - current };
}

export async function recordLibraryTimerSession(
  db: D1Database, profileId: string, id: number, date: string, time: string, durationSeconds: number
): Promise<boolean> {
  const item = await getLibraryItem(db, profileId, id);
  if (!item || durationSeconds <= 0) return false;
  const now = Date.now();
  await eventStatement(db, profileId, 'library_update', item.item_path, date, null, item.status, now, {
    path: item.item_path,
    timeSpentSeconds: Math.round(durationSeconds),
    mediaSession: { date, time, durationSeconds: Math.round(durationSeconds), note: 'Telegram timer' }
  }).run();
  return true;
}

export async function editLibraryItem(
  db: D1Database, profileId: string, id: number, changes: Record<string, unknown>, date: string
): Promise<LibraryItemRow | null> {
  const item = await getLibraryItem(db, profileId, id);
  if (!item) return null;
  const next = {
    collectionId: stringChange(changes.collectionId, item.collection_id), status: stringChange(changes.status, item.status),
    format: stringChange(changes.format, item.format), rating: stringChange(changes.rating, item.rating),
    total: numberChange(changes.total, item.total), authors: arrayChange(changes.authors, parseJsonStrings(item.authors_json)),
    genres: arrayChange(changes.genres, parseJsonStrings(item.genres_json)), series: stringChange(changes.series, item.series),
    seriesIndex: numberChange(changes.seriesIndex, item.series_index), startDate: stringChange(changes.startDate, item.start_date),
    endDate: stringChange(changes.endDate, item.end_date)
  };
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE library_items SET collection_id=?, status=?, format=?, rating=?, total=?, authors_json=?,
      genres_json=?, series=?, series_index=?, start_date=?, end_date=?, updated_at=? WHERE profile_id=? AND id=?`).bind(
        next.collectionId, next.status, next.format, next.rating, next.total, JSON.stringify(next.authors),
        JSON.stringify(next.genres), next.series, next.seriesIndex, next.startDate, next.endDate, now, profileId, id),
    eventStatement(db, profileId, 'library_update', item.item_path, date, null, next.status, now, { path: item.item_path, ...changes })
  ]);
  return getLibraryItem(db, profileId, id);
}

export async function deleteLibraryItem(db: D1Database, profileId: string, id: number, date: string): Promise<boolean> {
  const item = await getLibraryItem(db, profileId, id);
  if (!item) return false;
  await db.batch([
    db.prepare('DELETE FROM library_items WHERE profile_id=? AND id=?').bind(profileId, id),
    eventStatement(db, profileId, 'library_delete', item.item_path, date, null, null, Date.now(), { path: item.item_path })
  ]);
  return true;
}

export async function updateLibraryProgress(
  db: D1Database, profileId: string, id: number, delta: number, date: string, finish = false, time = ''
): Promise<LibraryItemRow | null> {
  const item = await getLibraryItem(db, profileId, id);
  if (!item) return null;
  const progress = finish && item.total > 0
    ? item.total
    : Math.max(0, item.total > 0 ? Math.min(item.total, item.progress + delta) : item.progress + delta);
  const status = finish ? (item.finished_status || item.status) : item.status;
  const endDate = finish ? date : item.end_date;
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE library_items SET progress = ?, status = ?, end_date = ?, updated_at = ?
      WHERE profile_id = ? AND id = ?`).bind(progress, status, endDate, now, profileId, id),
    eventStatement(db, profileId, 'library_update', item.item_path, date, progress, status, now, {
      path: item.item_path, progress, ...(finish ? { status, endDate } : {}),
      progressLog: { date, time, delta: progress - item.progress, progress, total: item.total, note: finish ? 'Completed in Telegram' : '-' }
    })
  ]);
  return { ...item, progress, status, end_date: endDate, updated_at: now };
}

export async function startLibraryItem(
  db: D1Database, profileId: string, id: number, date: string
): Promise<LibraryItemRow | null> {
  const item = await getLibraryItem(db, profileId, id);
  if (!item) return null;
  const status = item.reading_status || item.status;
  const startDate = item.start_date || date;
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE library_items SET status = ?, start_date = ?, updated_at = ?
      WHERE profile_id = ? AND id = ?`).bind(status, startDate, now, profileId, id),
    eventStatement(db, profileId, 'library_update', item.item_path, date, item.progress, status, now, {
      path: item.item_path, status, startDate
    })
  ]);
  return { ...item, status, start_date: startDate, updated_at: now };
}

export async function getMediaDraft(db: D1Database, profileId: string): Promise<MediaDraftRow | null> {
  return db.prepare('SELECT * FROM telegram_media_drafts WHERE profile_id = ?')
    .bind(profileId).first<MediaDraftRow>();
}

export async function saveMediaDraft(
  db: D1Database, profileId: string, step: string, data: Record<string, unknown>
): Promise<void> {
  await db.prepare(`INSERT INTO telegram_media_drafts (profile_id, step, data_json, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET
    step=excluded.step, data_json=excluded.data_json, updated_at=excluded.updated_at`)
    .bind(profileId, step, JSON.stringify(data), Date.now()).run();
}

export async function clearMediaDraft(db: D1Database, profileId: string): Promise<void> {
  await db.prepare('DELETE FROM telegram_media_drafts WHERE profile_id = ?').bind(profileId).run();
}

export async function createLibraryItemEvent(
  db: D1Database, profileId: string, date: string, data: Record<string, unknown>
): Promise<void> {
  const title = typeof data.title === 'string' ? data.title : '';
  await eventStatement(db, profileId, 'library_create', title, date, null, null, Date.now(), data).run();
}

export async function createCaptureEvent(
  db: D1Database, profileId: string, date: string, data: Record<string, unknown>
): Promise<void> {
  await eventStatement(db, profileId, 'capture', '', date, null, null, Date.now(), data).run();
}

export async function getValues(db: D1Database, profileId: string, startDate: string, endDate: string): Promise<HabitValueRow[]> {
  const result = await db.prepare(`SELECT * FROM habit_values
    WHERE profile_id = ? AND habit_date >= ? AND habit_date <= ?
    ORDER BY habit_date ASC`).bind(profileId, startDate, endDate).all<HabitValueRow>();
  return result.results || [];
}

export async function getValue(db: D1Database, profileId: string, habitName: string, date: string): Promise<HabitValueRow | null> {
  return db.prepare(`SELECT * FROM habit_values WHERE profile_id = ? AND habit_name = ? AND habit_date = ?`)
    .bind(profileId, habitName, date).first<HabitValueRow>();
}

export async function addHabitValue(
  db: D1Database, profileId: string, habitName: string, date: string,
  amount: number, eventType: 'add_timer' | 'add_count', payload: Record<string, unknown> = {}
): Promise<void> {
  const current = await getValue(db, profileId, habitName, date);
  const next = Math.max(0, (current?.value || 0) + amount);
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO habit_values (profile_id, habit_name, habit_date, value, state, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?)
      ON CONFLICT(profile_id, habit_name, habit_date) DO UPDATE SET
        value=excluded.value, state=NULL, updated_at=excluded.updated_at`)
      .bind(profileId, habitName, date, next, now),
    eventStatement(db, profileId, eventType, habitName, date, amount, null, now, payload)
  ]);
}

export async function setHabitValue(
  db: D1Database, profileId: string, habitName: string, date: string, value: number
): Promise<void> {
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO habit_values (profile_id, habit_name, habit_date, value, state, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?)
      ON CONFLICT(profile_id, habit_name, habit_date) DO UPDATE SET
        value=excluded.value, state=NULL, updated_at=excluded.updated_at`)
      .bind(profileId, habitName, date, value, now),
    eventStatement(db, profileId, 'set_binary', habitName, date, value, null, now)
  ]);
}

export async function setHabitState(
  db: D1Database, profileId: string, habitName: string, date: string, state: HabitState | null,
  payload: Record<string, unknown> = {}
): Promise<void> {
  const current = await getValue(db, profileId, habitName, date);
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO habit_values (profile_id, habit_name, habit_date, value, state, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, habit_name, habit_date) DO UPDATE SET
        state=excluded.state, updated_at=excluded.updated_at`)
      .bind(profileId, habitName, date, current?.value || 0, state, now),
    eventStatement(db, profileId, 'set_state', habitName, date, null, state, now, payload)
  ]);
}

function eventStatement(
  db: D1Database, profileId: string, type: string, habitName: string, date: string,
  amount: number | null, state: string | null, now: number, payload: Record<string, unknown> = {}
) {
  return db.prepare(`INSERT INTO companion_events
    (event_id, profile_id, event_type, habit_name, habit_date, amount, state, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), profileId, type, habitName, date, amount, state, JSON.stringify(payload), now);
}

export async function getTimer(db: D1Database, profileId: string): Promise<TimerRow | null> {
  return db.prepare('SELECT * FROM active_timers WHERE profile_id = ?').bind(profileId).first<TimerRow>();
}

export function timerElapsed(timer: TimerRow, now = Date.now()): number {
  const delta = timer.timer_state === 'running' && timer.started_at
    ? Math.max(0, Math.floor((now - timer.started_at) / 1000))
    : 0;
  return Math.max(0, timer.elapsed_seconds + delta);
}

export async function startTimer(
  db: D1Database, profileId: string, habitName: string, targetSeconds: number | null,
  startTime: string, mediaId: number | null = null, taskJson: string | null = null
): Promise<boolean> {
  if (await getTimer(db, profileId)) return false;
  const now = Date.now();
  await db.prepare(`INSERT INTO active_timers
    (profile_id, habit_name, started_at, elapsed_seconds, target_seconds, timer_state, start_time, updated_at, media_id, task_json, session_id, original_started_at)
    VALUES (?, ?, ?, 0, ?, 'running', ?, ?, ?, ?, ?, ?)`)
    .bind(profileId, habitName, now, targetSeconds, startTime, now, mediaId, taskJson,crypto.randomUUID(),now).run();
  return true;
}

export async function pauseTimer(db: D1Database, profileId: string): Promise<TimerRow | null> {
  const timer = await getTimer(db, profileId);
  if (!timer) return null;
  const elapsed = timerElapsed(timer);
  await db.prepare(`UPDATE active_timers SET timer_state='paused', started_at=NULL,
    elapsed_seconds=?, updated_at=? WHERE profile_id=?`).bind(elapsed, Date.now(), profileId).run();
  return { ...timer, timer_state: 'paused', started_at: null, elapsed_seconds: elapsed };
}

export async function resumeTimer(db: D1Database, profileId: string): Promise<TimerRow | null> {
  const timer = await getTimer(db, profileId);
  if (!timer) return null;
  const now = Date.now();
  await db.prepare(`UPDATE active_timers SET timer_state='running', started_at=?, updated_at=? WHERE profile_id=?`)
    .bind(now, now, profileId).run();
  return { ...timer, timer_state: 'running', started_at: now };
}

export async function finishTimer(
  db: D1Database, profileId: string, date: string, endTime: string, capToTarget = false, note = ''
): Promise<{ timer: TimerRow; elapsed: number; sessionId: string } | null> {
  const timer = await db.prepare('DELETE FROM active_timers WHERE profile_id = ? RETURNING *')
    .bind(profileId).first<TimerRow>();
  if (!timer) return null;
  const measured = timerElapsed(timer);
  const elapsed = capToTarget && timer.target_seconds ? Math.min(measured, timer.target_seconds) : measured;
  const sessionId=await recordSession(db,profileId,timer,elapsed,'completed',note);
  const linkedTask = timer.task_json ? JSON.parse(timer.task_json) : null;
  if (linkedTask?.kind === 'daily') {
    if(linkedTask.habitName)await db.prepare(`INSERT INTO habit_values(profile_id,habit_name,habit_date,value,state,updated_at) VALUES(?,?,?,?,NULL,?) ON CONFLICT(profile_id,habit_name,habit_date) DO UPDATE SET value=habit_values.value+excluded.value,state=NULL,updated_at=excluded.updated_at`)
      .bind(profileId,linkedTask.habitName,date,elapsed,Date.now()).run();
    await db.prepare(`INSERT OR IGNORE INTO companion_events(event_id,profile_id,event_type,habit_name,habit_date,payload_json,created_at) VALUES(?,?,'daily_task_session',?,?,?,?)`)
      .bind(`daily-session:${sessionId}`,profileId,linkedTask.id,date,JSON.stringify({task:linkedTask,seconds:elapsed,startTime:timer.start_time,endTime,note,sessionId}),Date.now()).run();
  } else if (linkedTask) await recordProjectTime(db, profileId, linkedTask, elapsed, date);
  if (linkedTask?.kind !== 'daily') {
  await addHabitValue(db, profileId, timer.habit_name, date, elapsed, 'add_timer', {
    startTime: timer.start_time,
    endTime,
    mode: 'Telegram',
    note: note || (timer.task_json ? JSON.parse(timer.task_json).name : '-'),sessionId
  });
  }
  return { timer: {...timer,session_id:sessionId}, elapsed, sessionId };
}

export async function cancelTimer(db: D1Database, profileId: string): Promise<boolean> {
  const timer=await db.prepare('DELETE FROM active_timers WHERE profile_id = ? RETURNING *').bind(profileId).first<TimerRow>();
  if(timer)await recordSession(db,profileId,timer,timerElapsed(timer),'cancelled');
  return Boolean(timer);
}

export async function getEvents(db: D1Database, profileId: string, after: number): Promise<CompanionEventRow[]> {
  const result = await db.prepare(`SELECT sequence, event_id, event_type, habit_name, habit_date,
    amount, state, payload_json, created_at FROM companion_events
    WHERE profile_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT 250`)
    .bind(profileId, after).all<CompanionEventRow>();
  return result.results || [];
}

export async function acknowledgeEvents(db: D1Database, profileId: string, through: number): Promise<void> {
  await db.prepare(`UPDATE companion_events SET acknowledged_at = ?
    WHERE profile_id = ? AND sequence <= ? AND acknowledged_at IS NULL`)
    .bind(Date.now(), profileId, through).run();
}

function parseJsonStrings(value: string): string[] {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []; }
  catch { return []; }
}
function stringChange(value: unknown, fallback: string): string { return typeof value === 'string' ? value : fallback; }
function numberChange(value: unknown, fallback: number): number { const parsed = Number(value); return value !== undefined && Number.isFinite(parsed) ? parsed : fallback; }
function arrayChange(value: unknown, fallback: string[]): string[] { return Array.isArray(value) ? value.filter(item => typeof item === 'string') : fallback; }
