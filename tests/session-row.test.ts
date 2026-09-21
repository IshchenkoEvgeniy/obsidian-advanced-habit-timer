import { describe, it, expect } from 'vitest';
import { SESSION_ROW_REGEX, parseDuration } from '../src/utils';

/**
 * Actual session row format written by timer-view.ts:
 *
 *   | HH:MM - HH:MM | Mode | DisplayProp | HH:MM:SS | Pages | Note |
 *
 * SESSION_ROW_REGEX capture groups (verified by running against real rows):
 *   m[1] — start hour string (2 digits, e.g. "09")
 *   m[2] — DisplayProp / habit name (the `.*?` between | Mode | and | greedily skips mode icon)
 *   m[3] — duration "HH:MM:SS"
 *   m[4] — trailing field (note / task / page count)
 *
 * This mirrors what fetchSessionsFromFile() does with m[2] and m[3].
 */
function parseSessionRow(line: string) {
    const m = line.match(SESSION_ROW_REGEX);
    if (!m || !m[1] || !m[2] || !m[3]) return null;

    const startHour = parseInt(m[1]);
    const rawHabit = m[2].trim();
    const parts = rawHabit.split(':');
    const habitName = (parts[0] || rawHabit).trim();
    const subTask = (parts[1] || '').trim();
    const durationSec = parseDuration(m[3]);
    const task = m[4] ? m[4].trim() : '';

    return { startHour, habit: habitName, subTask, durationSec, task };
}

// ─── Real row format (matches timer-view.ts output) ──────────────────────────

const ROW_SIMPLE   = '| 09:00 - 09:30 | ⏱️ | Reading | 00:30:00 | - | - |';
const ROW_SUBTASK  = '| 14:15 - 15:00 | ⏱️ | Programming: Refactoring | 00:45:00 | - | - |';
const ROW_TASK     = '| 20:00 - 21:30 | ⏱️ | Deep Work | 01:30:00 | - | Fix auth bug |';
const ROW_PM       = '| 07:00 - 07:25 | 🍅 | Reading | 00:25:00 | - | - |';
const ROW_LONG_DUR = '| 23:00 - 00:30 | ⏱️ | Sleep Training | 01:30:45 | - | - |';
const ROW_ZERO_DUR = '| 10:00 - 10:00 | ⏱️ | Habit | 00:00:00 | - | - |';

// ─── Matching ─────────────────────────────────────────────────────────────────

describe('SESSION_ROW_REGEX — basic matching', () => {
    it('matches the real row format', () => {
        expect(ROW_SIMPLE.match(SESSION_ROW_REGEX)).not.toBeNull();
        expect(ROW_SUBTASK.match(SESSION_ROW_REGEX)).not.toBeNull();
        expect(ROW_TASK.match(SESSION_ROW_REGEX)).not.toBeNull();
        expect(ROW_PM.match(SESSION_ROW_REGEX)).not.toBeNull();
    });

    it('does NOT match non-table lines', () => {
        expect('Just some text'.match(SESSION_ROW_REGEX)).toBeNull();
        expect(''.match(SESSION_ROW_REGEX)).toBeNull();
        expect('- [ ] Task without pipes'.match(SESSION_ROW_REGEX)).toBeNull();
        expect('| Time | Mode | Property | Duration | Pages | Task |'.match(SESSION_ROW_REGEX)).toBeNull();
    });
});

// ─── Group capture ────────────────────────────────────────────────────────────

describe('SESSION_ROW_REGEX — group capture', () => {
    it('m[1] is the 2-digit start hour string', () => {
        const m = ROW_SIMPLE.match(SESSION_ROW_REGEX);
        expect(m).not.toBeNull();
        expect(m![1]).toBe('09');
    });

    it('m[2] is the DisplayProp (habit name), m[3] is duration', () => {
        const m = ROW_SIMPLE.match(SESSION_ROW_REGEX);
        expect(m![2]).toBe('Reading');
        expect(m![3]).toBe('00:30:00');
    });

    it('m[2] includes "SubTask" suffix in "Habit: SubTask" rows', () => {
        const m = ROW_SUBTASK.match(SESSION_ROW_REGEX);
        expect(m![2]).toContain('Programming');
        expect(m![2]).toContain('Refactoring');
    });
});

// ─── Full parse (mirrors fetchSessionsFromFile) ───────────────────────────────

describe('parseSessionRow', () => {
    it('extracts startHour, habit, duration from a simple row', () => {
        const result = parseSessionRow(ROW_SIMPLE);
        expect(result).not.toBeNull();
        expect(result!.startHour).toBe(9);
        expect(result!.habit).toBe('Reading');
        expect(result!.subTask).toBe('');
        expect(result!.durationSec).toBe(1800); // 30 min
    });

    it('splits "Habit: SubTask" correctly', () => {
        const result = parseSessionRow(ROW_SUBTASK);
        expect(result).not.toBeNull();
        expect(result!.habit).toBe('Programming');
        expect(result!.subTask).toBe('Refactoring');
        expect(result!.durationSec).toBe(2700); // 45 min
    });

    it('captures trailing task/note field', () => {
        const result = parseSessionRow(ROW_TASK);
        expect(result).not.toBeNull();
        expect(result!.habit).toBe('Deep Work');
        expect(result!.task).toBe('Fix auth bug');
        expect(result!.durationSec).toBe(5400); // 1.5 h
    });

    it('parses pomodoro row (🍅 mode) correctly', () => {
        const result = parseSessionRow(ROW_PM);
        expect(result).not.toBeNull();
        expect(result!.startHour).toBe(7);
        expect(result!.habit).toBe('Reading');
        expect(result!.durationSec).toBe(1500); // 25 min
    });

    it('parses 01:30:45 duration correctly', () => {
        const result = parseSessionRow(ROW_LONG_DUR);
        expect(result).not.toBeNull();
        expect(result!.startHour).toBe(23);
        expect(result!.durationSec).toBe(5445); // 1h 30m 45s
    });

    it('returns 0 durationSec for 00:00:00', () => {
        const result = parseSessionRow(ROW_ZERO_DUR);
        expect(result).not.toBeNull();
        expect(result!.durationSec).toBe(0);
    });

    it('returns null for non-table lines', () => {
        expect(parseSessionRow('Some random line')).toBeNull();
        expect(parseSessionRow('')).toBeNull();
    });
});

// ─── Start hour extraction ────────────────────────────────────────────────────

describe('SESSION_ROW_REGEX — start hour extraction', () => {
    it.each([
        ['| 00:00 - 00:30 | ⏱️ | H | 00:30:00 | - | - |', 0],
        ['| 07:45 - 08:15 | ⏱️ | H | 00:30:00 | - | - |', 7],
        ['| 12:00 - 13:00 | ⏱️ | H | 01:00:00 | - | - |', 12],
        ['| 23:59 - 00:00 | ⏱️ | H | 00:01:00 | - | - |', 23],
    ] as [string, number][])('%s → startHour %i', (row, expectedHour) => {
        const m = row.match(SESSION_ROW_REGEX);
        expect(m).not.toBeNull();
        expect(parseInt(m![1])).toBe(expectedHour);
    });
});
