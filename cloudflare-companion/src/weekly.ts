import type { CompanionSnapshot } from './stats';
import type { CompanionEventRow, LibraryItemRow, ProjectTaskRow } from './types';

export interface WeeklyMetrics {
  habitScore: number;
  habitTimeSeconds: number;
  pagesRead: number;
  mediaCompleted: number;
  tasksCompleted: number;
}

export interface WeeklyOverviewData {
  startDate: string;
  endDate: string;
  habits: Array<{ name: string; streak: number; states: string[] }>;
  current: WeeklyMetrics;
  previous: WeeklyMetrics;
  achievement: string;
}

export function buildWeeklyOverview(
  snapshots: CompanionSnapshot[], library: LibraryItemRow[], progressEvents: CompanionEventRow[],
  currentMedia: LibraryItemRow[], previousMedia: LibraryItemRow[], currentTasks: ProjectTaskRow[],
  previousTasks: ProjectTaskRow[], startDate: string, endDate: string
): WeeklyOverviewData {
  const currentDays = snapshots.flatMap(snapshot => snapshot.days.slice(-7));
  const previousDays = snapshots.flatMap(snapshot => snapshot.days.slice(-14, -7));
  const score = (days: typeof currentDays): number => days.length
    ? Math.round(days.reduce((sum, day) => sum + (day.state === 'completed' ? 1 : day.state === 'partial' ? 0.5 : 0), 0) / days.length * 100)
    : 0;
  const timerTotal = (offset: number): number => snapshots.reduce((sum, snapshot) => {
    if ((snapshot.habit.type || 'timer') !== 'timer') return sum;
    const days = offset === 0 ? snapshot.days.slice(-7) : snapshot.days.slice(-14, -7);
    return sum + days.reduce((value, day) => value + Math.max(0, day.value), 0);
  }, 0);
  const itemByPath = new Map(library.map(item => [item.item_path, item]));
  const pagesByRange = (from: string, to: string): number => progressEvents.reduce((sum, event) => {
    if (event.habit_date < from || event.habit_date > to) return sum;
    const item = itemByPath.get(event.habit_name);
    if (!item || !['book', 'manga'].includes(item.collection_id) || /audio/i.test(item.format)) return sum;
    const payload = parseObject(event.payload_json); const log = objectValue(payload.progressLog);
    return sum + Math.max(0, numberValue(log.delta));
  }, 0);
  const previousStart = addIsoDays(startDate, -7);
  const previousEnd = addIsoDays(startDate, -1);
  const current: WeeklyMetrics = {
    habitScore: score(currentDays), habitTimeSeconds: timerTotal(0), pagesRead: pagesByRange(startDate, endDate),
    mediaCompleted: currentMedia.length, tasksCompleted: currentTasks.length
  };
  const previous: WeeklyMetrics = {
    habitScore: score(previousDays), habitTimeSeconds: timerTotal(7), pagesRead: pagesByRange(previousStart, previousEnd),
    mediaCompleted: previousMedia.length, tasksCompleted: previousTasks.length
  };
  const achievements = [
    { value: current.habitScore, text: `HABITS ${current.habitScore}%` },
    { value: current.tasksCompleted * 25, text: `${current.tasksCompleted} TASKS DONE` },
    { value: current.mediaCompleted * 35, text: `${current.mediaCompleted} MEDIA FINISHED` },
    { value: Math.min(100, current.pagesRead / 3), text: `${Math.round(current.pagesRead)} PAGES READ` }
  ].sort((a, b) => b.value - a.value);
  return {
    startDate, endDate,
    habits: snapshots.slice(0, 8).map(snapshot => ({ name: snapshot.habit.name, streak: snapshot.currentStreak, states: snapshot.days.slice(-14).map(day => day.state) })),
    current, previous, achievement: achievements[0]?.text || 'WEEK COMPLETE'
  };
}

function parseObject(value: string): Record<string, unknown> { try { const parsed: unknown = JSON.parse(value); return objectValue(parsed); } catch { return {}; } }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function numberValue(value: unknown): number { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function addIsoDays(date: string, amount: number): string { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10); }
