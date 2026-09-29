/**
 * Journal grouping for the Tasks list layout (concept "Журнал списка").
 * Pure logic, no Obsidian imports — unit-testable. Dates are 'YYYY-MM-DD'.
 */

export interface JournalTaskInput {
    name: string;
    date: string;
    deadline?: string;
    done: boolean;
    priority?: string;
    list?: string;
    repeat?: unknown;
}

export type JournalGroup = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'nodate' | 'done';

export interface JournalSection {
    id: JournalGroup;
    titleKey: string;
    count: number;
    /** true when the group content can be folded (done tasks) */
    foldable: boolean;
}

/** Effective day a task belongs to: deadline wins, else planned date. */
export function journalDay(task: JournalTaskInput): string {
    return (task.deadline && task.deadline.length >= 10 ? task.deadline.slice(0, 10) : '') || task.date || '';
}

/** Order groups always appear in. */
export const JOURNAL_ORDER: JournalGroup[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'nodate', 'done'];

/** Assign a task (already date-filtered) to its journal group. */
export function journalGroupOf(task: JournalTaskInput, today: string): JournalGroup {
    if (task.done) return 'done';
    const day = journalDay(task);
    if (!day) return 'nodate';
    if (day < today) return 'overdue';
    if (day === today) return 'today';
    if (day === addDays(today, 1)) return 'tomorrow';
    if (day <= addDays(today, 7)) return 'week';
    return 'later';
}

/** Group visible tasks, keeping JOURNAL_ORDER for non-empty sections. */
export function groupJournal(tasks: JournalTaskInput[], today: string): Array<{ id: JournalGroup; tasks: JournalTaskInput[] }> {
    const buckets = new Map<JournalGroup, JournalTaskInput[]>();
    for (const task of tasks) {
        const id = journalGroupOf(task, today);
        if (!buckets.has(id)) buckets.set(id, []);
        buckets.get(id)!.push(task);
    }
    const byDay = (a: JournalTaskInput, b: JournalTaskInput) => journalDay(a).localeCompare(journalDay(b)) || a.name.localeCompare(b.name);
    return JOURNAL_ORDER.filter(id => buckets.has(id)).map(id => {
        const items = buckets.get(id)!;
        items.sort(id === 'nodate' || id === 'done' ? (a, b) => a.name.localeCompare(b.name) : byDay);
        return { id, tasks: items };
    });
}

function addDays(iso: string, days: number): string {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
