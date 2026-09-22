<script lang="ts">
    import { onMount } from 'svelte';
    import { tweened } from 'svelte/motion';
    import { cubicOut } from 'svelte/easing';

    interface BarData {
        label: string;
        date: string;
        segments: { label: string; value: number; color: string; subtext?: string }[];
        total: number;
    }

    export let data: BarData[] = [];
    export let height: number = 200;
    export let animate: boolean = true;
    
    $: maxTotal = Math.max(...data.map(d => d.total), 0.1);

    const progress = tweened(animate ? 0 : 1, {
        duration: 1000,
        easing: cubicOut
    });

    onMount(() => {
        if (animate) {
            progress.set(1);
        }
    });
</script>

<div class="bar-chart-container" style="height: {height + 30}px;">
    {#if data.length === 0}
        <div class="no-data">No data available</div>
    {:else}
        {#each data as col}
            {@const totalPerc = (col.total / maxTotal) * 100 * $progress}
            <div class="bar-col">
                <div class="bar-wrapper" style="height: {height}px;">
                    <div class="bar-bg" style="height: {Math.max(totalPerc, 1)}%;" title="{col.date}: {col.total}">
                        {#each col.segments as seg}
                            {@const segPerc = (seg.value / Math.max(col.total, 0.1)) * 100}
                            <div 
                                class="bar-segment" 
                                style="height: {segPerc}%; background-color: {seg.color};"
                                title="{seg.label}: {seg.subtext || seg.value}"
                            ></div>
                        {/each}
                    </div>
                </div>
                <div class="bar-label">{col.label}</div>
            </div>
        {/each}
    {/if}
</div>

<style>
    .bar-chart-container {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        width: 100%;
        margin: 20px 0;
        padding-bottom: 5px;
        gap: 4px;
    }
    .no-data {
        color: var(--text-muted);
        margin: auto;
        font-style: italic;
    }
    .bar-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 15px;
    }
    .bar-wrapper {
        width: 100%;
        max-width: 30px;
        background: var(--background-modifier-hover);
        border-radius: 4px;
        display: flex;
        align-items: flex-end;
        overflow: hidden;
    }
    .bar-bg {
        width: 100%;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        border-radius: 4px;
        overflow: hidden;
        cursor: pointer;
        transition: opacity 0.2s;
    }
    .bar-bg:hover {
        opacity: 0.8;
    }
    .bar-segment {
        width: 100%;
    }
    .bar-label {
        font-size: 0.7em;
        color: var(--text-muted);
        margin-top: 8px;
        text-align: center;
    }
</style>
