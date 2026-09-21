export interface D1Result<T = unknown> { results?: T[]; success: boolean; meta?: Record<string, unknown>; }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
export interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; }
export interface ScheduledController { scheduledTime: number; cron: string; }

export interface Env {
  COVERS?: import('./covers').CoverBucket;
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  COMPANION_API_TOKEN: string;
  PROFILE_ID?: string;
}

export type HabitType = 'timer' | 'count' | 'binary' | 'negative';
export type HabitState = 'completed' | 'partial' | 'skipped' | 'excused' | 'deferred' | 'pending' | 'missed';

export interface HabitConfig {
  id?: string;
  autoDailyTask?: boolean;
  autoDailyTaskOwner?: 'cloudflare' | 'obsidian';
  name: string;
  type?: HabitType;
  mediaCollections?: string[];
  mediaGoals?: Record<string, { goal: number; unit: string; daily?: { date: string; value: number; throughSequence: number } }>;
  createdAt?: string;
  goalMode?: 'daily' | 'weekly';
  goalMinutes?: number;
  goalCount?: number;
  minimumGoalMinutes?: number;
  minimumGoalCount?: number;
  weeklyGoalMinutes?: number;
  weeklyGoalCount?: number;
  dailyGoals?: Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', number>>;
}

export interface CompanionConfigRow {
  profile_id: string;
  chat_id: string;
  timezone: string;
  language: 'ru' | 'en';
  habits_json: string;
  morning_enabled: number;
  morning_time: string;
  evening_enabled: number;
  evening_time: string;
  weekly_enabled: number;
  last_morning_date: string;
  last_evening_date: string;
  last_weekly_key: string;
  updated_at: number;
}

export interface HabitValueRow {
  profile_id: string;
  habit_name: string;
  habit_date: string;
  value: number;
  state: HabitState | null;
  updated_at: number;
}

export interface TimerRow {
  session_id?: string | null;
  original_started_at?: number | null;
  task_json?: string | null;
  profile_id: string;
  habit_name: string;
  started_at: number | null;
  elapsed_seconds: number;
  target_seconds: number | null;
  timer_state: 'running' | 'paused';
  start_time: string;
  updated_at: number;
  media_id: number | null;
}

export interface LibrarySyncItem {
  path: string;
  title: string;
  collectionId: string;
  status: string;
  format: string;
  rating: string;
  total: number;
  progress: number;
  authors: string[];
  genres: string[];
  series: string;
  seriesIndex: number;
  unit: string;
  coverUrl: string;
  startDate: string;
  endDate: string;
  season: number;
  episode: number;
  readingStatus: string;
  finishedStatus: string;
}

export interface LibraryItemRow {
  id: number;
  profile_id: string;
  item_path: string;
  title: string;
  collection_id: string;
  status: string;
  format: string;
  rating: string;
  total: number;
  progress: number;
  authors_json: string;
  genres_json: string;
  series: string;
  series_index: number;
  unit: string;
  cover_url: string;
  start_date: string;
  end_date: string;
  reading_status: string;
  finished_status: string;
  season: number;
  episode: number;
  updated_at: number;
}

export interface MediaDraftRow {
  profile_id: string;
  step: string;
  data_json: string;
  updated_at: number;
}

export interface ProjectTaskSyncItem {
  key: string;
  scopeId: string;
  scopeName: string;
  path: string;
  name: string;
  status: string;
  priority: string;
  startDate: string;
  endDate: string;
  timeSpentSec: number;
  timeEstimatedSec: number;
  done: boolean;
}

export interface ProjectTaskRow {
  profile_id: string;
  task_key: string;
  scope_id: string;
  scope_name: string;
  file_path: string;
  task_name: string;
  status: string;
  priority: string;
  start_date: string;
  end_date: string;
  time_spent_sec: number;
  time_estimated_sec: number;
  done: number;
  updated_at: number;
}

export interface CompanionEventRow {
  sequence: number;
  event_id: string;
  event_type: 'add_timer' | 'append_session' | 'add_count' | 'set_binary' | 'set_state' | 'library_update' | 'library_create' | 'library_delete' | 'capture';
  habit_name: string;
  habit_date: string;
  amount: number | null;
  state: string | null;
  payload_json: string;
  created_at: number;
}

export interface TelegramButton { text: string; callback_data: string; }
export interface TelegramMarkup { inline_keyboard: TelegramButton[][]; }
export interface TelegramMessage {
  message_id: number;
  text?: string;
  caption?: string;
  chat: { id: number | string };
  forward_sender_name?: string;
  forward_from_chat?: { title?: string; username?: string };
  forward_origin?: { type?: string; sender_user?: { first_name?: string; last_name?: string; username?: string }; sender_user_name?: string; chat?: { title?: string; username?: string } };
}
export interface TelegramCallbackQuery { id: string; data?: string; message?: TelegramMessage; }
export interface TelegramUpdate { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery; }

export interface SyncPushBody {
  boardTasks?: import('./project-board').BoardTask[];
  projectScopes?: import('./project-board').BoardScope[];
  chatId: string;
  timezone: string;
  language: 'ru' | 'en';
  habits: HabitConfig[];
  notifications: {
    morningEnabled: boolean;
    morningTime: string;
    eveningEnabled: boolean;
    eveningTime: string;
    weeklyEnabled: boolean;
  };
  values: Array<{ habitName: string; date: string; value: number; state?: HabitState | null }>;
  library?: LibrarySyncItem[];
  projects?: ProjectTaskSyncItem[];
}
