import { describe, expect, it } from 'vitest';
import { renderWeeklyCard } from '../cloudflare-companion/src/png';
import { createSnapshots } from '../cloudflare-companion/src/stats';
import { buildWeeklyOverview } from '../cloudflare-companion/src/weekly';
import type {
    CompanionEventRow, HabitConfig, HabitValueRow, LibraryItemRow, ProjectTaskRow
} from '../cloudflare-companion/src/types';

const habit: HabitConfig = {
    name: 'Habit-Read', type: 'timer', goalMinutes: 30, createdAt: '2026-01-01'
};

describe('Telegram weekly review', () => {
    it('compares two weeks and renders the complete PNG card', () => {
        const values: HabitValueRow[] = [];
        for (let day = 8; day <= 21; day++) {
            values.push(habitRow(`2026-07-${String(day).padStart(2, '0')}`, day >= 15 ? 1800 : 900));
        }
        const snapshots = createSnapshots([habit], values, '2026-07-21', 14);
        const library = [libraryRow()];
        const events = [progressEvent('2026-07-14', 5), progressEvent('2026-07-18', 25)];
        const overview = buildWeeklyOverview(
            snapshots, library, events, [libraryRow()], [], [projectRow()], [], '2026-07-15', '2026-07-21'
        );

        expect(overview.current.habitScore).toBe(100);
        expect(overview.previous.habitScore).toBe(0);
        expect(overview.current.pagesRead).toBe(25);
        expect(overview.previous.pagesRead).toBe(5);
        expect(overview.current.mediaCompleted).toBe(1);
        expect(overview.current.tasksCompleted).toBe(1);
        expectPngSize(renderWeeklyCard(overview), 900, 730);
    });
});

function habitRow(date: string, value: number): HabitValueRow {
    return { profile_id: 'default', habit_name: habit.name, habit_date: date, value, state: null, updated_at: 0 };
}

function libraryRow(): LibraryItemRow {
    return {
        id: 1, profile_id: 'default', item_path: 'Library/Book.md', title: 'Book', collection_id: 'book',
        status: 'Reading', format: 'Paper', rating: '', total: 300, progress: 100, authors_json: '[]',
        genres_json: '[]', series: '', series_index: 0, unit: 'pages', cover_url: '', start_date: '',
        end_date: '2026-07-20', reading_status: 'Reading', finished_status: 'Completed', season: 0,
        episode: 0, updated_at: 0
    };
}

function progressEvent(date: string, delta: number): CompanionEventRow {
    return {
        sequence: 1, event_id: `${date}-${delta}`, event_type: 'library_update', habit_name: 'Library/Book.md',
        habit_date: date, amount: null, state: null, payload_json: JSON.stringify({ progressLog: { delta } }), created_at: 0
    };
}

function projectRow(): ProjectTaskRow {
    return {
        profile_id: 'default', task_key: 'project:task', scope_id: 'project', scope_name: 'Project',
        file_path: 'Projects/Task.md', task_name: 'Task', status: 'Done', priority: 'high', start_date: '',
        end_date: '2026-07-19', time_spent_sec: 3600, time_estimated_sec: 3600, done: 1, updated_at: 0
    };
}

function expectPngSize(image: Uint8Array, width: number, height: number): void {
    expect([...image.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
    expect(view.getUint32(16)).toBe(width);
    expect(view.getUint32(20)).toBe(height);
}
