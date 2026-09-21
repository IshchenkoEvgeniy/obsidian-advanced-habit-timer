<script lang="ts">
    import type HabitTimerPlugin from '../../main';
    import { t } from '../../i18n';

    export let plugin: HabitTimerPlugin;
    export let onUpdate: () => void;

    let lang = plugin.settings.language;

    async function setDays(d: number) {
        plugin.settings.heatmapDays = d;
        await plugin.saveSettings();
        onUpdate();
    }

    async function setSize(sz: 's'|'m'|'l') {
        plugin.settings.heatmapCellSize = sz;
        await plugin.saveSettings();
        onUpdate();
    }

    async function toggleGrouping() {
        plugin.settings.heatmapGroupByMonth = !plugin.settings.heatmapGroupByMonth;
        await plugin.saveSettings();
        onUpdate();
    }
</script>

<div class="heatmap-controls">
    <div class="heatmap-ctrl-group">
        {#each [30, 60, 90, 180, 365] as d}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <button class="heatmap-ctrl-btn {plugin.settings.heatmapDays === d ? 'active' : ''}" on:click={() => setDays(d)}>
                {d}
            </button>
        {/each}
    </div>

    <div class="heatmap-ctrl-group">
        {#each ['s', 'm', 'l'] as sz}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <button class="heatmap-ctrl-btn {plugin.settings.heatmapCellSize === sz ? 'active' : ''}" on:click={() => setSize(sz as any)}>
                {sz.toUpperCase()}
            </button>
        {/each}
    </div>

    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <button class="heatmap-ctrl-btn {plugin.settings.heatmapGroupByMonth ? 'active' : ''}" on:click={toggleGrouping} title={t(lang, 'group_by_month')}>
        {plugin.settings.heatmapGroupByMonth ? "📅" : "⬜"}
    </button>
</div>
