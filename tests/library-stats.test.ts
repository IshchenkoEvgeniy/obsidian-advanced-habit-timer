/**
 * Unit tests for the core logic of LibraryStats component.
 *
 * Since the logic is embedded in the Svelte component but is a pure function,
 * we extract and test the business rules in isolation — no DOM, no Svelte needed.
 */
import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — mirror the logic in LibraryStats.svelte:recalculateStats()
// ─────────────────────────────────────────────────────────────────────────────

interface MediaItem {
    collectionId: string;
    status: string;
    genre?: string;
    rating?: string;
}

interface Collection {
    id: string;
    finishedStatusName: string;
}

interface BarEntry {
    label: string;
    value: number;
    perc: number;
}

function recalculateStats(
    items: MediaItem[],
    collections: Collection[]
): {
    totalItems: number;
    finishedItemsCount: number;
    genresData: BarEntry[];
    ratingsData: BarEntry[];
} {
    const finished = items.filter(i => {
        const col = collections.find(c => c.id === i.collectionId);
        return col && i.status === col.finishedStatusName;
    });

    const gCounts: Record<string, number> = {};
    const rCounts: Record<string, number> = {};

    finished.forEach(i => {
        const g = i.genre || 'Unknown';
        gCounts[g] = (gCounts[g] || 0) + 1;

        const r = i.rating ? parseFloat(i.rating) : 0;
        if (r > 0) {
            const rStr = r.toString() + ' ⭐';
            rCounts[rStr] = (rCounts[rStr] || 0) + 1;
        }
    });

    let gArr = Object.entries(gCounts)
        .map(([label, value]) => ({ label, value, perc: 0 }))
        .sort((a, b) => b.value - a.value);
    const gTotal = gArr.reduce((sum, i) => sum + i.value, 0) || 1;
    gArr.forEach(i => { i.perc = (i.value / gTotal) * 100; });

    let rArr = Object.entries(rCounts)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([label, value]) => ({ label, value, perc: 0 }));
    const rTotal = rArr.reduce((sum, i) => sum + i.value, 0) || 1;
    rArr.forEach(i => { i.perc = (i.value / rTotal) * 100; });

    return {
        totalItems: items.length,
        finishedItemsCount: finished.length,
        genresData: gArr,
        ratingsData: rArr,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const BOOKS: Collection = { id: 'book', finishedStatusName: 'Read' };
const GAMES: Collection = { id: 'game', finishedStatusName: 'Completed' };
const COLLECTIONS = [BOOKS, GAMES];

function makeItem(overrides: Partial<MediaItem>): MediaItem {
    return {
        collectionId: 'book',
        status: 'Reading',
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('LibraryStats — recalculateStats()', () => {

    describe('totalItems count', () => {
        it('returns 0 for empty library', () => {
            const { totalItems } = recalculateStats([], COLLECTIONS);
            expect(totalItems).toBe(0);
        });

        it('counts all items regardless of status', () => {
            const items = [
                makeItem({ status: 'Reading' }),
                makeItem({ status: 'Read' }),
                makeItem({ status: 'Planned' }),
            ];
            const { totalItems } = recalculateStats(items, COLLECTIONS);
            expect(totalItems).toBe(3);
        });
    });

    describe('finishedItemsCount', () => {
        it('counts only items with the collection finishedStatusName', () => {
            const items = [
                makeItem({ status: 'Read' }),
                makeItem({ status: 'Reading' }),
                makeItem({ status: 'Read' }),
                makeItem({ status: 'Planned' }),
            ];
            const { finishedItemsCount } = recalculateStats(items, COLLECTIONS);
            expect(finishedItemsCount).toBe(2);
        });

        it('counts finished from the correct collection only', () => {
            const items = [
                makeItem({ collectionId: 'book', status: 'Read' }),
                makeItem({ collectionId: 'game', status: 'Read' }),      // 'Read' != 'Completed'
                makeItem({ collectionId: 'game', status: 'Completed' }), // correct
            ];
            const { finishedItemsCount } = recalculateStats(items, COLLECTIONS);
            expect(finishedItemsCount).toBe(2); // one book "Read" + one game "Completed"
        });

        it('is 0 when no items are finished', () => {
            const items = [makeItem({ status: 'Reading' }), makeItem({ status: 'Planned' })];
            const { finishedItemsCount } = recalculateStats(items, COLLECTIONS);
            expect(finishedItemsCount).toBe(0);
        });

        it('ignores items whose collectionId does not exist in collections', () => {
            const items = [makeItem({ collectionId: 'manga', status: 'Read' })];
            const { finishedItemsCount } = recalculateStats(items, COLLECTIONS);
            expect(finishedItemsCount).toBe(0);
        });
    });

    describe('genresData', () => {
        it('is empty when there are no finished items', () => {
            const items = [makeItem({ status: 'Reading', genre: 'Fantasy' })];
            const { genresData } = recalculateStats(items, COLLECTIONS);
            expect(genresData).toHaveLength(0);
        });

        it('groups finished items by genre and sorts descending by count', () => {
            const items = [
                makeItem({ status: 'Read', genre: 'Fantasy' }),
                makeItem({ status: 'Read', genre: 'Fantasy' }),
                makeItem({ status: 'Read', genre: 'Sci-Fi' }),
            ];
            const { genresData } = recalculateStats(items, COLLECTIONS);
            expect(genresData[0].label).toBe('Fantasy');
            expect(genresData[0].value).toBe(2);
            expect(genresData[1].label).toBe('Sci-Fi');
            expect(genresData[1].value).toBe(1);
        });

        it('assigns "Unknown" when genre is missing', () => {
            const items = [makeItem({ status: 'Read', genre: undefined })];
            const { genresData } = recalculateStats(items, COLLECTIONS);
            expect(genresData[0].label).toBe('Unknown');
        });

        it('calculates correct percentages summing to 100', () => {
            const items = [
                makeItem({ status: 'Read', genre: 'Fantasy' }),
                makeItem({ status: 'Read', genre: 'Fantasy' }),
                makeItem({ status: 'Read', genre: 'Sci-Fi' }),
            ];
            const { genresData } = recalculateStats(items, COLLECTIONS);
            const totalPerc = genresData.reduce((sum, g) => sum + g.perc, 0);
            expect(totalPerc).toBeCloseTo(100, 5);
        });

        it('gives 100% to a single genre', () => {
            const items = [makeItem({ status: 'Read', genre: 'Horror' })];
            const { genresData } = recalculateStats(items, COLLECTIONS);
            expect(genresData[0].perc).toBe(100);
        });
    });

    describe('ratingsData', () => {
        it('is empty when no finished items have ratings', () => {
            const items = [makeItem({ status: 'Read' })]; // no rating field
            const { ratingsData } = recalculateStats(items, COLLECTIONS);
            expect(ratingsData).toHaveLength(0);
        });

        it('ignores ratings of 0 or non-numeric', () => {
            const items = [
                makeItem({ status: 'Read', rating: '0' }),
                makeItem({ status: 'Read', rating: 'N/A' }),
            ];
            const { ratingsData } = recalculateStats(items, COLLECTIONS);
            expect(ratingsData).toHaveLength(0);
        });

        it('groups finished items by numeric rating', () => {
            const items = [
                makeItem({ status: 'Read', rating: '5' }),
                makeItem({ status: 'Read', rating: '5' }),
                makeItem({ status: 'Read', rating: '3' }),
            ];
            const { ratingsData } = recalculateStats(items, COLLECTIONS);
            // Sorted descending by label string: "5 ⭐" > "3 ⭐"
            expect(ratingsData[0].label).toBe('5 ⭐');
            expect(ratingsData[0].value).toBe(2);
            expect(ratingsData[1].label).toBe('3 ⭐');
            expect(ratingsData[1].value).toBe(1);
        });

        it('calculates correct percentages for ratings', () => {
            const items = [
                makeItem({ status: 'Read', rating: '5' }),
                makeItem({ status: 'Read', rating: '4' }),
                makeItem({ status: 'Read', rating: '4' }),
            ];
            const { ratingsData } = recalculateStats(items, COLLECTIONS);
            const totalPerc = ratingsData.reduce((sum, r) => sum + r.perc, 0);
            expect(totalPerc).toBeCloseTo(100, 5);
        });

        it('handles decimal ratings correctly', () => {
            const items = [makeItem({ status: 'Read', rating: '4.5' })];
            const { ratingsData } = recalculateStats(items, COLLECTIONS);
            expect(ratingsData[0].label).toBe('4.5 ⭐');
            expect(ratingsData[0].perc).toBe(100);
        });
    });

    describe('edge cases', () => {
        it('handles large number of items without errors', () => {
            const items = Array.from({ length: 500 }, (_, i) => makeItem({
                status: i % 2 === 0 ? 'Read' : 'Reading',
                genre: `Genre ${i % 10}`,
                rating: `${(i % 5) + 1}`,
            }));
            const result = recalculateStats(items, COLLECTIONS);
            expect(result.totalItems).toBe(500);
            expect(result.finishedItemsCount).toBe(250);
            expect(result.genresData.length).toBeGreaterThan(0);
            expect(result.ratingsData.length).toBeGreaterThan(0);
        });

        it('does not crash with empty collections list', () => {
            const items = [makeItem({ status: 'Read' })];
            const { finishedItemsCount } = recalculateStats(items, []);
            expect(finishedItemsCount).toBe(0);
        });
    });
});
