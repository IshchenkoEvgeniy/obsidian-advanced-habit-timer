<script lang="ts">
    import { onMount } from 'svelte';
    import type { App } from 'obsidian';
    import type HabitTimerPlugin from '../../main';
    import { currentStatsTab, isStatsLoading, viewMode } from '../../store/StatsStore';
    import { t } from '../../i18n';

    import AnalyticsMain from './AnalyticsMain.svelte';
    import AnalyticsDetail from './AnalyticsDetail.svelte';
    import Gamification from './Gamification.svelte';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    export let view: any;

    // Prevent TS from stripping imports
    const _keep = [AnalyticsMain, AnalyticsDetail, Gamification, t, currentStatsTab, isStatsLoading, viewMode];

    let lang = plugin.settings.language;
</script>

<div class="stats-main-tabs">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <button class="tab-btn {$currentStatsTab === 'analytics' ? 'active' : ''}" on:click={() => currentStatsTab.set('analytics')}>
        {t(lang, 'stats')}
    </button>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <button class="tab-btn {$currentStatsTab === 'gamification' ? 'active' : ''}" on:click={() => currentStatsTab.set('gamification')}>
        {t(lang, 'achievements')}
    </button>
</div>

<div class="stats-content-wrapper">
    {#if $isStatsLoading}
        <div class="loading-state">{t(lang, 'loading')}</div>
    {:else}
        {#if $currentStatsTab === 'analytics'}
            {#if $viewMode === 'main'}
                <AnalyticsMain {plugin} {app} {view} />
            {:else}
                <AnalyticsDetail {plugin} {app} {view} />
            {/if}
        {:else}
            <!-- Gamification Tab -->
            <Gamification {plugin} {app} {view} />
        {/if}
    {/if}
</div>

<style>
    .stats-content-wrapper {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow-y: auto;
        padding-top: 10px;
    }
    .loading-state {
        text-align: center;
        margin-top: 50px;
        color: var(--text-muted);
        font-style: italic;
    }
</style>
