import { describe, it, expect } from 'vitest';
import { parseDuration, formatDuration } from '../src/utils';

describe('parseDuration', () => {
    // ── happy path ────────────────────────────────────────────────────────────

    it('parses HH:MM:SS correctly', () => {
        expect(parseDuration('01:30:00')).toBe(5400);
        expect(parseDuration('00:00:01')).toBe(1);
        expect(parseDuration('10:00:00')).toBe(36000);
        expect(parseDuration('00:59:59')).toBe(3599);
    });

    it('parses 00:00:00 as 0', () => {
        expect(parseDuration('00:00:00')).toBe(0);
    });

    it('handles single-digit hours stored as "1:05:30"', () => {
        // split(':').map(Number) still works if there are exactly 3 parts
        expect(parseDuration('1:05:30')).toBe(3930);
    });

    // ── edge cases ────────────────────────────────────────────────────────────

    it('returns 0 for empty string', () => {
        expect(parseDuration('')).toBe(0);
    });

    it('returns 0 for non-HH:MM:SS strings', () => {
        expect(parseDuration('hello')).toBe(0);
        expect(parseDuration('5')).toBe(0);          // only 1 part
        expect(parseDuration('5:30')).toBe(0);       // only 2 parts — treated as 0
    });

    it('passes a number through unchanged', () => {
        expect(parseDuration(42)).toBe(42);
        expect(parseDuration(0)).toBe(0);
    });

    it('converts boolean true to 1 and false to 0', () => {
        expect(parseDuration(true)).toBe(1);
        expect(parseDuration(false)).toBe(0);
    });

    it('returns 0 for null / undefined / object', () => {
        expect(parseDuration(null)).toBe(0);
        expect(parseDuration(undefined)).toBe(0);
        expect(parseDuration({})).toBe(0);
    });
});

describe('formatDuration', () => {
    it('formats 0 seconds as 00:00:00', () => {
        expect(formatDuration(0)).toBe('00:00:00');
    });

    it('formats 3600 seconds as 01:00:00', () => {
        expect(formatDuration(3600)).toBe('01:00:00');
    });

    it('formats 5399 seconds as 01:29:59', () => {
        expect(formatDuration(5399)).toBe('01:29:59');
    });

    it('pads single-digit minutes and seconds', () => {
        expect(formatDuration(61)).toBe('00:01:01');
    });

    it('parseDuration(formatDuration(n)) round-trips correctly', () => {
        const values = [0, 1, 59, 3600, 7322, 36000];
        for (const v of values) {
            expect(parseDuration(formatDuration(v))).toBe(v);
        }
    });
});
