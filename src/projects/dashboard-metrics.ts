import { isDone } from '../utils/status';
import type { ProjectTask } from './types';

export interface MetricSlice {
    name: string;
    count: number;
    percent: number;
}

export interface HabitTimeSlice {
    name: string;
    tasks: number;
    seconds: number;
    percent: number;
}

export interface DeadlineBucket {
    start: string;
    end: string;
    count: number;
}

export interface ProjectDashboardMetrics {
    total: number;
    done: number;
    open: number;
    overdue: number;
    dueSoon: number;
    withoutDueDate: number;
    withoutEstimate: number;
    totalSpentSec: number;
    totalEstimatedSec: number;
    completionPercent: number;
    estimateCoveragePercent: number;
    timeUtilizationPercent: number;
    statusDistribution: MetricSlice[];
    priorityDistribution: MetricSlice[];
    habitTime: HabitTimeSlice[];
    deadlineBuckets: DeadlineBucket[];
    riskTaskIds: string[];
}

function isoDate(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addDays(value: string, days: number): string {
    const date = new Date(`${value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return isoDate(date);
}

export function calculateProjectDashboard(
    tasks: ProjectTask[],
    columns: string[],
    today: string
): ProjectDashboardMetrics {
    const doneStatus = columns[columns.length - 1] || 'Done';
    const taskIsDone = (task: ProjectTask): boolean => isDone(task.status) || task.status === doneStatus;
    const done = tasks.filter(taskIsDone).length;
    const openTasks = tasks.filter(task => !taskIsDone(task));
    const dueSoonEnd = addDays(today, 7);
    const totalSpentSec = tasks.reduce((sum, task) => sum + Math.max(0, task.timeSpentSec), 0);
    const totalEstimatedSec = tasks.reduce((sum, task) => sum + Math.max(0, task.timeEstimatedSec || 0), 0);

    const statusNames = [...columns];
    for (const status of tasks.map(task => task.status)) if (!statusNames.includes(status)) statusNames.push(status);
    const statusDistribution = statusNames.map(name => {
        const count = tasks.filter(task => task.status === name).length;
        return { name, count, percent: tasks.length ? Math.round(count / tasks.length * 100) : 0 };
    });

    const priorityNames = ['high', 'medium', 'low', 'none'];
    const priorityDistribution = priorityNames.map(name => {
        const count = tasks.filter(task => (task.priority || 'none') === name).length;
        return { name, count, percent: tasks.length ? Math.round(count / tasks.length * 100) : 0 };
    });

    const habits = new Map<string, { tasks: number; seconds: number }>();
    for (const task of tasks) {
        const name = task.habitName || '';
        const current = habits.get(name) || { tasks: 0, seconds: 0 };
        current.tasks++;
        current.seconds += Math.max(0, task.timeSpentSec);
        habits.set(name, current);
    }
    const habitTime = [...habits.entries()]
        .map(([name, value]) => ({
            name,
            ...value,
            percent: totalSpentSec ? Math.round(value.seconds / totalSpentSec * 100) : 0
        }))
        .sort((a, b) => b.seconds - a.seconds || b.tasks - a.tasks);

    const deadlineBuckets: DeadlineBucket[] = [];
    for (let index = 0; index < 6; index++) {
        const start = addDays(today, index * 7);
        const end = addDays(start, 6);
        deadlineBuckets.push({
            start,
            end,
            count: openTasks.filter(task => {
                const due = task.endDate?.slice(0, 10);
                return Boolean(due && due >= start && due <= end);
            }).length
        });
    }

    const riskTaskIds = openTasks
        .filter(task => {
            const overdue = Boolean(task.endDate && task.endDate.slice(0, 10) < today);
            const overEstimate = Boolean(task.timeEstimatedSec && task.timeSpentSec > task.timeEstimatedSec);
            return overdue || overEstimate;
        })
        .sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999'))
        .map(task => task.id);

    return {
        total: tasks.length,
        done,
        open: tasks.length - done,
        overdue: openTasks.filter(task => Boolean(task.endDate && task.endDate.slice(0, 10) < today)).length,
        dueSoon: openTasks.filter(task => {
            const due = task.endDate?.slice(0, 10);
            return Boolean(due && due >= today && due <= dueSoonEnd);
        }).length,
        withoutDueDate: openTasks.filter(task => !task.endDate).length,
        withoutEstimate: openTasks.filter(task => !task.timeEstimatedSec).length,
        totalSpentSec,
        totalEstimatedSec,
        completionPercent: tasks.length ? Math.round(done / tasks.length * 100) : 0,
        estimateCoveragePercent: tasks.length
            ? Math.round(tasks.filter(task => Boolean(task.timeEstimatedSec)).length / tasks.length * 100) : 0,
        timeUtilizationPercent: totalEstimatedSec ? Math.round(totalSpentSec / totalEstimatedSec * 100) : 0,
        statusDistribution,
        priorityDistribution,
        habitTime,
        deadlineBuckets,
        riskTaskIds
    };
}
