/**
 * Centralized status normalization utilities.
 *
 * Problem: status comparisons were scattered across 7 files using raw string includes(),
 * each with slightly different sets of keywords. This made it easy for statuses like
 * "Completed", "Готово", "Finished" or "Done ✅" to slip through unrecognized.
 *
 * Solution: a single normalizeStatus() function that maps any user-visible status string
 * to a canonical NormalizedStatus value. All call sites use isDone() / isInProgress()
 * helpers instead of inline includes().
 */

export type NormalizedStatus = 'done' | 'in-progress' | 'todo' | 'unknown';

/**
 * Maps a raw user-facing status string to a canonical NormalizedStatus.
 * Matching is case-insensitive and trims surrounding whitespace.
 *
 * "done" group    — done, завершено, completed, finished, прочитано, пройдено, просмотрено
 * "in-progress"   — in progress, в работе, progress, в процессе, doing, изучаю, смотрю, играю, читаю, читаю
 * "todo"          — todo, backlog, to do, не начато, planned
 * "unknown"       — anything else
 */
export function normalizeStatus(status: string): NormalizedStatus {
    const s = (status ?? '').toLowerCase().trim();

    if (
        s.includes('done') ||
        s.includes('завершено') ||
        s.includes('completed') ||
        s.includes('finished') ||
        s.includes('прочитано') ||
        s.includes('пройдено') ||
        s.includes('просмотрено') ||
        s.includes('готово')
    ) return 'done';

    if (
        s.includes('progress') ||
        s.includes('в работе') ||
        s.includes('в процессе') ||
        s.includes('doing') ||
        s.includes('изучаю') ||
        s.includes('смотрю') ||
        s.includes('играю') ||
        s.includes('читаю') ||
        s.includes('читаю')
    ) return 'in-progress';

    if (
        s === '' ||
        s.includes('todo') ||
        s.includes('to do') ||
        s.includes('backlog') ||
        s.includes('не начато') ||
        s.includes('planned')
    ) return 'todo';

    return 'unknown';
}

/** Returns true if the status indicates the task/item is finished. */
export function isDone(status: string): boolean {
    return normalizeStatus(status) === 'done';
}

/** Returns true if the status indicates active work in progress. */
export function isInProgress(status: string): boolean {
    return normalizeStatus(status) === 'in-progress';
}

/** Returns true if the task is neither done nor explicitly in-progress (backlog/todo/unknown). */
export function isActive(status: string): boolean {
    const n = normalizeStatus(status);
    return n === 'todo' || n === 'in-progress' || n === 'unknown';
}
