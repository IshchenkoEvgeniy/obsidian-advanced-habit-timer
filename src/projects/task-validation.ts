import type { TaskData } from './types';
import { validateTaskDescription } from './description-validation';

export function validateTaskData<T extends Partial<TaskData>>(input: T, columns?: string[], separateFile = false): T {
    const data = { ...input };
    if (data.description !== undefined) data.description = validateTaskDescription(data.description);
    if (!data.name?.trim() || /[\r\n]/.test(data.name)) throw new Error('Task title must be a nonempty single line.');
    data.name = data.name.trim();
    if (/<!--\s*(?:project-|github-project-item:|obsidian-checklist-node:)/.test(data.name)) throw new Error('Task title contains project metadata. Paste only the title, without service markers.');
    if (separateFile && /[\\/:*?"<>|]/.test(data.name)) throw new Error('Task title contains characters forbidden in a filename.');
    if (data.status && (/[\r\n]|-->|<!--/.test(data.status) || columns?.length && !columns.includes(data.status))) throw new Error(`Unknown or invalid project status: ${data.status}`);
    if (data.timeEstimated && !/^\d{2,}:[0-5]\d:[0-5]\d$/.test(data.timeEstimated)) throw new Error('Estimate must use hh:mm:ss, with minutes and seconds below 60.');
    for (const key of ['startDate', 'endDate'] as const) {
        const value = data[key];
        if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) throw new Error(`Invalid date: ${value}`);
    }
    if (data.startDate && data.endDate && data.startDate > data.endDate) throw new Error('The due date must not precede the start date.');
    if (data.habitName && /[\r\n[\]]/.test(data.habitName)) throw new Error('Habit name contains invalid link characters.');
    if (data.tags !== undefined) {
        data.tags = data.tags.split(',').map(value => value.trim().replace(/^#/, '')).filter(Boolean).join(', ');
        if (data.tags.split(',').some(tag => tag.trim() && (!/^[\p{L}\p{M}\p{N}_/-]+$/u.test(tag.trim()) || /^\d+$/.test(tag.trim())))) throw new Error('Invalid tag.');
    }
    if (data.priority && !['high', 'medium', 'low', 'высокий', 'средний', 'низкий'].includes(data.priority.toLowerCase())) throw new Error('Unknown priority.');
    return data;
}

export function frontmatterVersion(fm: Record<string, unknown>): string {
    return JSON.stringify(Object.fromEntries(Object.keys(fm).filter(key => key !== 'position').sort().map(key => [key, fm[key]])));
}
