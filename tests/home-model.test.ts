import { describe, it, expect } from 'vitest';
import { greetingKind, groupTasks, nearestTasks, buildDaySummary, buildProjectCards, taskSortKey } from '../src/home/home-model';

describe('greetingKind', () => {
    it('buckets hours into morning/afternoon/evening/night', () => {
        expect(greetingKind(6)).toBe('morning');
        expect(greetingKind(11)).toBe('morning');
        expect(greetingKind(12)).toBe('afternoon');
        expect(greetingKind(16)).toBe('afternoon');
        expect(greetingKind(17)).toBe('evening');
        expect(greetingKind(22)).toBe('evening');
        expect(greetingKind(23)).toBe('night');
        expect(greetingKind(4)).toBe('night');
    });
});

describe('taskSortKey', () => {
    it('prefers deadline over date and tolerates datetime strings', () => {
        expect(taskSortKey({ name: 'a', deadline: '2026-09-26T15:00', date: '2026-09-20' })).toBe('2026-09-26');
        expect(taskSortKey({ name: 'a', date: '2026-09-20' })).toBe('2026-09-20');
        expect(taskSortKey({ name: 'a' })).toBe('9999-12-31');
    });
});

describe('groupTasks', () => {
    const today = '2026-09-25';
    it('splits pending tasks into overdue/today/upcoming/no-date', () => {
        const g = groupTasks([
            { name: 'old', date: '2026-09-20', done: false },
            { name: 'now', date: '2026-09-25', done: false },
            { name: 'later', date: '2026-09-30', done: false },
            { name: 'someday', done: false },
            { name: 'done', date: '2026-09-20', done: true }
        ], today);
        expect(g.overdue.map(t => t.name)).toEqual(['old']);
        expect(g.today.map(t => t.name)).toEqual(['now']);
        expect(g.upcoming.map(t => t.name)).toEqual(['later']);
        expect(g.noDate.map(t => t.name)).toEqual(['someday']);
    });
    it('drops completed tasks everywhere', () => {
        const g = groupTasks([{ name: 'x', date: '2026-01-01', done: true }], today);
        expect(g.overdue).toHaveLength(0);
        expect(g.today).toHaveLength(0);
        expect(g.upcoming).toHaveLength(0);
        expect(g.noDate).toHaveLength(0);
    });
    it('sorts overdue by date ascending', () => {
        const g = groupTasks([
            { name: 'late2', date: '2026-09-24' },
            { name: 'late1', date: '2026-09-20' }
        ], today);
        expect(g.overdue.map(t => t.name)).toEqual(['late1', 'late2']);
    });
});

describe('nearestTasks', () => {
    it('returns overdue first, limited', () => {
        const tasks = [
            { name: 'u1', date: '2026-09-30' },
            { name: 'o1', date: '2026-09-01' },
            { name: 't1', date: '2026-09-25' },
            { name: 'o2', date: '2026-09-02' },
            { name: 'u2', date: '2026-10-01' },
            { name: 'u3', date: '2026-10-02' }
        ];
        const near = nearestTasks(tasks, '2026-09-25', 4);
        expect(near.map(t => t.name)).toEqual(['o1', 'o2', 't1', 'u1']);
    });
});

describe('buildDaySummary', () => {
    const fmt = (sec: number) => `${Math.round(sec / 60)}m`;
    it('returns null when everything is empty or zero', () => {
        expect(buildDaySummary({}, fmt)).toBeNull();
        expect(buildDaySummary({ timerSecondsToday: 0, tasksDoneToday: 0, pagesReadToday: 0 }, fmt)).toBeNull();
    });
    it('builds parts for present values', () => {
        expect(buildDaySummary({ timerSecondsToday: 1800, tasksDoneToday: 3, pagesReadToday: 12 }, fmt)).toEqual(['30m', '3', '12']);
    });
});

describe('buildProjectCards', () => {
    const today = '2026-09-25';
    it('computes progress and nearest future deadline, ignoring done and past', () => {
        const cards = buildProjectCards([{
            scopeId: 's1', name: 'Site', statuses: ['Todo', 'Doing', 'Done'],
            isTaskDone: status => status === 'Done',
            tasks: [
                { name: 'a', status: 'Done' },
                { name: 'b', status: 'Doing', endDate: '2026-09-30' },
                { name: 'c', status: 'Todo', endDate: '2026-09-26' },
                { name: 'd', status: 'Todo', endDate: '2026-09-20' },
                { name: 'e', status: 'Todo' }
            ]
        }], today);
        expect(cards).toHaveLength(1);
        const card = cards[0];
        expect(card.total).toBe(5);
        expect(card.done).toBe(1);
        expect(card.pct).toBe(20);
        expect(card.nearestDeadline).toBe('2026-09-26');
    });
    it('handles empty scopes', () => {
        const cards = buildProjectCards([{ scopeId: 's', name: 'Empty', statuses: ['Todo'], isTaskDone: () => false, tasks: [] }], today);
        expect(cards[0].pct).toBe(0);
        expect(cards[0].nearestDeadline).toBeUndefined();
    });
});