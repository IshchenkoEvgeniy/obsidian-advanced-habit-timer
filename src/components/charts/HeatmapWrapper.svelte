<script lang="ts">
    import Heatmap from './Heatmap.svelte';
    import type HabitTimerPlugin from '../../main';

    export let plugin: HabitTimerPlugin;
    export let records: any[] = [];
    export let options: any = {};
</script>

<Heatmap 
    records={records}
    days={plugin.settings.heatmapDays}
    cellSize={plugin.settings.heatmapCellSize}
    groupByMonth={plugin.settings.heatmapGroupByMonth}
    formatValue={options.formatValue}
    onBoxClick={options.onBoxClick}
/>
