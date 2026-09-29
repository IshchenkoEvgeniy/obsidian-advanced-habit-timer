import { describe, it, expect } from 'vitest';
import { weekKpis, weekdayRhythm, bestWeekday } from '../src/stats/dashboard';

const today = '2026-09-29'; // Tuesday
const days = [
    { date: '2026-09-21', focusSec: 7200, tasksDone: 4 }, // Mon prev
    { date: '2026-09-22', focusSec: 9000, tasksDone: 5 }, // Tue prev
    { date: '2026-09-23', focusSec: 0, tasksDone: 0 },
    { date: '2026-09-24', focusSec: 5400, tasksDone: 3 },
    { date: '2026-09-25', focusSec: 3600, tasksDone: 2 },
    { date: '2026-09-26', focusSec: 1800, tasksDone: 1 },
    { date: '2026-09-27', focusSec: 0, tasksDone: 0 },
    { date: '2026-09-28', focusSec: 8000, tasksDone: 6 }, // Mon cur
    { date: '2026-09-29', focusSec: 10000, tasksDone: 7 } // Tue cur (today)
];

describe('weekKpis', () => {
    it('sums current week (Mon..today) and previous full week', () => {
        const kpis = weekKpis(days, today);
        expect(kpis[0].id).toBe('focus_week');
        expect(kpis[0].value).toBe(18000); // 8000+10000
        expect(kpis[1].value).toBe(13);    // 6+7
        expect(kpis[2].value).toBe(27000); // prev week 7200+9000+5400+3600+1800
        expect(kpis[3].value).toBe(15);
    });
    it('computes percent delta vs previous week', () => {
        const [focus] = weekKpis(days, today);
        expect(focus.delta).toBe(-33); // 18000 vs 27000 => -33%
    });
    it('delta null when previous week was empty', () => {
        const [focus] = weekKpis([{ date: '2026-09-28', focusSec: 3600, tasksDone: 1 }], '2026-09-29');
        expect(focus.delta).toBeNull();
    });
});

describe('weekdayRhythm', () => {
    it('averages focus per weekday over window', () => {
        const rhythm = weekdayRhythm(days, today, 28);
        // Mon: (7200+8000)/2 = 7600
        expect(rhythm[0]).toBe(7600);
        // Tue: (9000+10000)/2 = 9500
        expect(rhythm[1]).toBe(9500);
    });
    it('ignores days outside window', () => {
        const rhythm = weekdayRhythm([{ date: '2026-06-01', focusSec: 99999, tasksDone: 0 }], today, 28);
        expect(rhythm.every(v => v === 0)).toBe(true);
    });
});

describe('bestWeekday', () => {
    it('returns index of max mean', () => {
        const rhythm = weekdayRhythm(days, today, 28);
        expect(bestWeekday(rhythm)).toBe(1); // Tuesday 9500
    });
    it('null when no data', () => {
        expect(bestWeekday([0, 0, 0, 0, 0, 0, 0])).toBeNull();
    });
});
