import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { calculateProjectDashboard } from '../src/projects/dashboard-metrics';
import type { ProjectTask } from '../src/projects/types';

function task(id: string, changes: Partial<ProjectTask> = {}): ProjectTask {
    return {
        id,
        file: new TFile(`Projects/${id}.md`),
        name: id,
        status: 'To Do',
        timeSpentSec: 0,
        ...changes
    };
}

describe('project dashboard metrics', () => {
    it('separates completion, overdue tasks and upcoming deadlines', () => {
        const metrics = calculateProjectDashboard([
            task('done', { status: 'Done', endDate: '2026-07-10' }),
            task('late', { endDate: '2026-07-20' }),
            task('soon', { endDate: '2026-07-25' }),
            task('later', { endDate: '2026-08-20' })
        ], ['To Do', 'Done'], '2026-07-22');

        expect(metrics).toMatchObject({ total: 4, done: 1, open: 3, overdue: 1, dueSoon: 1 });
        expect(metrics.riskTaskIds).toContain('late');
        expect(metrics.deadlineBuckets[0]?.count).toBe(1);
    });

    it('calculates estimate coverage and real accumulated time', () => {
        const metrics = calculateProjectDashboard([
            task('estimated', { habitName: 'Work', timeEstimatedSec: 3600, timeSpentSec: 5400 }),
            task('plain', { habitName: 'Work', timeSpentSec: 1800 })
        ], ['To Do', 'Done'], '2026-07-22');

        expect(metrics.totalEstimatedSec).toBe(3600);
        expect(metrics.totalSpentSec).toBe(7200);
        expect(metrics.estimateCoveragePercent).toBe(50);
        expect(metrics.timeUtilizationPercent).toBe(200);
        expect(metrics.habitTime[0]).toMatchObject({ name: 'Work', tasks: 2, seconds: 7200 });
        expect(metrics.riskTaskIds).toContain('estimated');
    });
});
