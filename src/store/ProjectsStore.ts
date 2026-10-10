import { writable, derived } from 'svelte/store';
import type { ProjectScopeStats, ProjectTask, ProjectTab, ProjectStage } from '../projects/types';

export interface ProjectsSnapshot {
    activeScopeId: string;
    tasks: ProjectTask[];
    archivedTasks: ProjectTask[];
    stages: ProjectStage[];
    columns: string[];
    scopesWithStats: ProjectScopeStats[];
}

/** Each Projects window owns its data and publishes a complete project in one update. */
export function createProjectsStore() {
    const snapshot = writable<ProjectsSnapshot>({ activeScopeId: '', tasks: [], archivedTasks: [], stages: [],
        columns: ['Backlog', 'To Do', 'In Progress', 'Done'], scopesWithStats: [] });
    const currentTab = writable<ProjectTab>('table');
    const loading = writable(false);
    const searchQuery = writable('');
    const filterHabit = writable('all');
    const filterTag = writable('all');
    const selectedTasks = writable<Set<string>>(new Set());
    const compactMode = writable(false);
    const tasks = derived(snapshot, value => value.tasks);
    const filteredTasks = derived([tasks, searchQuery, filterHabit, filterTag], ([$tasks, $search, $habit, $tag]) =>
        $tasks.filter(task => (!$search || task.name.toLowerCase().includes($search.toLowerCase())) &&
            ($habit === 'all' || ($habit === 'none' ? !task.habitName : task.habitName === $habit)) &&
            ($tag === 'all' || (task.tags?.split(',').map(tag => tag.trim()) || []).includes($tag))));
    return { snapshot, loading, currentTab, searchQuery, filterHabit, filterTag, selectedTasks, compactMode, filteredTasks };
}
