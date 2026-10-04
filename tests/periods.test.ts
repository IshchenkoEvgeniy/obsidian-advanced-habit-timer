import { describe, it, expect } from 'vitest';
import { trendComparison, inPeriod, PERIODS } from '../src/stats/periods';

const daily = [
    { date: '2026-08-30', value: 100 },
    { date: '2026-08-31', value: 200 },
    { date: '2026-09-28', value: 500 },
    { date: '2026-09-29', value: 700 } // last/today
];
const today = '2026-09-29';

describe('trendComparison', () => {
    it('day: compares today vs yesterday', () => {
        const r = trendComparison(daily, 'day', today);
        expect(r.current).toBe(700);
        expect(r.previous).toBe(500);
        expect(r.deltaPct).toBe(40);
    });
    it('week: current 7-day window vs previous 7-day window', () => {
        const r = trendComparison(daily, 'week', today);
        // cur window: 2026-09-23..29 -> 500+700=1200; prev: 09-16..22 -> 0
        expect(r.current).toBe(1200);
        expect(r.previous).toBe(0);
        expect(r.deltaPct).toBeNull(); // prev=0, cur>0
    });
    it('month uses 30-day windows', () => {
        const r = trendComparison(daily, 'month', today);
        // cur: 08-31..09-29 -> 200+500+700=1400; prev: 08-01..08-30 -> 100
        expect(r.current).toBe(1400);
        expect(r.previous).toBe(100);
        expect(r.deltaPct).toBe(1300);
    });
    it('all: sums everything, delta null', () => {
        const r = trendComparison(daily, 'all');
        expect(r.current).toBe(1500);
        expect(r.deltaPct).toBeNull();
    });
    it('ends the comparison today even when the last record is old', () => {
        expect(trendComparison(daily, 'day', '2026-10-04')).toEqual({ current: 0, previous: 0, deltaPct: 0 });
    });
    it('ignores future records when comparing current and previous periods', () => {
        expect(trendComparison([...daily, { date: '2027-01-01', value: 9999 }], 'day', today))
            .toEqual({ current: 700, previous: 500, deltaPct: 40 });
    });
});

describe('inPeriod', () => {
    const today = '2026-09-29';
    it('day keeps only today', () => {
        expect(inPeriod('2026-09-29', 'day', today)).toBe(true);
        expect(inPeriod('2026-09-28', 'day', today)).toBe(false);
    });
    it('month keeps last 30 days inclusive', () => {
        expect(inPeriod('2026-08-31', 'month', today)).toBe(true);
        expect(inPeriod('2026-08-30', 'month', today)).toBe(false);
        expect(inPeriod('2026-09-29', 'month', today)).toBe(true);
    });
    it('all keeps everything', () => {
        expect(inPeriod('2020-01-01', 'all', today)).toBe(true);
    });
});

describe('PERIODS', () => {
    it('has the 7 requested options in order', () => {
        expect(PERIODS.map(p => p.id)).toEqual(['day', 'week', 'month', 'd90', 'half', 'year', 'all']);
    });
});
