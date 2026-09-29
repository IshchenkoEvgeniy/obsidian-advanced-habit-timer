<script lang="ts">
    export let done = 0;
    export let total = 0;
    export let label = 'Sub-issues progress';

    $: completed = Math.max(0, Math.min(done, total));
    $: percentage = total > 0 ? Math.round(completed / total * 100) : 0;
</script>

{#if total > 0}
    <span class="subissue-progress" title={label} aria-label={`${label}: ${completed} / ${total}, ${percentage}%`}>
        <span class="progress-count">{completed} / {total}</span>
        <span class="progress-segments" style={`--segment-count:${total}`} aria-hidden="true">
            {#each Array(total) as _, index}
                <span class:completed={index < completed}></span>
            {/each}
        </span>
        <span class="progress-percent">{percentage}%</span>
    </span>
{:else}
    <span class="empty-progress">—</span>
{/if}

<style>
    .subissue-progress { display:inline-flex; align-items:center; gap:10px; max-width:100%; color:var(--text-muted); font-size:.72rem; white-space:nowrap; }
    .progress-count { min-width:30px; font-variant-numeric:tabular-nums; }
    .progress-segments { display:grid; grid-template-columns:repeat(var(--segment-count), minmax(0, 1fr)); gap:1px; width:88px; height:9px; overflow:hidden; border-radius:5px; background:var(--background-primary); }
    .progress-segments > span { min-width:0; background:#392759; }
    .progress-segments > span.completed { background:#8957e5; }
    .progress-percent { min-width:29px; text-align:right; font-variant-numeric:tabular-nums; }
    .empty-progress { color:var(--text-faint); }
</style>
