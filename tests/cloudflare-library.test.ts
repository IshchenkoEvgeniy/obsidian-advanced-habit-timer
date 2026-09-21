import { describe, expect, it } from 'vitest';
import { collectionLabel, formatMediaProgress, habitLinksCollection, parseMediaNumber, parseStringList, splitValues, truncate } from '../cloudflare-companion/src/telegram';
import { resolveLibraryProgress } from '../cloudflare-companion/src/db';
import type { LibraryItemRow } from '../cloudflare-companion/src/types';

function item(overrides: Partial<LibraryItemRow> = {}): LibraryItemRow {
    return {
        id: 1, profile_id: 'default', item_path: 'Books/Test.md', title: 'Test',
        collection_id: 'book', status: '', format: '', rating: '', total: 300,
        progress: 42, authors_json: '[]', genres_json: '[]', series: '', series_index: 0,
        unit: 'pages', cover_url: '', start_date: '', end_date: '', reading_status: 'Reading',
        finished_status: 'Finished', season: 0, episode: 0, updated_at: 0, ...overrides
    };
}

describe('Cloudflare library helpers', () => {
    it('formats progress with total and unit', () => {
        expect(formatMediaProgress(item())).toBe('42 / 300 pages');
        expect(formatMediaProgress(item({ total: 0, progress: 12.5, unit: 'min' }))).toBe('12.5 min');
    });

    it('safely reads multi-value properties', () => {
        expect(parseStringList('["John", "Jane"]')).toEqual(['John', 'Jane']);
        expect(parseStringList('{broken')).toEqual([]);
    });

    it('keeps callback labels compact', () => {
        expect(collectionLabel('book')).toBe('Books');
        expect(collectionLabel('custom')).toBe('custom');
        expect(truncate('A very long library title', 10)).toBe('A very lo…');
    });

    it('parses audiobook durations and signed progress changes', () => {
        expect(parseMediaNumber('1:25:30', true)).toBe(85.5);
        expect(parseMediaNumber('-5', false)).toBe(-5);
        expect(parseMediaNumber('bad', true)).toBeNull();
        expect(splitValues('John, Jane; John')).toEqual(['John', 'Jane']);
    });

    it('resolves synchronized collection links for media timers', () => {
        expect(habitLinksCollection({ name: 'Read', mediaCollections: ['book'] }, 'BOOK')).toBe(true);
        expect(habitLinksCollection({ name: 'English', mediaGoals: { course: { goal: 1, unit: 'lessons' } } }, 'course')).toBe(true);
        expect(habitLinksCollection({ name: 'Read', mediaCollections: ['book'] }, 'film')).toBe(false);
    });

    it('logs the actual progress delta after clamping to Total', () => {
        expect(resolveLibraryProgress(270, 273, 280)).toEqual({ progress: 273, delta: 3 });
        expect(resolveLibraryProgress(5, 273, -10)).toEqual({ progress: 0, delta: -5 });
    });
});
