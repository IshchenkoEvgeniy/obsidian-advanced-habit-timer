import { describe, it, expect } from 'vitest';
import { normalizeStatus, isDone, isInProgress, isActive } from '../src/utils/status';

describe('normalizeStatus', () => {
    // ── "done" group ──────────────────────────────────────────────────────────

    it.each([
        'done',
        'Done',
        'DONE',
        'completed',
        'Completed',
        'finished',
        'Finished',
        'завершено',
        'Завершено',
        'прочитано',
        'пройдено',
        'просмотрено',
        'готово',
        'Готово',
        'Done ✅',            // emoji suffix
        '  done  ',          // surrounding whitespace
    ])('returns "done" for %s', (status) => {
        expect(normalizeStatus(status)).toBe('done');
    });

    // ── "in-progress" group ───────────────────────────────────────────────────

    it.each([
        'in progress',
        'In Progress',
        'progress',
        'в работе',
        'в процессе',
        'doing',
        'изучаю',
        'смотрю',
        'играю',
        'читаю',
        '📚 читаю',           // emoji prefix
        'In Progress →',     // suffix
    ])('returns "in-progress" for %s', (status) => {
        expect(normalizeStatus(status)).toBe('in-progress');
    });

    // ── "todo" group ──────────────────────────────────────────────────────────

    it.each([
        '',
        'todo',
        'TODO',
        'to do',
        'backlog',
        'Backlog',
        'не начато',
        'planned',
        'Planned',
    ])('returns "todo" for %s', (status) => {
        expect(normalizeStatus(status)).toBe('todo');
    });

    // ── "unknown" ─────────────────────────────────────────────────────────────

    it.each([
        'review',
        'on hold',
        'blocked',
        'random text',
        '???',
    ])('returns "unknown" for %s', (status) => {
        expect(normalizeStatus(status)).toBe('unknown');
    });

    // ── guard against bad input ───────────────────────────────────────────────

    it('handles null/undefined gracefully via nullish coalescing', () => {
        // The function uses (status ?? '').toLowerCase() so null/undefined → ''
        expect(normalizeStatus(null as unknown as string)).toBe('todo');
        expect(normalizeStatus(undefined as unknown as string)).toBe('todo');
    });
});

describe('isDone', () => {
    it('returns true for "завершено"', () => expect(isDone('завершено')).toBe(true));
    it('returns true for "done"',      () => expect(isDone('done')).toBe(true));
    it('returns false for "читаю"',    () => expect(isDone('читаю')).toBe(false));
    it('returns false for ""',         () => expect(isDone('')).toBe(false));
});

describe('isInProgress', () => {
    it('returns true for "in progress"', () => expect(isInProgress('in progress')).toBe(true));
    it('returns true for "читаю"',       () => expect(isInProgress('читаю')).toBe(true));
    it('returns false for "done"',       () => expect(isInProgress('done')).toBe(false));
    it('returns false for ""',           () => expect(isInProgress('')).toBe(false));
});

describe('isActive', () => {
    it('returns true for "todo"',        () => expect(isActive('todo')).toBe(true));
    it('returns true for "in progress"', () => expect(isActive('in progress')).toBe(true));
    it('returns true for "unknown"',     () => expect(isActive('review')).toBe(true));
    it('returns false for "done"',       () => expect(isActive('done')).toBe(false));
    it('returns false for "завершено"',  () => expect(isActive('завершено')).toBe(false));
});
