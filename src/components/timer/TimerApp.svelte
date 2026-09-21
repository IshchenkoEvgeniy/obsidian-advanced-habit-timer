<script lang="ts">
    import { onDestroy } from 'svelte';
    import type HabitTimerPlugin from '../../main';
    import type { App } from 'obsidian';
    import TimerTab from './TimerTab.svelte';
    import HabitsTab from './HabitsTab.svelte';
    import { activeTab } from '../../store/TimerStore';
    import { t } from '../../i18n';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    export let view: any;
    
    // Prevent TS from dropping these imports in non-verbatim mode
    const _keep = [TimerTab, HabitsTab, t];

    let lang = plugin.settings.language;
    let currentTab: 'timer'|'habits' = 'timer';
    const unsubscribe = activeTab.subscribe(v => { currentTab = v; });
    onDestroy(unsubscribe);
</script>

<div class="habit-timer-view-container">
    <div class="library-header">
        <div class="library-tabs">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <button class="tab-btn {currentTab === 'timer' ? 'active' : ''}" on:click={() => activeTab.set('timer')}>
                {t(lang, 'timer_view_title') || 'Timer'}
            </button>
            <button class="tab-btn {currentTab === 'habits' ? 'active' : ''}" on:click={() => activeTab.set('habits')}>
                {t(lang, 'habits_label') || 'Habits'}
            </button>
        </div>
    </div>
    
    {#if currentTab === 'timer'}
        <TimerTab {plugin} {app} {view} />
    {:else}
        <HabitsTab {plugin} {app} {view} />
    {/if}
</div>
