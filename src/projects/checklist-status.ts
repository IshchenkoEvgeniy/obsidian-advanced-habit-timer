import type { ProjectTask, ProjectScopeDefinition } from './types';
import { remoteOptionForLocal } from './github-sync';

/** Stages and numbered groups reflect their descendants, including intermediate statuses. */
export function aggregateChecklistStatus(tasks: ProjectTask[], columns: string[]): string {
    const first = columns[0] || 'Backlog';
    const done = columns[columns.length - 1] || 'Done';
    if (!tasks.length) return first;
    if (tasks.every(task => task.status === done)) return done;
    const active = columns.find(status => status !== first && status !== done && tasks.some(task => task.status === status));
    if (active) return active;
    if (tasks.some(task => task.status === done)) {
        return columns.find(status => /^(in[\s_-]*progress|в работе|в процессе)$/i.test(status)) || first;
    }
    return first;
}

export function projectStatusColor(scope: ProjectScopeDefinition, status: string, columns: string[]): string {
    const field = scope.githubFields?.find(field => field.name === 'Status' && field.type === 'SINGLE_SELECT');
    const optionId = remoteOptionForLocal(status, field?.options || []);
    const color = field?.options?.find(option => option.id === optionId)?.color;
    const colors: Record<string, string> = {
        GRAY: '#9198a1', BLUE: '#4493f8', GREEN: '#3fb950', YELLOW: '#d29922',
        ORANGE: '#db6d28', RED: '#f85149', PINK: '#db61a2', PURPLE: '#a371f7'
    };
    if (color && colors[color.toUpperCase()]) return colors[color.toUpperCase()]!;
    if (status === columns[columns.length - 1]) return colors.PURPLE!;
    if (status === columns[0]) return colors.GREEN!;
    return colors.YELLOW!;
}
