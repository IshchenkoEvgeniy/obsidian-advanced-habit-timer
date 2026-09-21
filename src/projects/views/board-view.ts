import { Notice } from 'obsidian';
import { ProjectSubView, type ViewContext } from './base-view';
import type { ProjectScopeDefinition } from '../types';
import { mount, unmount } from 'svelte';
import Board from '../../components/projects/Board.svelte';

export class BoardView extends ProjectSubView {
    collapsedColumns: Set<string> = new Set();
    private svelteApp: ReturnType<typeof mount> | null = null;

    async destroy(): Promise<void> {
        if (!this.svelteApp) return;
        try { await unmount(this.svelteApp); } catch { /* already unmounted */ }
        this.svelteApp = null;
    }

    async render(content: HTMLElement, scope: ProjectScopeDefinition, ctx: ViewContext): Promise<void> {
        content.empty();

        await this.destroy();
        
        content.setCssStyles({ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' });

        try {
            this.svelteApp = mount(Board, {
                target: content,
                props: {
                    plugin: this.plugin,
                    app: this.app,
                    view: this,
                    scope,
                    ctx
                }
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            const details = error instanceof Error ? error.stack ?? message : message;
            new Notice('Board mount error: ' + message, 10000);
            content.createEl('div', { text: 'Error loading board: ' + details, attr: { style: 'color: red; padding: 20px; white-space: pre-wrap;' }});
        }
    }
}
