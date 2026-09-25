import { ItemView, WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import type HabitTimerPlugin from './main';
import HomeApp from './components/home/HomeApp.svelte';
import { withWorkspaceNavigation } from './workspace-navigation';

export const VIEW_TYPE_HOME = 'habit-home-view';

export class HomeView extends ItemView {
    private component: ReturnType<typeof mount> | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: HabitTimerPlugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_HOME; }
    getDisplayText(): string { return this.plugin.settings.language === 'ru' ? 'Сегодня' : 'Today'; }
    getIcon(): string { return 'house'; }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('habit-home-root');
        container.setCssStyles({ height: '100%', overflow: 'hidden', padding: '0' });
        this.component = mount(HomeApp, {
            target: container,
            props: { plugin: this.plugin, app: this.app, view: this }
        });
    }

    async onClose(): Promise<void> {
        if (this.component) await unmount(this.component);
        this.component = null;
    }
}

// Re-export so main.ts can wrap the view with the shared workspace navigation.
export { withWorkspaceNavigation };