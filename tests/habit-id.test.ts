import { describe, expect, it } from 'vitest';
import { ensureHabitPropertyIds, habitId, normalizeHabitId } from '../src/integration/habit-id';
import type { HabitProperty } from '../src/types';

describe('habit integration IDs', () => {
    it('keeps existing unique IDs unchanged', () => {
        const properties: HabitProperty[] = [
            { id: 'habit-a', name: 'A', goalMinutes: 10, globalGoalHours: 1 },
            { id: 'habit-b', name: 'B', goalMinutes: 10, globalGoalHours: 1 }
        ];

        expect(ensureHabitPropertyIds(properties, () => 'unused')).toBe(false);
        expect(properties.map(property => property.id)).toEqual(['habit-a', 'habit-b']);
    });

    it('adds missing IDs and repairs duplicates', () => {
        const generated = ['habit-generated-a', 'habit-generated-b'];
        const properties: HabitProperty[] = [
            { name: 'A', goalMinutes: 10, globalGoalHours: 1 },
            { id: 'duplicate', name: 'B', goalMinutes: 10, globalGoalHours: 1 },
            { id: 'duplicate', name: 'C', goalMinutes: 10, globalGoalHours: 1 }
        ];

        expect(ensureHabitPropertyIds(properties, () => generated.shift() || 'fallback')).toBe(true);
        expect(properties.map(property => property.id)).toEqual([
            'habit-generated-a',
            'duplicate',
            'habit-generated-b'
        ]);
    });

    it('trims IDs and exposes a legacy fallback before migration', () => {
        const property: HabitProperty = { name: 'Read', goalMinutes: 15, globalGoalHours: 10 };
        expect(normalizeHabitId('  habit-read  ')).toBe('habit-read');
        expect(habitId(property)).toBe('legacy:Read');
    });
});

