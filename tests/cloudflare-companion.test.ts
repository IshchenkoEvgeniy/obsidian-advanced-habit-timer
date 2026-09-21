import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { createSnapshots, habitGoals } from '../cloudflare-companion/src/stats';
import { renderDailyCard, renderHabitCard } from '../cloudflare-companion/src/png';
import { zonedParts } from '../cloudflare-companion/src/time';
import type { HabitConfig, HabitValueRow } from '../cloudflare-companion/src/types';

const habit: HabitConfig = {
    name: 'Habit-Read', type: 'timer', goalMinutes: 60, minimumGoalMinutes: 20, createdAt: '2026-01-01'
};

describe('Cloudflare companion statistics', () => {
    it('uses canonical seconds for timer goals', () => {
        expect(habitGoals(habit, '2026-07-18')).toEqual({ minimum: 1200, desired: 3600, mode: 'daily' });
    });

    it('calculates completion, averages and streaks from synchronized values', () => {
        const values: HabitValueRow[] = [
            row('2026-07-16', 3600), row('2026-07-17', 1200), row('2026-07-18', 600)
        ];
        const snapshot = createSnapshots([habit], values, '2026-07-18', 3)[0]!;
        expect(snapshot.days.map(day => day.state)).toEqual(['completed', 'partial', 'pending']);
        expect(snapshot.currentStreak).toBe(2);
        expect(snapshot.bestStreak).toBe(2);
        expect(snapshot.completionRate).toBe(100);
        expect(snapshot.total).toBe(5400);
    });

    it('uses the configured timezone for server schedules', () => {
        const parts = zonedParts(Date.UTC(2026, 6, 18, 20, 30), 'Europe/Kyiv');
        expect(parts.date).toBe('2026-07-18');
        expect(parts.time).toBe('23:30');
    });
});

describe('Cloudflare companion PNG renderer', () => {
    const snapshot = createSnapshots([habit], [row('2026-07-18', 3600)], '2026-07-18', 84)[0]!;

    it('renders a valid habit card PNG', () => {
        verifyPng(renderHabitCard(snapshot), 720, 440);
    });

    it('renders a valid daily report PNG', () => {
        const image = renderDailyCard([snapshot], '2026-07-18');
        verifyPng(image, 720, 340);
    });
});

function row(date: string, value: number): HabitValueRow {
    return { profile_id: 'default', habit_name: habit.name, habit_date: date, value, state: null, updated_at: 0 };
}

function verifyPng(image: Uint8Array, width: number, height: number): void {
    expect([...image.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    let offset = 8;
    const idat: Buffer[] = [];
    while (offset < image.length) {
        const length = readU32(image, offset);
        const type = new TextDecoder().decode(image.slice(offset + 4, offset + 8));
        const data = image.slice(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            expect(readU32(data, 0)).toBe(width);
            expect(readU32(data, 4)).toBe(height);
        }
        if (type === 'IDAT') idat.push(Buffer.from(data));
        offset += length + 12;
    }
    const pixels = inflateSync(Buffer.concat(idat));
    expect(pixels.length).toBe((width * 3 + 1) * height);
}

function readU32(data: Uint8Array, offset: number): number {
    return (((data[offset] || 0) << 24) | ((data[offset + 1] || 0) << 16) | ((data[offset + 2] || 0) << 8) | (data[offset + 3] || 0)) >>> 0;
}
