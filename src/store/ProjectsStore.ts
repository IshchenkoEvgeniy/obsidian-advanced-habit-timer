import { writable, derived } from 'svelte/store';
import type { ProjectScopeStats, ProjectTask, ProjectTab } from '../projects/types';

export const currentTab = writable<ProjectTab>('board');
export const tasks = writable<ProjectTask[]>([]);
export const columns = writable<string[]>(['Backlog', 'To Do', 'In Progress', 'Done']);
export const searchQuery = writable<string>('');
export const filterHabit = writable<string>('all');
export const filterTag = writable<string>('all');
export const selectedTasks = writable<Set<string>>(new Set());
export const compactMode = writable<boolean>(false);
export const activeScopeId = writable<string>('');
export const scopesWithStats = writable<ProjectScopeStats[]>([]);

export const filteredTasks = derived(
    [tasks, searchQuery, filterHabit, filterTag],
    ([$tasks, $search, $habit, $tag]) => {
        return $tasks.filter(t => {
            const matchSearch = $search ? t.name.toLowerCase().includes($search.toLowerCase()) : true;
            const matchHabit = $habit === 'all' || ($habit === 'none' ? !t.habitName : t.habitName === $habit);
            const taskTags = t.tags?.split(',').map(tag => tag.trim()).filter(Boolean) || [];
            const matchTag = $tag === 'all' || taskTags.includes($tag);
            return matchSearch && matchHabit && matchTag;
        });
    }
);

export const _projectsKeep = [
    currentTab, tasks, columns, searchQuery, filterHabit, filterTag,
    selectedTasks, compactMode, activeScopeId, scopesWithStats, filteredTasks
];
