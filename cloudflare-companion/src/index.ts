import { acknowledgeEvents, getConfig, getEvents, parseHabits, pushSnapshot, replaceLibrarySnapshot } from './db';
import { createSnapshots, formatValue } from './stats';
import { weekKey, zonedParts } from './time';
import { TelegramBot } from './telegram';
import type { Env, ExecutionContext, LibrarySyncItem, ScheduledController, SyncPushBody, TelegramUpdate } from './types';
import { handleWebAppApi } from './webapp-api';
import { webAppHtml } from './webapp';
import { handleCoverRequest } from './covers';
import { syncBoard, type BoardTask, type BoardScope } from './project-board';
import { dailyTasksApi } from './daily-tasks';
import { sendTaskReminders } from './task-reminders';
import { reconcileHabitTasks } from './habit-tasks';

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/covers/') && (request.method === 'GET' || request.method === 'HEAD')) {
      return handleCoverRequest(request, env.COVERS);
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      const config = await getConfig(env.DB, profile(env));
      return json({ ok: true, configured: Boolean(config), version: 5 });
    }

    if (request.method === 'POST' && url.pathname === '/telegram') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) return json({ error: 'unauthorized' }, 401);
      const update = await request.json() as TelegramUpdate;
      context.waitUntil(new TelegramBot(env).handleUpdate(update));
      return json({ ok: true });
    }

    if (request.method === 'GET' && (url.pathname === '/app' || url.pathname === '/app/')) {
      return new Response(webAppHtml(), { headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://telegram.org; img-src 'self' https: data:; connect-src 'self'; style-src 'unsafe-inline'"
      } });
    }
    if (url.pathname.startsWith('/app/api/')) return handleWebAppApi(request, env, profile(env));

    if (url.pathname.startsWith('/api/') && !authorized(request, env)) return json({ error: 'unauthorized' }, 401);
    if (url.pathname === '/api/tasks') {
      const config = await getConfig(env.DB, profile(env));
      return config ? dailyTasksApi(request, env, profile(env), config) : json({error:'not_configured'},503);
    }
    if (request.method === 'POST' && url.pathname === '/api/sync/projects') {
      const body = await request.json() as { tasks: BoardTask[]; scopes: BoardScope[] };
      if (!Array.isArray(body.tasks) || !Array.isArray(body.scopes)) return json({error:'invalid_payload'},400);
      await syncBoard(env.DB,profile(env),body.tasks,body.scopes);
      return json({ok:true,tasks:body.tasks.length,scopes:body.scopes.length});
    }
    if (request.method === 'GET' && url.pathname === '/api/covers/status') return json({ enabled: Boolean(env.COVERS) });
    if (request.method === 'POST' && url.pathname === '/api/covers/link') {
      const body = await request.json() as { path?: string; coverUrl?: string };
      if (typeof body.path !== 'string' || typeof body.coverUrl !== 'string'
        || !body.coverUrl.startsWith(`${url.origin}/covers/`)
        || !/^[a-f0-9]{64}$/.test(body.coverUrl.slice(`${url.origin}/covers/`.length))) {
        return json({ error: 'invalid_payload' }, 400);
      }
      const hash = body.coverUrl.split('/').at(-1);
      if (!env.COVERS || !await env.COVERS.head(`covers/${hash}.webp`)) return json({ error: 'cover_not_found' }, 404);
      const item = await env.DB.prepare('SELECT id FROM library_items WHERE profile_id = ? AND item_path = ?')
        .bind(profile(env), body.path).first();
      if (!item) return json({ error: 'item_not_found' }, 404);
      await env.DB.prepare('UPDATE library_items SET cover_url = ? WHERE profile_id = ? AND item_path = ?')
        .bind(body.coverUrl, profile(env), body.path).run();
      return json({ ok: true });
    }
    if (url.pathname.startsWith('/api/covers/') && request.method === 'POST') return handleCoverRequest(request, env.COVERS);

    if (request.method === 'POST' && url.pathname === '/api/setup') {
      const webhookUrl = `${url.origin}/telegram`;
      const result = await telegramApi(env, 'setWebhook', {
        url: webhookUrl,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true
      });
      await telegramApi(env, 'setMyCommands', { commands: [
        { command: 'menu', description: 'Open habit control center' },
        { command: 'today', description: 'Today habits' },
        { command: 'timer', description: 'Start a timer' },
        { command: 'status', description: 'Timer status' },
        { command: 'habit', description: 'Habit map' },
        { command: 'day', description: 'Daily summary image' },
        { command: 'library', description: 'Open media library' },
        { command: 'reading', description: 'Current media' },
        { command: 'search', description: 'Search library' },
        { command: 'addmedia', description: 'Add media to Obsidian' },
        { command: 'editmedia', description: 'Edit media' },
        { command: 'capture', description: 'Capture to daily note' },
        { command: 'plan', description: 'Build today plan' },
        { command: 'week', description: 'Weekly review image' }
      ] });
      const menu = await telegramApi(env, 'setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'Приложение', web_app: { url: `${url.origin}/app` } }
      });
      return json({ ok: result.ok && menu.ok, webhookUrl, telegram: result.data, menu: menu.data }, result.ok && menu.ok ? 200 : 502);
    }

    if (request.method === 'POST' && url.pathname === '/api/discover-chat') {
      const result = await telegramApi(env, 'getUpdates', { timeout: 0, allowed_updates: ['message'] });
      const response = result.data as { result?: Array<{ message?: { chat?: { id?: number | string } } }> } | null;
      const updates = response?.result || [];
      const chatId = [...updates].reverse().find(item => item.message?.chat?.id !== undefined)?.message?.chat?.id;
      return chatId !== undefined ? json({ ok: true, chatId: String(chatId) }) : json({ ok: false, error: 'no_chat_found' }, 404);
    }

    if (request.method === 'POST' && url.pathname === '/api/sync/push') {
      const body = await request.json() as SyncPushBody;
      if (!validPush(body)) return json({ error: 'invalid_payload' }, 400);
      await pushSnapshot(env.DB, profile(env), body);
      const [libraryCount, projectCount] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) AS count FROM library_items WHERE profile_id = ?')
          .bind(profile(env)).first<{ count: number }>(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM project_tasks WHERE profile_id = ?')
          .bind(profile(env)).first<{ count: number }>()
      ]);
      return json({
        ok: true,
        acceptedValues: body.values.length,
        acceptedLibraryItems: body.library?.length || 0,
        acceptedProjectTasks: body.projects?.length || 0,
        libraryItemCount: Number(libraryCount?.count) || 0,
        projectTaskCount: Number(projectCount?.count) || 0,
        serverTime: Date.now()
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/sync/library') {
      const body = await request.json() as { library?: LibrarySyncItem[] };
      if (!Array.isArray(body.library)) return json({ error: 'invalid_payload' }, 400);
      await replaceLibrarySnapshot(env.DB, profile(env), body.library);
      const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM library_items WHERE profile_id = ?')
        .bind(profile(env)).first<{ count: number }>();
      return json({ ok: true, acceptedLibraryItems: body.library.length, libraryItemCount: Number(count?.count) || 0 });
    }

    if (request.method === 'GET' && url.pathname === '/api/sync/events') {
      const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
      const events = await getEvents(env.DB, profile(env), after);
      return json({ ok: true, events, nextCursor: events.at(-1)?.sequence || after });
    }

    if (request.method === 'POST' && url.pathname === '/api/sync/ack') {
      const body = await request.json() as { through?: number };
      const through = Math.max(0, Number(body.through) || 0);
      await acknowledgeEvents(env.DB, profile(env), through);
      return json({ ok: true, through });
    }

    return json({ error: 'not_found' }, 404);
  },

  async scheduled(controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(runScheduled(env, controller.scheduledTime));
  }
};

async function runScheduled(env: Env, timestamp: number): Promise<void> {
  const config = await getConfig(env.DB, profile(env));
  if (!config || !config.chat_id) return;
  const bot = new TelegramBot(env);
  await bot.checkTargetTimer(config);
  const local = zonedParts(timestamp, config.timezone);
  try { await reconcileHabitTasks(env,profile(env),config,timestamp); }
  catch(error) { console.error('Habit task generation failed',error); }
  try { await sendTaskReminders(env,profile(env),config,timestamp); }
  catch(error) { console.error('Task reminders failed',error); }

  if (config.morning_enabled && local.time >= config.morning_time && config.last_morning_date !== local.date) {
    await env.DB.prepare('UPDATE companion_config SET last_morning_date=? WHERE profile_id=?').bind(local.date, profile(env)).run();
    const habits = parseHabits(config).filter(habit => (habit.createdAt || '0000-00-00') <= local.date);
    const lines = [config.language === 'ru' ? `Доброе утро! План на ${local.date}:` : `Good morning! Plan for ${local.date}:`];
    for (const habit of habits) {
      const snapshot = createSnapshots([habit], [], local.date, 1)[0];
      const goal = snapshot?.days[0]?.desired || 0;
      lines.push(`- ${habit.name}: ${formatValue(habit, goal)}`);
    }
    lines.push('',await bot.taskSummary(config,local.date,false));
    await sendText(env, config.chat_id, lines.join('\n'));
  }

  if (config.evening_enabled && local.time >= config.evening_time && config.last_evening_date !== local.date) {
    await env.DB.prepare('UPDATE companion_config SET last_evening_date=? WHERE profile_id=?').bind(local.date, profile(env)).run();
    await bot.sendDailyReport(config);
  }

  const currentWeek = weekKey(local.date);
  if (config.weekly_enabled && local.weekday === 'sun' && local.time >= config.evening_time && config.last_weekly_key !== currentWeek) {
    await env.DB.prepare('UPDATE companion_config SET last_weekly_key=? WHERE profile_id=?').bind(currentWeek, profile(env)).run();
    await bot.sendWeeklyReview(config);
  }
}

function validPush(body: SyncPushBody): boolean {
  return Boolean(body && typeof body.chatId === 'string' && typeof body.timezone === 'string'
    && (body.language === 'ru' || body.language === 'en') && Array.isArray(body.habits)
    && Array.isArray(body.values) && (body.library === undefined || Array.isArray(body.library))
    && (body.projects === undefined || Array.isArray(body.projects))
    && body.notifications);
}

function authorized(request: Request, env: Env): boolean {
  const expected = env.COMPANION_API_TOKEN;
  const actual = request.headers.get('Authorization');
  return Boolean(expected) && actual === `Bearer ${expected}`;
}

async function telegramApi(env: Env, method: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: unknown }> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  let data: unknown = null;
  try { data = await response.json(); } catch { /* Telegram can return an empty gateway response. */ }
  return { ok: response.ok, data };
}

async function sendText(env: Env, chatId: string, text: string): Promise<void> {
  await telegramApi(env, 'sendMessage', { chat_id: chatId, text });
}

function profile(env: Env): string { return env.PROFILE_ID || 'default'; }
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
