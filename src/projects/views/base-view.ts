import { App, Modal, ButtonComponent } from 'obsidian';
import HabitTimerPlugin from '../../main';
import { ProjectDataEngine } from '../project-data';
import type { ProjectScopeDefinition, ProjectTask } from '../types';

export interface ViewContext {
    allTasks: ProjectTask[];
    filteredTasks: ProjectTask[];
    selectedTasks: Set<string>;
    compactMode: boolean;
    columns: string[];
    onRefresh: () => void;
    onSelectionChange?: (selection?: Set<string>) => void;
}

/** Lightweight non-blocking confirmation modal. BUG-10 fix: replaces window.confirm(). */
class ConfirmModal extends Modal {
    private resolve!: (value: boolean) => void;
    private settled = false;
    constructor(app: App, private message: string) {
        super(app);
    }
    onOpen() {
        this.contentEl.createEl('p', { text: this.message, attr: { style: 'margin-bottom: 16px; font-size: 1em;' } });
        const btnRow = this.contentEl.createDiv({ attr: { style: 'display: flex; gap: 10px; justify-content: flex-end;' } });
        new ButtonComponent(btnRow).setButtonText('Cancel').onClick(() => this.finish(false));
        new ButtonComponent(btnRow).setButtonText('Delete').setWarning().onClick(() => this.finish(true));
    }
    private finish(value: boolean): void {
        if (this.settled) return;
        this.settled = true;
        this.resolve(value);
        this.close();
    }
    onClose() {
        if (!this.settled) {
            this.settled = true;
            this.resolve(false);
        }
        this.contentEl.empty();
    }
    wait(): Promise<boolean> {
        return new Promise(r => { this.resolve = r; });
    }
}

export abstract class ProjectSubView {
    constructor(
        public app: App,
        public plugin: HabitTimerPlugin,
        public dataEngine: ProjectDataEngine
    ) {}

    /**
     * Non-blocking confirmation dialog — safe for Obsidian Mobile (Capacitor).
     * BUG-10 fix: replaces window.confirm() which blocks the JS thread on mobile.
     */
    async confirmModal(message: string): Promise<boolean> {
        const modal = new ConfirmModal(this.app, message);
        modal.open();
        return modal.wait();
    }

    /**
     * Returns a consistent color for a task.
     * Uses the task's own color, falls back to a hash-derived hue from habitName,
     * or a neutral border color when no habit is set.
     * BUG-12 fix: was duplicated verbatim in all 5 sub-view files.
     */
    getTaskColor(task: ProjectTask, _scopeColor?: string): string {
        if (task.color) return task.color;
        if (!task.habitName) return 'var(--background-modifier-border)';
        let hash = 0;
        for (let i = 0; i < task.habitName.length; i++) {
            hash = task.habitName.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = Math.abs(hash) % 360;
        return `hsl(${hue}, 60%, 50%)`;
    }

    abstract render(containerEl: HTMLElement, scope: ProjectScopeDefinition, ctx: ViewContext): Promise<void>;
}
