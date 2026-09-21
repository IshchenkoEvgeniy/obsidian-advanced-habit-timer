import { describe, expect, it } from 'vitest';
import { dailyMediaGoalLines } from '../cloudflare-companion/src/telegram';
import type { CompanionEventRow, LibraryItemRow } from '../cloudflare-companion/src/types';

const item = (path: string, collection = 'book', unit = 'pages'): LibraryItemRow => ({
    item_path: path, collection_id: collection, unit, format: '', status: 'Reading',
    finished_status: 'Done', end_date: ''
} as LibraryItemRow);
const event = (sequence: number, path: string, delta: number, date = '2026-09-04'): CompanionEventRow => ({
    sequence, habit_name: path, habit_date: date, payload_json: JSON.stringify({ progressLog: { delta } })
} as CompanionEventRow);

describe('Telegram daily media goals', () => {
    it('adds new Telegram progress to the Obsidian daily baseline without counting synced events twice', () => {
        const lines = dailyMediaGoalLines([{ name: 'Read', mediaGoals: { book: {
            goal: 10, unit: 'pages', daily: { date: '2026-09-04', value: 4, throughSequence: 12 }
        } } }], 'ru', '2026-09-04', [item('a'), item('b')], [
            event(12, 'a', 4), event(13, 'a', 3), event(14, 'b', 5),
            event(15, 'a', 100, '2026-09-03'), event(16, 'missing', 100)
        ]);
        expect(lines).toContain('- Books: 12 / 10 страниц');
    });

    it('resets the baseline on a new day and does not count audiobook minutes as pages', () => {
        const lines = dailyMediaGoalLines([{ name: 'Read', mediaGoals: { book: {
            goal: 10, unit: 'pages', daily: { date: '2026-09-03', value: 20, throughSequence: 100 }
        } } }], 'ru', '2026-09-04', [item('a'), { ...item('audio'), format: 'Audiobook' }], [
            event(101, 'a', 2), event(102, 'audio', 60)
        ]);
        expect(lines).toContain('- Books: 2 / 10 страниц');
    });

    it('counts completed items today instead of their runtime and converts minutes to hours', () => {
        const lines = dailyMediaGoalLines([{ name: 'Watch', mediaGoals: {
            film: { goal: 1, unit: 'items' }, game: { goal: 2, unit: 'hours' }
        } }], 'en', '2026-09-04', [
            { ...item('film', 'film', 'minutes'), status: 'Done', end_date: '2026-09-04' },
            { ...item('old', 'film', 'minutes'), status: 'Done', end_date: '2026-09-03' },
            item('game', 'game', 'minutes')
        ], [event(1, 'film', 120), event(2, 'game', 30)]);
        expect(lines).toContain('- Films: 1 / 1 items');
        expect(lines.some(line => line.includes('0.5 / 2 hours'))).toBe(true);
    });

    it('shows configured pages and lessons independently of habit minutes', () => {
        const lines = dailyMediaGoalLines([
            { name: 'Read', mediaGoals: { book: { goal: 10, unit: 'pages' } } },
            { name: 'Study', mediaGoals: { course: { goal: 2, unit: 'lessons' } } }
        ], 'ru');
        expect(lines).toContain('- Books: 0 / 10 страниц');
        expect(lines).toContain('- Courses: 0 / 2 уроков');
    });

    it('does not invent goals for disabled or unconfigured collections', () => {
        expect(dailyMediaGoalLines([{ name: 'Read', mediaCollections: ['book'], mediaGoals: {} }], 'ru')).toEqual([]);
    });

    it('deduplicates collections linked to multiple habits and rejects invalid goals', () => {
        expect(dailyMediaGoalLines([
            { name: 'Read', mediaGoals: { book: { goal: 10, unit: 'pages' } } },
            { name: 'Other', mediaGoals: { BOOK: { goal: 10, unit: 'pages' }, course: { goal: 0, unit: 'lessons' } } }
        ], 'en')).toEqual(['', 'Daily goals:', '- Books: 0 / 10 pages']);
    });
});
