import type { ProjectTask, TaskData } from './types';

export function projectTaskToData(
    task: ProjectTask,
    formatDuration: (seconds: number) => string,
    changes: Partial<TaskData> = {}
): TaskData {
    return {
        name: task.name,
        status: task.status,
        habitName: task.habitName || '',
        timeEstimated: task.timeEstimatedSec ? formatDuration(task.timeEstimatedSec) : '',
        startDate: task.startDate || '',
        endDate: task.endDate || '',
        cover: task.cover || '',
        color: task.color || '',
        tags: task.tags || '',
        priority: task.priority,
        order: task.order || 0,
        ...changes
    };
}
