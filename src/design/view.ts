import { ItemView, type WorkspaceLeaf, type ViewStateResult } from 'obsidian';
import { mount, unmount } from 'svelte';
import type HabitTimerPlugin from '../main';
import DesignHub from './components/DesignHub.svelte';
import type { BoardSession } from './session';
export const VIEW_TYPE_DESIGN = 'habit-world-design';
export class DesignView extends ItemView {
    private component?: ReturnType<typeof mount> & { newEntity(): void; newBoard(): void; pickBoard(): void; showHub(): void; showBoard(id: string): void };
    private sessions = new Map<string, BoardSession>();
    private boardId = '';
    constructor(leaf: WorkspaceLeaf, readonly plugin: HabitTimerPlugin) { super(leaf); }
    getViewType(): string { return VIEW_TYPE_DESIGN; }
    getDisplayText(): string { return this.plugin.design.tr('design_title'); }
    getIcon(): string { return 'network'; }
    async onOpen(): Promise<void> {
        this.contentEl.empty(); this.contentEl.addClass('design-view');
        await this.plugin.design.initialize();
        this.component = mount(DesignHub, { target: this.contentEl, props: { service: this.plugin.design, sessions: this.sessions, initialBoard: this.boardId, onBoardChanged: (id: string) => { this.boardId = id; this.app.workspace.requestSaveLayout(); } } }) as typeof this.component;
    }
    getState(): Record<string, unknown> { return { boardId: this.boardId }; }
    async setState(state: { boardId?: string }, result: ViewStateResult): Promise<void> { this.boardId = state.boardId || ''; await super.setState(state, result); if (this.boardId) this.component?.showBoard(this.boardId); else this.component?.showHub(); }
    showHub(): void { this.component?.showHub(); }
    newEntity(): void { this.component?.newEntity(); }
    newBoard(): void { this.component?.newBoard(); }
    pickBoard(): void { this.component?.pickBoard(); }
    async onClose(): Promise<void> {
        // Stop pointer handlers and restore the full-screen root before flushing drafts.
        if (this.component) { await unmount(this.component); this.component = undefined; }
        for (const session of this.sessions.values()) await session.close(); this.sessions.clear();
    }
}
