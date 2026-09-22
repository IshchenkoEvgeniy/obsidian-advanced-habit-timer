import { describe, expect, it } from 'vitest';
import {
    MAX_RANGE_DAYS,
    addDays,
    buildTimeline,
    normalizeDate,
    startOfMonth,
    type TimelineTaskInput
} from '../src/projects/timeline';

const TODAY = '2026-09-22';
const COLUMNS = ['Backlog', 'To Do', 'In Progress', 'Done'];

function task(id: string, changes: Partial<TimelineTaskInput> = {}): TimelineTaskInput {
    return {
        id,
        name: id,
        status: 'To Do',
        ...changes
    };
}

describe('project timeline grouping', () => {
    it('splits tasks into bars, milestones and a no-dates group', () => {
        const model = buildTimeline([
            task('bar', { startDate: '2026-09-10', endDate: '2026-09-15' }),
            task('milestone', { endDate: '2026-10-01' }),
            task('starts', { startDate: '2026-09-25' }),
            task('floating', {})
        ], COLUMNS, TODAY);

        expect(model.bars.map(item => item.task.id)).toEqual(['bar']);
        expect(model.milestones.map(item => item.task.id)).toEqual(['starts', 'milestone']);
        expect(model.noDates.map(item => item.id)).toEqual(['floating']);
        expect(model.start).toBe(startOfMonth(TODAY));
        // The range stretches to cover the whole month of the latest date (2026-10-01).
        expect(model.end).toBe('2026-10-31');
    });

    it('keeps no-dates tasks sorted by name and never drops them', () => {
        const model = buildTimeline([
            task('zeta', {}),
            task('alpha', {}),
            task('mid', {})
        ], COLUMNS, TODAY);

        expect(model.noDates.map(item => item.id)).toEqual(['alpha', 'mid', 'zeta']);
        expect(model.bars).toHaveLength(0);
        expect(model.milestones).toHaveLength(0);
    });

    it('extends the visible range when tasks go beyond the current month', () => {
        const model = buildTimeline([
            task('wide', { startDate: '2026-08-05', endDate: '2026-11-02' })
        ], COLUMNS, TODAY);

        expect(model.start).toBe('2026-08-01');
        expect(model.end).toBe('2026-11-30');
        expect(model.months.map(month => month.id)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    });
});

describe('project timeline overdue and done', () => {
    it('marks unfinished tasks with a past endDate as overdue', () => {
        const model = buildTimeline([
            task('late', { endDate: '2026-09-21' }),
            task('ok', { endDate: TODAY }),
            task('future', { endDate: '2026-09-23' })
        ], COLUMNS, TODAY);

        const late = model.milestones.find(item => item.task.id === 'late');
        const ok = model.milestones.find(item => item.task.id === 'ok');
        const future = model.milestones.find(item => item.task.id === 'future');
        expect(late?.overdue).toBe(true);
        expect(ok?.overdue).toBe(false);
        expect(future?.overdue).toBe(false);
        expect(model.overdueCount).toBe(1);
    });

    it('never marks done tasks as overdue, including the last configured column', () => {
        const model = buildTimeline([
            task('finished', { status: 'Done', endDate: '2026-08-01' }),
            task('lastColumn', { status: 'Done', startDate: '2026-08-01', endDate: '2026-08-02' }),
            task('stillOpen', { status: 'In Progress', endDate: '2026-08-01' })
        ], COLUMNS, TODAY);

        const finished = model.milestones.find(item => item.task.id === 'finished');
        const lastColumn = model.bars.find(item => item.task.id === 'lastColumn');
        const stillOpen = model.milestones.find(item => item.task.id === 'stillOpen');
        expect(finished?.done).toBe(true);
        expect(finished?.overdue).toBe(false);
        expect(lastColumn?.done).toBe(true);
        expect(lastColumn?.overdue).toBe(false);
        expect(stillOpen?.overdue).toBe(true);
        expect(model.overdueCount).toBe(1);
    });

    it('computes subtask progress percent for bars', () => {
        const model = buildTimeline([
            task('progress', {
                startDate: '2026-09-01',
                endDate: '2026-09-10',
                subtasks: [{ checked: true }, { checked: true }, { checked: false }, { checked: false }]
            })
        ], COLUMNS, TODAY);

        expect(model.bars[0]?.progressPct).toBe(50);
    });
});

describe('project timeline month boundaries', () => {
    it('aligns range edges to month boundaries and keeps today inside', () => {
        const model = buildTimeline([], COLUMNS, TODAY);
        expect(model.start).toBe('2026-09-01');
        expect(model.end).toBe('2026-09-30');
        expect(model.todayPct).not.toBeNull();
        expect(model.months[0]?.days).toBe(30);
    });

    it('positions a bar across two months with sane percentages', () => {
        const model = buildTimeline([
            task('span', { startDate: '2026-09-28', endDate: '2026-10-04' })
        ], COLUMNS, TODAY);

        const span = model.bars[0];
        expect(span).toBeDefined();
        // 61 visible days: 2026-09-01 .. 2026-10-31
        expect(model.days).toBe(61);
        expect(span!.offsetPct).toBeCloseTo(27 / 61 * 100, 0);
        expect(span!.widthPct).toBeCloseTo(7 / 61 * 100, 0);
        expect(span!.clampedStart).toBe(false);
        expect(span!.clampedEnd).toBe(false);
    });

    it('clamps tasks that start before or end after the visible range', () => {
        const model = buildTimeline([
            task('old', { startDate: '2024-01-01', endDate: '2024-01-31' }),
            task('far', { startDate: '2030-01-01', endDate: '2030-02-01' })
        ], COLUMNS, TODAY);

        expect(model.days).toBeLessThanOrEqual(MAX_RANGE_DAYS);
        const old = model.bars.find(item => item.task.id === 'old');
        const far = model.bars.find(item => item.task.id === 'far');
        expect(old!.clampedStart).toBe(true);
        expect(old!.clampedEnd).toBe(true);
        expect(old!.start).toBe(model.start);
        expect(far!.clampedStart).toBe(true);
        expect(far!.start).toBe(model.end);
    });

    it('tolerates reversed dates by swapping start and end', () => {
        const model = buildTimeline([
            task('reversed', { startDate: '2026-09-20', endDate: '2026-09-10' })
        ], COLUMNS, TODAY);

        const reversed = model.bars[0];
        expect(reversed).toBeDefined();
        expect(reversed!.start <= reversed!.end).toBe(true);
        expect(reversed!.actualStart).toBe('2026-09-10');
        expect(reversed!.actualEnd).toBe('2026-09-20');
        expect(reversed!.widthPct).toBeGreaterThan(0);
    });

    it('ignores malformed dates and treats those tasks as undated', () => {
        expect(normalizeDate('2026-13-45')).toBeUndefined();
        expect(normalizeDate('not-a-date')).toBeUndefined();
        expect(normalizeDate('2026-09-22T10:00:00')).toBe('2026-09-22');

        const model = buildTimeline([
            task('broken', { startDate: 'gibberish', endDate: '' })
        ], COLUMNS, TODAY);
        expect(model.noDates.map(item => item.id)).toEqual(['broken']);
    });

    it('groups weeks inside a month without crossing its boundaries', () => {
        const model = buildTimeline([], COLUMNS, TODAY);
        const september = model.months[0]!;
        for (const week of september.weeks) {
            expect(week.start >= september.start).toBe(true);
            expect(week.end <= september.end).toBe(true);
            expect(week.end >= week.start).toBe(true);
        }
        const totalWeekDays = september.weeks.reduce((sum, week) => sum + week.days, 0);
        expect(totalWeekDays).toBe(september.days);
        expect(addDays(september.weeks[0]!.start, 0)).toBe(september.start);
    });
});
