import { describe, expect, it } from 'vitest';
import { parseDuration, SESSION_ROW_REGEX } from '../src/utils';

describe('Telegram session log rows', () => {
    it('are readable by the statistics session parser', () => {
        const row = '| 23:40 - 23:50 | Telegram | Habit-Programming | 00:10:33 | - | - |';
        const match = row.match(SESSION_ROW_REGEX);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe('23');
        expect(match?.[2]).toBe('Habit-Programming');
        expect(parseDuration(match?.[3])).toBe(633);
    });
});
