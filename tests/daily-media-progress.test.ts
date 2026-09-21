import { describe, expect, it } from 'vitest';
import { mediaProgressForDate } from '../src/library/daily-media-progress';

describe('daily media progress', () => {
    it('sums progress rows only for the requested date', () => {
        const content = [
            '### 📖 Progress',
            '| Date | Time | Progress | % | Notes |',
            '|---|---|---|---|---|',
            '| 2026-07-24 | 00:15:00 | 4 | 10% | first |',
            '| 2026-07-24 | 00:20:00 | 3.5 | 20% | second |',
            '| 2026-07-23 | 00:10:00 | 8 | 5% | old |'
        ].join('\n');

        expect(mediaProgressForDate(content, '2026-07-24')).toBe(7.5);
    });

    it('ignores unrelated markdown tables and negative corrections', () => {
        const content = [
            '| 2026-07-24 | task | 99 |',
            '### 📖 Progress',
            '| Date | Time | Progress | % | Notes |',
            '|---|---|---|---|---|',
            '| 2026-07-24 | 00:05:00 | -2 | - | correction |',
            '### Notes',
            '| 2026-07-24 | 00:05:00 | 50 |'
        ].join('\n');

        expect(mediaProgressForDate(content, '2026-07-24')).toBe(0);
    });

    it('supports multiple progress sections', () => {
        const content = [
            '### Progress',
            '| Date | Time | Progress | % | Notes |',
            '| 2026-07-24 | 00:05:00 | 2 | - | one |',
            '## Other',
            '### 📖 Progress',
            '| Date | Time | Progress | % | Notes |',
            '| 2026-07-24 | 00:05:00 | 3 | - | two |'
        ].join('\n');

        expect(mediaProgressForDate(content, '2026-07-24')).toBe(5);
    });
});
