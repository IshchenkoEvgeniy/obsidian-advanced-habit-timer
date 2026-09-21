/**
 * Unit tests for the core logic of LibraryTimeline component.
 *
 * Tests the event calculation and date-sorting logic in isolation,
 * without requiring DOM, Svelte, or the real `moment` library.
 */
import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Minimal moment-compatible date parser (mirrors what we use in the component)
// ─────────────────────────────────────────────────────────────────────────────

function parseMomentDate(dateStr: string): { isValid: () => boolean; format: () => string } | null {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const valid = !isNaN(date.getTime());
    return {
        isValid: () => valid,
        format: () => {
            if (!valid) return '';
            return date.toISOString().slice(0, 10); // YYYY-MM-DD
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mirrors the core logic of LibraryTimeline.svelte:calculateEvents()
// ─────────────────────────────────────────────────────────────────────────────

interface MediaItem {
    file: { path: string };
    collectionId: string;
    status: string;
    title?: string;
    startDate?: string;
    endDate?: string;
}

interface Collection {
    id: string;
    finishedStatusName: string;
}

interface TimelineEvent {
    id: string;
    date: string;
    type: 'started' | 'finished';
    item: MediaItem;
}

function calculateEvents(items: MediaItem[], collections: Collection[]): TimelineEvent[] {
    const evts: TimelineEvent[] = [];

    items.forEach(item => {
        const col = collections.find(c => c.id === item.collectionId);
        if (!col) return;

        if (item.startDate) {
            const parsed = parseMomentDate(item.startDate);
            if (parsed && parsed.isValid()) {
                evts.push({
                    id: item.file.path + '_start',
                    date: parsed.format(),
                    type: 'started',
                    item,
                });
            }
        }

        if (item.endDate) {
            const parsed = parseMomentDate(item.endDate);
            if (parsed && parsed.isValid()) {
                evts.push({
                    id: item.file.path + '_end',
                    date: parsed.format(),
                    type: 'finished',
                    item,
                });
            }
        }
    });

    evts.sort((a, b) => b.date.localeCompare(a.date));
    return evts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const BOOKS: Collection = { id: 'book', finishedStatusName: 'Read' };
const COLLECTIONS = [BOOKS];

function makeItem(overrides: Partial<MediaItem>): MediaItem {
    return {
        file: { path: 'vault/books/Default.md' },
        collectionId: 'book',
        status: 'Reading',
        title: 'Test Book',
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('LibraryTimeline — calculateEvents()', () => {

    describe('empty states', () => {
        it('returns [] for empty items list', () => {
            expect(calculateEvents([], COLLECTIONS)).toEqual([]);
        });

        it('returns [] for item with no dates', () => {
            const items = [makeItem({ startDate: undefined, endDate: undefined })];
            expect(calculateEvents(items, COLLECTIONS)).toHaveLength(0);
        });

        it('returns [] when collectionId does not match any collection', () => {
            const items = [makeItem({ collectionId: 'unknown', startDate: '2024-01-01' })];
            expect(calculateEvents(items, COLLECTIONS)).toHaveLength(0);
        });
    });

    describe('event generation', () => {
        it('creates a "started" event from startDate', () => {
            const items = [makeItem({ startDate: '2024-03-15' })];
            const events = calculateEvents(items, COLLECTIONS);
            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('started');
            expect(events[0].date).toBe('2024-03-15');
            expect(events[0].id).toContain('_start');
        });

        it('creates a "finished" event from endDate', () => {
            const items = [makeItem({ endDate: '2024-06-20' })];
            const events = calculateEvents(items, COLLECTIONS);
            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('finished');
            expect(events[0].date).toBe('2024-06-20');
            expect(events[0].id).toContain('_end');
        });

        it('creates two events for an item with both startDate and endDate', () => {
            const items = [makeItem({ startDate: '2024-01-01', endDate: '2024-03-01' })];
            const events = calculateEvents(items, COLLECTIONS);
            expect(events).toHaveLength(2);
            const types = events.map(e => e.type);
            expect(types).toContain('started');
            expect(types).toContain('finished');
        });

        it('generates unique IDs based on file path', () => {
            const items = [
                makeItem({ file: { path: 'vault/a.md' }, startDate: '2024-01-01' }),
                makeItem({ file: { path: 'vault/b.md' }, startDate: '2024-02-01' }),
            ];
            const events = calculateEvents(items, COLLECTIONS);
            const ids = events.map(e => e.id);
            expect(new Set(ids).size).toBe(ids.length); // all unique
        });
    });

    describe('sorting', () => {
        it('sorts events in descending date order (most recent first)', () => {
            const items = [
                makeItem({ file: { path: 'vault/a.md' }, startDate: '2023-01-01' }),
                makeItem({ file: { path: 'vault/b.md' }, startDate: '2024-06-15' }),
                makeItem({ file: { path: 'vault/c.md' }, startDate: '2022-12-31' }),
            ];
            const events = calculateEvents(items, COLLECTIONS);
            expect(events[0].date).toBe('2024-06-15');
            expect(events[1].date).toBe('2023-01-01');
            expect(events[2].date).toBe('2022-12-31');
        });

        it('sorts mixed start and end events correctly', () => {
            const items = [
                makeItem({ file: { path: 'vault/a.md' }, startDate: '2024-01-01', endDate: '2024-06-01' }),
                makeItem({ file: { path: 'vault/b.md' }, startDate: '2024-03-15' }),
            ];
            const events = calculateEvents(items, COLLECTIONS);
            expect(events[0].date).toBe('2024-06-01');
            expect(events[1].date).toBe('2024-03-15');
            expect(events[2].date).toBe('2024-01-01');
        });
    });

    describe('invalid date handling', () => {
        it('skips items with invalid startDate strings', () => {
            const items = [makeItem({ startDate: 'not-a-date' })];
            const events = calculateEvents(items, COLLECTIONS);
            expect(events).toHaveLength(0);
        });

        it('skips items with invalid endDate strings', () => {
            const items = [makeItem({ endDate: 'yesterday' })];
            const events = calculateEvents(items, COLLECTIONS);
            expect(events).toHaveLength(0);
        });

        it('creates a valid event even if the other date is invalid', () => {
            const items = [makeItem({ startDate: '2024-05-10', endDate: 'invalid' })];
            const events = calculateEvents(items, COLLECTIONS);
            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('started');
        });
    });

    describe('item reference', () => {
        it('attaches the original item to the event', () => {
            const item = makeItem({ title: 'Dune', startDate: '2024-01-01' });
            const events = calculateEvents([item], COLLECTIONS);
            expect(events[0].item).toBe(item);
            expect(events[0].item.title).toBe('Dune');
        });
    });

    describe('performance', () => {
        it('handles 500 items without errors', () => {
            const items = Array.from({ length: 500 }, (_, i) =>
                makeItem({
                    file: { path: `vault/book-${i}.md` },
                    startDate: `2024-${String((i % 12) + 1).padStart(2, '0')}-01`,
                    endDate: i % 2 === 0 ? `2024-${String((i % 12) + 1).padStart(2, '0')}-28` : undefined,
                })
            );
            const events = calculateEvents(items, COLLECTIONS);
            expect(events.length).toBeGreaterThanOrEqual(500); // at least one event per item
            // Verify descending sort
            for (let i = 0; i < events.length - 1; i++) {
                expect(events[i].date >= events[i + 1].date).toBe(true);
            }
        });
    });
});
