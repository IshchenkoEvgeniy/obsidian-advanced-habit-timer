import { TFile, Notice } from 'obsidian';
import HabitTimerPlugin from '../../main';
import { ProjectDataEngine } from '../project-data';
import type { ProjectScopeDefinition, ProjectTask } from '../types';
import {
    type CanvasData, type CanvasNode, type CanvasEdge,
    NODE_DEFAULT_W, NODE_DEFAULT_H, LAYOUT_COL_W, LAYOUT_V_GAP
} from './canvas-types';

const CANVAS_VERSION = 1 as const;

/** Generates a short unique ID (16 hex chars). */
function uid(): string {
    return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
}

/** Builds the .htcanvas file path for a given scope. */
export function canvasFilePath(scope: ProjectScopeDefinition): string {
    if (scope.sourceType === 'folder') {
        const base = scope.sourceValue.replace(/\/$/, '');
        return `${base}/.canvas/${scope.id}.htcanvas`;
    }
    if (scope.sourceType === 'file') {
        const base = scope.sourceValue.replace(/\.md$/, '');
        return `${base}.htcanvas`;
    }
    // tag / dataview — store inside vault root .canvas folder
    return `.canvas/habit-timer-${scope.id}.htcanvas`;
}

function emptyCanvas(scopeId: string): CanvasData {
    return {
        version: CANVAS_VERSION,
        scopeId,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
        lastModified: new Date().toISOString(),
    };
}

/** Creates a Task node for the given ProjectTask. */
export function taskToNode(task: ProjectTask, x = 0, y = 0): CanvasNode {
    return {
        id: uid(),
        type: 'task',
        x,
        y,
        width: NODE_DEFAULT_W,
        height: NODE_DEFAULT_H,
        taskId: task.id,
        taskFile: task.file.path,
        taskName: task.name,
        color: task.color,
    };
}

export class CanvasEngine {
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private plugin: HabitTimerPlugin,
        private dataEngine: ProjectDataEngine,
    ) {}

    // ------------------------------------------------------------------ load

    private _pendingSaveData: { scope: ProjectScopeDefinition, data: CanvasData } | null = null;

    async load(scope: ProjectScopeDefinition): Promise<CanvasData> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            if (this._pendingSaveData) {
                await this.save(this._pendingSaveData.scope, this._pendingSaveData.data);
            }
        }
        if (this._pendingSavePromise) {
            await this._pendingSavePromise;
        }

        const path = canvasFilePath(scope);
        try {
            if (await this.plugin.app.vault.adapter.exists(path)) {
                const raw = await this.plugin.app.vault.adapter.read(path);
                const data = JSON.parse(raw) as CanvasData;
                return data;
            }
        } catch (err) {
            console.error('[Canvas] Could not parse canvas file:', err);
            new Notice('Could not parse canvas file; creating a new one.');
        }

        return emptyCanvas(scope.id);
    }

    // ------------------------------------------------------------------ save

    private _pendingSavePromise: Promise<void> | null = null;

    async save(scope: ProjectScopeDefinition, data: CanvasData): Promise<void> {
        if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
        
        const doSave = async () => {
            data.lastModified = new Date().toISOString();
            const path = canvasFilePath(scope);
            const json = JSON.stringify(data, null, 2);

            const existing = this.plugin.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
                await this.plugin.app.vault.modify(existing, json);
            } else {
                const parts = path.split('/');
                parts.pop();
                const dir = parts.join('/');
                if (dir) {
                    try { await this.plugin.app.vault.createFolder(dir); } catch { /* ignore */ }
                }
                try {
                    await this.plugin.app.vault.create(path, json);
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : String(err);
                    if (message.includes('already exists')) {
                        const retry = this.plugin.app.vault.getAbstractFileByPath(path);
                        if (retry instanceof TFile) await this.plugin.app.vault.modify(retry, json);
                        else await this.plugin.app.vault.adapter.write(path, json);
                    } else {
                        console.error('Failed to save canvas:', err);
                    }
                }
            }
        };

        this._pendingSavePromise = doSave().finally(() => { this._pendingSavePromise = null; });
        return this._pendingSavePromise;
    }

    /** Debounced save — coalesces rapid saves into one write. */
    scheduleSave(scope: ProjectScopeDefinition, data: CanvasData): void {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this._pendingSaveData = { scope, data };
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            if (this._pendingSaveData) {
                void this.save(this._pendingSaveData.scope, this._pendingSaveData.data);
                this._pendingSaveData = null;
            }
        }, 1000);
    }

    // ------------------------------------------------------------------ sync

    /**
     * Synchronises canvas nodes with the current task list:
     * - Adds nodes for tasks that have no canvas node yet (if autoAdd is true)
     * - Marks nodes as orphan when the backing file is gone
     * - Arranges new nodes in a simple stacked layout to avoid overlap
     */
    syncTasks(
        data: CanvasData,
        tasks: ProjectTask[],
        columns: string[],
        autoAdd = true,
    ): boolean {
        let changed = false;

        const tasksById = new Map(tasks.map(task => [task.id, task]));

        // Mark orphan nodes
        for (const node of data.nodes) {
            if (node.type !== 'task') continue;
            if (!node.taskId) {
                const legacyTask = tasks.find(task =>
                    task.file.path === node.taskFile && (!node.taskName || task.name === node.taskName)
                );
                if (legacyTask) {
                    node.taskId = legacyTask.id;
                    changed = true;
                }
            }
            const alive = Boolean(node.taskId && tasksById.has(node.taskId));
            if (!alive && !node.orphan) {
                node.orphan = true;
                changed = true;
            } else if (alive && node.orphan) {
                node.orphan = false;
                changed = true;
            }
        }

        if (!autoAdd) return changed;

        // Find tasks not yet on canvas
        const existingTaskIds = new Set(
            data.nodes
                .filter(n => n.type === 'task' && n.taskId)
                .map(n => n.taskId as string)
        );

        const newTasks = tasks.filter(task => !existingTaskIds.has(task.id));

        if (newTasks.length === 0) return changed;

        // Place new tasks in kanban columns
        const colPositions = new Map<string, number>(); // column → next y offset
        for (const col of columns) {
            colPositions.set(col, 20);
        }

        for (const task of newTasks) {
            const colIdx = columns.indexOf(task.status);
            const col = colIdx >= 0 ? task.status : columns[0] ?? 'Backlog';
            const x = (colIdx >= 0 ? colIdx : 0) * LAYOUT_COL_W + 20;
            const y = colPositions.get(col) ?? 20;

            data.nodes.push(taskToNode(task, x, y));
            colPositions.set(col, y + NODE_DEFAULT_H + LAYOUT_V_GAP);
            changed = true;
        }

        return changed;
    }

    // ------------------------------------------------------------------ CRUD

    addNode(data: CanvasData, node: Omit<CanvasNode, 'id'>): CanvasNode {
        const full: CanvasNode = { id: uid(), ...node };
        data.nodes.push(full);
        return full;
    }

    removeNode(data: CanvasData, nodeId: string): void {
        data.nodes = data.nodes.filter(n => n.id !== nodeId);
        data.edges = data.edges.filter(
            e => e.fromNode !== nodeId && e.toNode !== nodeId
        );
    }

    addEdge(data: CanvasData, edge: Omit<CanvasEdge, 'id'>): CanvasEdge {
        const full: CanvasEdge = { id: uid(), ...edge };
        data.edges.push(full);
        return full;
    }

    removeEdge(data: CanvasData, edgeId: string): void {
        data.edges = data.edges.filter(e => e.id !== edgeId);
    }

    updateNodePos(data: CanvasData, nodeId: string, x: number, y: number): void {
        const node = data.nodes.find(n => n.id === nodeId);
        if (node) { node.x = x; node.y = y; }
    }

    updateNodeSize(
        data: CanvasData, nodeId: string,
        width: number, height: number
    ): void {
        const node = data.nodes.find(n => n.id === nodeId);
        if (node) { node.width = width; node.height = height; }
    }

    getNode(data: CanvasData, id: string): CanvasNode | undefined {
        return data.nodes.find(n => n.id === id);
    }

    /** Returns bounding box of all nodes, or a default rect if canvas is empty. */
    getBBox(data: CanvasData): { x: number; y: number; w: number; h: number } {
        if (data.nodes.length === 0) return { x: 0, y: 0, w: 800, h: 600 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of data.nodes) {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + n.width);
            maxY = Math.max(maxY, n.y + n.height);
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
}
