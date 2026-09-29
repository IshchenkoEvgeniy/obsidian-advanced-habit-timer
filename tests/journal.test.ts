import { describe, it, expect } from 'vitest';
import { journalGroupOf, groupJournal, journalDay } from '../src/tasks/journal';

describe('journalDay', () => {
    it('prefers deadline over planned date', () => {
        expect(journalDay({ name: 'a', date: '2026-09-20', deadline: '2026-09-26', done: false })).toBe('2026-09-26');
    });
    it('falls back to date then empty', () => {
        expect(journalDay({ name: 'a', date: '2026-09-20', done: false })).toBe('2026-09-20');
        expect(journalDay({ name: 'a', date: '', done: false })).toBe('');
    });
});

describe('journalGroupOf', () => {
    const today = '2026-09-29';
    it('done always wins', () => {
        expect(journalGroupOf({ name: 'x', date: '2026-01-01', done: true }, today)).toBe('done');
    });
    it('buckets by day', () => {
        expect(journalGroupOf({ name: 'x', date: '2026-09-20', done: false }, today)).toBe('overdue');
        expect(journalGroupOf({ name: 'x', date: today, done: false }, today)).toBe('today');
        expect(journalGroupOf({ name: 'x', date: '2026-09-30', done: false }, today)).toBe('tomorrow');
        expect(journalGroupOf({ name: 'x', date: '2026-10-04', done: false }, today)).toBe('week');
        expect(journalGroupOf({ name: 'x', date: '2026-10-20', done: false }, today)).toBe('later');
        expect(journalGroupOf({ name: 'x', date: '', done: false }, today)).toBe('nodate');
    });
    it('deadline moves task between buckets', () => {
        expect(journalGroupOf({ name: 'x', date: '2026-09-01', deadline: today, done: false }, today)).toBe('today');
    });
});

describe('groupJournal', () => {
    const today = '2026-09-29';
    it('returns only non-empty groups in fixed order', () => {
        const groups = groupJournal([
            { name: 'future', date: '2026-10-20', done: false },
            { name: 'now', date: today, done: false },
            { name: 'past', date: '2026-09-20', done: false },
            { name: 'ok', date: '2026-09-28', done: true }
        ], today);
        expect(groups.map(g => g.id)).toEqual(['overdue', 'today', 'later', 'done']);
        expect(groups[0].tasks[0].name).toBe('past');
    });
    it('sorts tasks inside a group by day then name', () => {
        const groups = groupJournal([
            { name: 'b', date: '2026-09-28', done: false },
            { name: 'a', date: '2026-09-27', done: false },
            { name: 'a', date: '2026-09-28', done: false }
        ], today);
        expect(groups[0].tasks.map(t => t.name)).toEqual(['a', 'a', 'b']);
    });
    it('sorts no-date group by name', () => {
        const groups = groupJournal([
            { name: 'z', date: '', done: false },
            { name: 'a', date: '', done: false }
        ], today);
        expect(groups[0].tasks.map(t => t.name)).toEqual(['a', 'z']);
    });
});
