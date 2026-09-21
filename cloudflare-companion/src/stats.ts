import type { HabitConfig, HabitState, HabitValueRow } from './types';
import { addDays, weekKey } from './time';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface CompanionDay {
  date: string;
  value: number;
  state: HabitState;
  desired: number;
  minimum: number;
}

export interface CompanionSnapshot {
  habit: HabitConfig;
  days: CompanionDay[];
  currentStreak: number;
  bestStreak: number;
  completionRate: number;
  average: number;
  total: number;
}

export function habitGoals(habit: HabitConfig, date: string): { minimum: number; desired: number; mode: 'daily' | 'weekly' } {
  const type = habit.type || 'timer';
  if (type === 'binary' || type === 'negative') return { minimum: 1, desired: 1, mode: 'daily' };
  const mode = habit.goalMode || 'daily';
  const dateValue = new Date(`${date}T12:00:00Z`);
  const weekday = WEEKDAYS[dateValue.getUTCDay()] || 'mon';
  const baseDaily = type === 'timer' ? habit.goalMinutes || 0 : habit.goalCount || 1;
  const rawDesired = mode === 'weekly'
    ? type === 'timer' ? habit.weeklyGoalMinutes || baseDaily : habit.weeklyGoalCount || baseDaily
    : habit.dailyGoals?.[weekday] ?? baseDaily;
  const rawMinimum = type === 'timer'
    ? habit.minimumGoalMinutes ?? rawDesired
    : habit.minimumGoalCount ?? rawDesired;
  const scale = type === 'timer' ? 60 : 1;
  return {
    minimum: Math.min(rawDesired, Math.max(0, rawMinimum)) * scale,
    desired: Math.max(0, rawDesired) * scale,
    mode
  };
}

export function createSnapshots(habits: HabitConfig[], values: HabitValueRow[], today: string, days = 84): CompanionSnapshot[] {
  const byHabitDate = new Map(values.map(value => [`${value.habit_name}|${value.habit_date}`, value]));
  const dates = Array.from({ length: days }, (_, index) => addDays(today, index - days + 1));
  return habits
    .filter(habit => (habit.createdAt || '0000-00-00') <= today)
    .map(habit => {
      const weekly = new Map<string, number>();
      for (const date of dates) {
        const value = byHabitDate.get(`${habit.name}|${date}`)?.value || 0;
        const key = weekKey(date);
        weekly.set(key, (weekly.get(key) || 0) + value);
      }
      const habitDays = dates.map(date => {
        const row = byHabitDate.get(`${habit.name}|${date}`);
        const value = row?.value || 0;
        const goals = habitGoals(habit, date);
        const compared = goals.mode === 'weekly' ? weekly.get(weekKey(date)) || 0 : value;
        let state = row?.state || null;
        if (!state) {
          if (compared >= goals.desired) state = 'completed';
          else if (compared >= goals.minimum && goals.minimum > 0) state = 'partial';
          else state = date < today ? 'missed' : 'pending';
        }
        return { date, value, state, desired: goals.desired, minimum: goals.minimum } as CompanionDay;
      });
      const streakDays = (habit.goalMode || 'daily') === 'weekly'
        ? [...new Map(habitDays.map(day => [weekKey(day.date), day])).values()]
        : habitDays;
      let running = 0;
      let best = 0;
      for (const day of streakDays) {
        if (day.state === 'completed' || day.state === 'partial') running++;
        else if (day.state !== 'excused' && day.state !== 'deferred') running = 0;
        best = Math.max(best, running);
      }
      let current = 0;
      for (let index = streakDays.length - 1; index >= 0; index--) {
        const state = streakDays[index]?.state;
        if (state === 'pending' && index === streakDays.length - 1) continue;
        if (state === 'completed' || state === 'partial') current++;
        else if (state !== 'excused' && state !== 'deferred') break;
      }
      const scored = streakDays.filter(day => ['completed', 'partial', 'missed', 'skipped'].includes(day.state));
      const successful = scored.filter(day => day.state === 'completed' || day.state === 'partial').length;
      const total = habitDays.reduce((sum, day) => sum + day.value, 0);
      return {
        habit,
        days: habitDays,
        currentStreak: current,
        bestStreak: best,
        completionRate: scored.length ? Math.round(successful / scored.length * 100) : 0,
        average: habitDays.length ? total / habitDays.length : 0,
        total
      };
    });
}

export function formatValue(habit: HabitConfig, value: number): string {
  if ((habit.type || 'timer') !== 'timer') return String(Math.round(value * 10) / 10);
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes}M`;
  return `${Math.floor(minutes / 60)}H${String(minutes % 60).padStart(2, '0')}M`;
}
