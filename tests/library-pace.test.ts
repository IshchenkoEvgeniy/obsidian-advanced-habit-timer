import { describe, expect, it } from 'vitest';
import { calculateMediaPace } from '../src/library/pace';

describe('library completion pace', () => {
    it('calculates an inclusive daily pace', () => {
        expect(calculateMediaPace(40, 100, '2026-07-23', '2026-07-21')).toEqual({
            remaining: 60, daysRemaining: 3, perDay: 20, overdue: false
        });
    });

    it('marks overdue targets and keeps a useful one-day pace', () => {
        expect(calculateMediaPace(75, 100, '2026-07-20', '2026-07-21')).toEqual({
            remaining: 25, daysRemaining: 1, perDay: 25, overdue: true
        });
    });

    it('ignores incomplete target data', () => {
        expect(calculateMediaPace(0, 0, '2026-07-23', '2026-07-21')).toBeNull();
        expect(calculateMediaPace(0, 100, '', '2026-07-21')).toBeNull();
    });
});
