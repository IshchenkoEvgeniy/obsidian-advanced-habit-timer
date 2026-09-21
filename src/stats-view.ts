import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import HabitTimerPlugin from './main';
import { mount, unmount } from 'svelte';
import StatsApp from './components/stats/StatsApp.svelte';
import HeatmapWrapper from './components/charts/HeatmapWrapper.svelte';
import HeatmapControls from './components/charts/HeatmapControls.svelte';
import { t } from './i18n';
import { reloadStatsData } from './store/StatsStore';

export const VIEW_TYPE_STATS = "habit-timer-stats-view";

export class StatsView extends ItemView {
    plugin: HabitTimerPlugin;
    container: HTMLElement;
    svelteApp: any;

    constructor(leaf: WorkspaceLeaf, plugin: HabitTimerPlugin) { 
        super(leaf); 
        this.plugin = plugin; 
    }
    
    getViewType() { return VIEW_TYPE_STATS; }
    getDisplayText() { return t(this.plugin.settings.language, 'stats_view_title'); }
    getIcon() { return "bar-chart-3"; }

    async onOpen() {
        this.container = this.containerEl.children[1] as HTMLElement;
        if (!this.container) return;
        
        this.container.empty();
        this.container.addClass("habit-stats-container");

        await reloadStatsData(this.app, this.plugin);
        this.render();

        this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(file.basename)) {
                void reloadStatsData(this.app, this.plugin);
            }
        }));
    }

    render() {
        if (this.svelteApp) {
            try { void unmount(this.svelteApp); } catch (e) { /* ignore */ }
        }

        try {
            this.svelteApp = mount(StatsApp, {
                target: this.container,
                props: {
                    plugin: this.plugin,
                    app: this.app,
                    view: this
                }
            });
        } catch (e: any) {
            new Notice("StatsApp mount error: " + e.message, 10000);
            this.container.createEl("div", { text: "Error loading stats: " + e.stack, attr: { style: 'color: red; padding: 20px; white-space: pre-wrap;' }});
        }
    }
    
    async onClose() {
        if (this.svelteApp) {
            try { await unmount(this.svelteApp); } catch (e) { /* ignore */ }
        }
    }

    static renderHeatmapControls(parent: HTMLElement, plugin: HabitTimerPlugin, onUpdate: () => void) {
        return mount(HeatmapControls, {
            target: parent,
            props: { plugin, onUpdate }
        });
    }

    static renderUnifiedHeatmap(parent: HTMLElement, plugin: HabitTimerPlugin, records: any[], options: any) {
        return mount(HeatmapWrapper, {
            target: parent,
            props: { plugin, records, options }
        });
    }
}
