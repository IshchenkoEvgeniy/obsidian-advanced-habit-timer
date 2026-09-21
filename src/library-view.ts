import { ItemView } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import type HabitTimerPlugin from './main';
import { t } from './i18n';
import LibrarySvelte from './components/Library.svelte';

export const VIEW_TYPE_LIBRARY = 'habit-library-view';

export class LibraryView extends ItemView {
    private svelteComponent: Record<string, unknown> | null = null;

    constructor(leaf: WorkspaceLeaf, public plugin: HabitTimerPlugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_LIBRARY; }
    getDisplayText(): string { return t(this.plugin.settings.language, 'library_tab'); }
    getIcon(): string { return 'library'; }

    async onOpen(): Promise<void> {
        this.plugin.stateManager.refreshAllMedia();
        await this.render();
    }

    async onClose(): Promise<void> {
        if (this.svelteComponent) {
            await unmount(this.svelteComponent);
            this.svelteComponent = null;
        }
    }

    private async render(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement | undefined;
        if (!container) return;
        container.empty();
        container.addClass('habit-library-container');

        if (this.svelteComponent) await unmount(this.svelteComponent);
        this.svelteComponent = mount(LibrarySvelte, {
            target: container,
            props: { plugin: this.plugin, app: this.app, leaf: this.leaf }
        }) as Record<string, unknown>;
    }
}
