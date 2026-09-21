import { findLibraryDuplicate, getLibraryCollections, getLibrarySuggestions, nextSeriesIndex } from './db';
import { zonedParts } from './time';
import type { CompanionConfigRow, Env } from './types';

const collections = ['book', 'course', 'manga', 'film', 'anime', 'series', 'game'];
const categories = ['thought', 'link', 'idea', 'task', 'quote'];
const units = ['pages', 'lessons', 'chapters', 'episodes', 'minutes', 'hours', 'items', 'units'];
const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const list = (value: unknown) => [...new Set((Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
  .filter((v): v is string => typeof v === 'string').map(v => v.trim().slice(0, 150)).filter(Boolean))].slice(0, 30);
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export async function creationOptions(env: Env, profileId: string): Promise<Response> {
  const [existing, authors, genres, series, recent] = await Promise.all([
    getLibraryCollections(env.DB, profileId),
    getLibrarySuggestions(env.DB, profileId, 'authors', '', 100),
    getLibrarySuggestions(env.DB, profileId, 'genres', '', 100),
    getLibrarySuggestions(env.DB, profileId, 'series', '', 100),
    env.DB.prepare(`SELECT event_type, habit_name, habit_date, payload_json, acknowledged_at FROM companion_events
      WHERE profile_id = ? AND event_type IN ('capture', 'library_create') ORDER BY sequence DESC LIMIT 15`).bind(profileId).all<{
        event_type: string; habit_name: string; habit_date: string; payload_json: string; acknowledged_at: number | null;
      }>()
  ]);
  return json({ collections: [...new Set([...collections, ...existing.map(c => c.collection_id)])], authors, genres, series,
    recent: (recent.results || []).map(row => {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(row.payload_json); } catch { /* Legacy malformed event. */ }
      return { type: row.event_type, title: row.habit_name || text(payload.text, 250), category: text(payload.category, 20),
        date: row.habit_date, synced: row.acknowledged_at !== null };
    }) });
}

export async function createFromWebApp(request: Request, env: Env, profileId: string, config: CompanionConfigRow, kind: 'capture' | 'library_create'): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const requestId = text(body.requestId, 80);
  if (!/^[a-f0-9-]{36}$/i.test(requestId)) return json({ error: 'invalid_request_id' }, 400);
  const eventId = `miniapp:${profileId}:${requestId}`;
  if (await env.DB.prepare('SELECT sequence FROM companion_events WHERE profile_id = ? AND event_id = ?').bind(profileId, eventId).first()) {
    return json({ ok: true, queued: true });
  }
  const { date, time } = zonedParts(Date.now(), config.timezone);
  let payload: Record<string, unknown>;
  if (kind === 'capture') {
    const category = text(body.category, 20);
    const content = text(body.text, 10000);
    const link = text(body.url, 2000);
    if (!categories.includes(category) || (!content && !link)) return json({ error: 'empty_capture' }, 400);
    if (link && !validUrl(link)) return json({ error: 'invalid_url' }, 400);
    if (category === 'link' && !link) return json({ error: 'invalid_url' }, 400);
    payload = { category, text: [content, link].filter(Boolean).join('\n'), time, source: '' };
  } else {
    const title = text(body.title, 250);
    const collectionId = text(body.collectionId, 40);
    const existing = await getLibraryCollections(env.DB, profileId);
    if (!title || ![...collections, ...existing.map(c => c.collection_id)].includes(collectionId)) return json({ error: 'invalid_media' }, 400);
    const authors = list(body.authors);
    const total = Number(body.total || 0);
    const series = text(body.series, 150);
    const seriesIndex = body.seriesIndex === '' || body.seriesIndex === undefined ? await nextSeriesIndex(env.DB, profileId, series) : Number(body.seriesIndex);
    const unit = text(body.unit, 20);
    const coverUrl = text(body.coverUrl, 2000);
    if (!Number.isFinite(total) || total < 0 || !Number.isFinite(seriesIndex) || seriesIndex < 0 || !units.includes(unit)) return json({ error: 'invalid_amount' }, 400);
    if (coverUrl && !validUrl(coverUrl)) return json({ error: 'invalid_url' }, 400);
    if (body.allowDuplicate !== true) {
      const duplicate = await findLibraryDuplicate(env.DB, profileId, title, authors);
      if (duplicate) return json({ error: 'duplicate', title: duplicate.title }, 409);
      const pending = await env.DB.prepare(`SELECT habit_name FROM companion_events WHERE profile_id = ? AND event_type = 'library_create'
        AND acknowledged_at IS NULL AND habit_name = ?`).bind(profileId, title).first();
      if (pending) return json({ error: 'duplicate', title }, 409);
    }
    const format = text(body.format, 100);
    payload = { title, collectionId, authors, genres: list(body.genres), series, seriesIndex, format, total,
      unit: /audio|аудио/i.test(format) ? 'minutes' : unit, coverUrl, status: text(body.status, 100) || 'В планах' };
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO companion_events
    (event_id, profile_id, event_type, habit_name, habit_date, amount, state, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`).bind(eventId, profileId, kind, payload.title || '', date, JSON.stringify(payload), Date.now()).run();
  return json({ ok: true, queued: true });
}

function validUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
