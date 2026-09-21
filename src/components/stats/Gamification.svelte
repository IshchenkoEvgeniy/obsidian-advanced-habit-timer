<script lang="ts">
    import { onMount } from 'svelte';
    import type { App } from 'obsidian';
    import type HabitTimerPlugin from '../../main';
    import { GamificationEngine } from '../../gamification';
    import { allRecords } from '../../store/StatsStore';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    // view is passed for external reference but not used internally
    export const view: any = undefined;

    const _keep = [GamificationEngine, allRecords];

    let container: HTMLElement;

    onMount(async () => {
        if (!container) return;
        
        let globalTotalSec = 0;
        const habitTotalsSec: Record<string, number> = {};
        plugin.settings.properties.forEach(p => habitTotalsSec[p.name] = 0);
        
        $allRecords.forEach(r => {
            if (habitTotalsSec[r.habit] !== undefined) {
                habitTotalsSec[r.habit] = (habitTotalsSec[r.habit] || 0) + r.durationSec;
                if (r.type === 'timer') {
                    globalTotalSec += r.durationSec;
                }
            }
        });

        const engine = new GamificationEngine(app, plugin.settings.dailyNotesFolder, plugin.settings.mediaCollections, plugin.settings.language, plugin.settings.properties, plugin.settings);
        await engine.renderGamificationTab(container, habitTotalsSec, globalTotalSec);
    });
</script>

<div class="gamification-svelte-wrapper" bind:this={container}>
</div>

<style>
    .gamification-svelte-wrapper {
        width: 100%;
        display: flex;
        flex-direction: column;
    }
</style>
