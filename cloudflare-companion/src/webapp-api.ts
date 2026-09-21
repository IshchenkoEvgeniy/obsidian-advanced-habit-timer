import {
  finishTimer, getActiveProjectTasks, getConfig, getLibraryCollections, getLibraryItem, getLibraryItems,
  getLibraryProgressEvents, getReadingItems, getTimer, getValues, parseHabits, pauseTimer,
  recordLibraryTimerSession, resumeTimer, searchLibrary, setLibraryProgress, startTimer, timerElapsed
} from './db';
import { createSnapshots } from './stats';
import { addDays, zonedParts } from './time';
import type { CompanionConfigRow, Env, HabitConfig, LibraryItemRow } from './types';
import { validateTelegramInitData } from './webapp-auth';
import { convertDailyProgress } from '../../src/library/daily-goal-value';
import { creationOptions, createFromWebApp } from './webapp-create';
import { boardApi } from './project-board';
import { sessionHistoryApi } from './session-history';
import { dailyTasksApi } from './daily-tasks';

export async function handleWebAppApi(request: Request, env: Env, profileId: string): Promise<Response> {
  const config = await getConfig(env.DB, profileId);
  if (!config) return json({ error: 'not_configured' }, 503);
  const initData = request.headers.get('Authorization')?.replace(/^tma\s+/i, '') || '';
  const session = await validateTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN, config.chat_id);
  if (!session) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url);
  if (url.pathname === '/app/api/tasks') return dailyTasksApi(request, env, profileId, config);
  if (request.method==='GET' && url.pathname==='/app/api/sessions') return sessionHistoryApi(request,env,profileId,config.timezone);
  if (url.pathname === '/app/api/projects') return boardApi(request, env, profileId, config);
  if (request.method === 'GET' && url.pathname === '/app/api/create-options') return creationOptions(env, profileId);
  if (request.method === 'POST' && url.pathname === '/app/api/capture') return createFromWebApp(request, env, profileId, config, 'capture');
  if (request.method === 'POST' && url.pathname === '/app/api/media-create') return createFromWebApp(request, env, profileId, config, 'library_create');
  if (request.method === 'GET' && url.pathname === '/app/api/state') return state(env, profileId, config, url);
  if (request.method === 'POST' && url.pathname === '/app/api/timer') return timerAction(request, env, profileId, config);
  if (request.method === 'POST' && url.pathname === '/app/api/progress') return progressAction(request, env, profileId, config);
  return json({ error: 'not_found' }, 404);
}

async function state(env: Env, profileId: string, config: CompanionConfigRow, url: URL): Promise<Response> {
  const { date } = zonedParts(Date.now(), config.timezone);
  const from = addDays(date, -13);
  const query = (url.searchParams.get('q') || '').trim().slice(0, 80);
  const collection = (url.searchParams.get('collection') || '').trim().slice(0, 40);
  const [values, current, tasks, timer, collections, library, allLibrary, events] = await Promise.all([
    getValues(env.DB, profileId, from, date), getReadingItems(env.DB, profileId, 0, 20),
    getActiveProjectTasks(env.DB, profileId, date, 20), getTimer(env.DB, profileId),
    getLibraryCollections(env.DB, profileId),
    query ? searchLibrary(env.DB, profileId, query, 40) : getLibraryItems(env.DB, profileId, collection || null, 0, 40),
    getLibraryItems(env.DB, profileId, null, 0, 1000),
    getLibraryProgressEvents(env.DB, profileId, date, date)
  ]);
  const habits = parseHabits(config);
  const snapshots = createSnapshots(habits, values, date, 14);
  return json({
    date, language: config.language,
    habits: snapshots.map(snapshot => ({
      name: snapshot.habit.name, type: snapshot.habit.type || 'timer',
      mediaCollections: [...new Set([...(snapshot.habit.mediaCollections || []), ...Object.keys(snapshot.habit.mediaGoals || {})])],
      today: snapshot.days.at(-1), streak: snapshot.currentStreak,
      rate: snapshot.completionRate, days: snapshot.days.map(day => ({ date: day.date, state: day.state, value: day.value }))
    })),
    goals: dailyGoals(habits, date, allLibrary, events),
    current: current.map(publicItem), tasks: tasks.map(task => ({
      key: task.task_key, name: task.task_name, project: task.scope_name,
      deadline: task.end_date, priority: task.priority
    })),
    timer: timer ? { ...timer, elapsed: timerElapsed(timer), media: timer.media_id ? publicItem(await getLibraryItem(env.DB, profileId, timer.media_id)) : null } : null,
    collections, library: library.map(publicItem)
  });
}

async function timerAction(request: Request, env: Env, profileId: string, config: CompanionConfigRow): Promise<Response> {
  const body = await request.json() as { action?: string; habit?: string; mediaId?: number; minutes?: number; note?: string };
  const habits = parseHabits(config);
  const action = body.action || '';
  if (action === 'start') {
    const habit = habits.find(value => value.name === body.habit && (value.type || 'timer') === 'timer');
    if (!habit) return json({ error: 'habit_not_found' }, 400);
    const mediaId = Math.max(0, Number(body.mediaId) || 0) || null;
    if (mediaId) {
      const item = await getLibraryItem(env.DB, profileId, mediaId);
      if (!item || !habitLinks(habit, item.collection_id)) return json({ error: 'media_not_linked' }, 400);
    }
    const minutes = Math.max(0, Math.min(1440, Number(body.minutes) || 0));
    const { time } = zonedParts(Date.now(), config.timezone);
    if (!await startTimer(env.DB, profileId, habit.name, minutes ? minutes * 60 : null, time, mediaId)) {
      return json({ error: 'timer_exists' }, 409);
    }
  } else if (action === 'pause') await pauseTimer(env.DB, profileId);
  else if (action === 'resume') await resumeTimer(env.DB, profileId);
  else if (action === 'finish') {
    const { date, time } = zonedParts(Date.now(), config.timezone);
    const result = await finishTimer(env.DB, profileId, date, time, false, typeof body.note==='string'?body.note.trim().slice(0,2000):'');
    if (!result) return json({ error: 'timer_not_found' }, 404);
    let needsProgress = false;
    if (result.timer.media_id) {
      const item = await getLibraryItem(env.DB, profileId, result.timer.media_id);
      if (item) {
        await recordLibraryTimerSession(env.DB, profileId, item.id, date, time, result.elapsed);
        const unit = /audio|аудио/i.test(item.format) ? 'minutes' : item.unit.toLocaleLowerCase();
        const delta = unit === 'minutes' ? result.elapsed / 60 : unit === 'hours' ? result.elapsed / 3600 : null;
        if (delta !== null) await setLibraryProgress(env.DB, profileId, item.id, item.progress + Math.round(delta * 100) / 100, date, { time, note: body.note || 'Telegram Mini App timer', sessionId: result.sessionId });
        else needsProgress = true;
      }
    }
    return json({ ok: true, elapsed: result.elapsed, mediaId: result.timer.media_id, needsProgress, sessionId:result.sessionId });
  } else return json({ error: 'invalid_action' }, 400);
  return json({ ok: true });
}

async function progressAction(request: Request, env: Env, profileId: string, config: CompanionConfigRow): Promise<Response> {
  const body = await request.json() as { id?: number; mode?: 'add' | 'exact'; value?: number; sessionId?: string; note?: string };
  const id = Math.max(0, Number(body.id) || 0);
  const value = Number(body.value);
  const item = await getLibraryItem(env.DB, profileId, id);
  if (!item || !Number.isFinite(value)) return json({ error: 'invalid_progress' }, 400);
  const { date, time } = zonedParts(Date.now(), config.timezone);
  const requested = body.mode === 'exact' ? value : item.progress + value;
  if(body.sessionId){
    const row=await env.DB.prepare('SELECT data_json FROM session_history WHERE profile_id=? AND id=?').bind(profileId,body.sessionId).first<{data_json:string}>();
    if(!row||JSON.parse(row.data_json).media?.id!==id)return json({error:'session_media_mismatch'},400);
  }
  const updated = await setLibraryProgress(env.DB, profileId, id, requested, date, { time, note: typeof body.note==='string'?body.note.slice(0,2000):'Telegram Mini App',sessionId:body.sessionId });
  return json({ ok: true, item: publicItem(updated) });
}

function dailyGoals(habits: HabitConfig[], date: string, items: LibraryItemRow[], events: Awaited<ReturnType<typeof getLibraryProgressEvents>>) {
  const goals = new Map<string, NonNullable<HabitConfig['mediaGoals']>[string]>();
  for (const habit of habits) for (const [rawId, goal] of Object.entries(habit.mediaGoals || {})) {
    const id = rawId.trim().toLocaleLowerCase();
    if (id && goal.goal > 0 && !goals.has(id)) goals.set(id, goal);
  }
  return [...goals].map(([collection, goal]) => {
    const baseline = goal.daily?.date === date ? goal.daily : undefined;
    let value = Math.max(0, baseline?.value || 0);
    const relevant = items.filter(item => item.collection_id.toLocaleLowerCase() === collection);
    if (goal.unit === 'items') value = relevant.filter(item => item.finished_status && item.status.toLocaleLowerCase() === item.finished_status.toLocaleLowerCase() && item.end_date.slice(0, 10) === date).length;
    else {
      const byPath = new Map(relevant.map(item => [item.item_path, item]));
      for (const event of events) {
        if (event.sequence <= (baseline?.throughSequence || 0)) continue;
        const item = byPath.get(event.habit_name); if (!item) continue;
        try {
          const delta = Number(JSON.parse(event.payload_json)?.progressLog?.delta);
          const unit = /audio|аудио/i.test(item.format) ? 'minutes' : item.unit || goal.unit;
          value += convertDailyProgress(delta, unit, goal.unit);
        } catch { /* Ignore malformed old events. */ }
      }
    }
    return { collection, goal: goal.goal, unit: goal.unit, value: Math.round(value * 100) / 100 };
  });
}

function publicItem(item: LibraryItemRow | null) {
  if (!item) return null;
  let authors: string[] = [];
  try { const parsed: unknown = JSON.parse(item.authors_json); authors = Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string') : []; }
  catch { /* Empty authors. */ }
  return { id: item.id, path:item.item_path, title: item.title, collection: item.collection_id, status: item.status,
    format: item.format, total: item.total, progress: item.progress, unit: item.unit,
    cover: item.cover_url, authors, series: item.series };
}

function habitLinks(habit: HabitConfig, collection: string): boolean {
  const id = collection.trim().toLocaleLowerCase();
  return (habit.mediaCollections || []).some(value => value.trim().toLocaleLowerCase() === id)
    || Object.keys(habit.mediaGoals || {}).some(value => value.trim().toLocaleLowerCase() === id);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
