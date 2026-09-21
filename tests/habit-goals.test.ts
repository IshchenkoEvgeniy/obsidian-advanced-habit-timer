import { describe, expect, it } from 'vitest';
import {
    evaluateHabitState, getHabitGoals, getWeekdayKey,
    readHabitExplicitState, statePreservesStreak
} from '../src/habits/goals';
import type { HabitProperty } from '../src/types';

function timer(overrides: Partial<HabitProperty> = {}): HabitProperty {
    return { name: 'Habit-Read', type: 'timer', goalMinutes: 60, globalGoalHours: 100, ...overrides };
}

describe('flexible habit goals', () => {
    it('keeps legacy habits unchanged', () => {
        expect(getHabitGoals(timer(), '2026-07-17')).toEqual({
            minimum: 3600, desired: 3600, mode: 'daily', progressionLevel: 0
        });
    });

    it('separates minimum and desired targets', () => {
        const prop = timer({ minimumGoalMinutes: 20 });
        expect(getHabitGoals(prop, '2026-07-17')).toMatchObject({ minimum: 1200, desired: 3600 });
        expect(evaluateHabitState(prop, 1200, '2026-07-17', null, undefined, 0, '2026-07-17')).toBe('partial');
        expect(evaluateHabitState(prop, 3600, '2026-07-17', null, undefined, 0, '2026-07-17')).toBe('completed');
    });

    it('uses weekday-specific desired targets', () => {
        const prop = timer({ dailyGoals: { mon: 30, fri: 90 } });
        expect(getWeekdayKey('2026-07-17')).toBe('fri');
        expect(getHabitGoals(prop, '2026-07-17').desired).toBe(5400);
        expect(getHabitGoals(prop, '2026-07-20').desired).toBe(1800);
    });

    it('uses an aggregate for weekly goals', () => {
        const prop = timer({ goalMode: 'weekly', weeklyGoalMinutes: 300, minimumGoalMinutes: 180 });
        expect(getHabitGoals(prop, '2026-07-17')).toMatchObject({ minimum: 10800, desired: 18000, mode: 'weekly' });
        expect(evaluateHabitState(prop, 1800, '2026-07-17', null, 10800, 0, '2026-07-17')).toBe('partial');
        expect(evaluateHabitState(prop, 1800, '2026-07-17', null, 18000, 0, '2026-07-17')).toBe('completed');
    });

    it('increases the desired target on schedule and respects the maximum', () => {
        const prop = timer({
            createdAt: '2026-06-01',
            progressiveGoal: { enabled: true, step: 10, everyWeeks: 2, max: 80 }
        });
        expect(getHabitGoals(prop, '2026-06-15').desired).toBe(4200);
        expect(getHabitGoals(prop, '2026-08-31').desired).toBe(4800);
    });

    it('adds deferred work to the desired target without raising the minimum', () => {
        const goals = getHabitGoals(timer({ minimumGoalMinutes: 20 }), '2026-07-17', 1800);
        expect(goals.minimum).toBe(1200);
        expect(goals.desired).toBe(5400);
    });
});

describe('habit day states', () => {
    it('lets explicit states override automatic evaluation', () => {
        const prop = timer({ minimumGoalMinutes: 20 });
        expect(evaluateHabitState(prop, 0, '2026-07-16', 'excused', undefined, 0, '2026-07-17')).toBe('excused');
        expect(evaluateHabitState(prop, 3600, '2026-07-16', 'skipped', undefined, 0, '2026-07-17')).toBe('skipped');
    });

    it('distinguishes pending and missed dates', () => {
        const prop = timer({ minimumGoalMinutes: 20 });
        expect(evaluateHabitState(prop, 0, '2026-07-17', null, undefined, 0, '2026-07-17')).toBe('pending');
        expect(evaluateHabitState(prop, 0, '2026-07-16', null, undefined, 0, '2026-07-17')).toBe('missed');
    });

    it('reads only supported state values and preserves streak for excused days', () => {
        expect(readHabitExplicitState({ 'Habit-Read-State': 'deferred' }, 'Habit-Read')).toBe('deferred');
        expect(readHabitExplicitState({ 'Habit-Read-State': 'unknown' }, 'Habit-Read')).toBeNull();
        expect(statePreservesStreak('excused')).toBe(true);
        expect(statePreservesStreak('skipped')).toBe(false);
    });
});
