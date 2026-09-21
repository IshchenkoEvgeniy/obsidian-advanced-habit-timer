<script lang="ts">
    import type HabitTimerPlugin from '../../main';
    import type { App } from 'obsidian';
    import type { HabitDayState, HabitExplicitState, HabitProperty } from '../../types';
    import { t } from '../../i18n';
    import { formatDurationShort } from '../../utils';
    import {
        evaluateHabitState, getHabitDeferredAmountKey, getHabitDeferredToKey,
        getHabitGoals, getHabitStateKey, readHabitExplicitState
    } from '../../habits/goals';
    import {
        getHabitDeferredBonus, getHabitValueFromFrontmatter, getHabitWeeklyValue
    } from '../../services/habit-service';
    import { activeTab, selectedHabit } from '../../store/TimerStore';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    export let view: { refresh: () => void };

    const lang = plugin.settings.language;
    const today = window.moment().format('YYYY-MM-DD');
    let fm: Record<string, unknown> = {};
    let refreshVersion = 0;

    $: {
        refreshVersion;
        const dailyFile = plugin.getDailyNote(today);
        if (dailyFile) {
            const cache = app.metadataCache.getFileCache(dailyFile);
            if (cache?.frontmatter) fm = { ...cache.frontmatter, ...fm };
        }
    }

    function snapshot(prop: HabitProperty) {
        const value = getHabitValueFromFrontmatter(fm, prop);
        const weeklyValue = (prop.goalMode || 'daily') === 'weekly'
            ? getHabitWeeklyValue(app, plugin.settings.dailyNotesFolder, prop, today)
            : undefined;
        const deferredBonus = getHabitDeferredBonus(app, plugin.settings.dailyNotesFolder, prop, today);
        const goals = getHabitGoals(prop, today, deferredBonus);
        const explicit = readHabitExplicitState(fm, prop.name);
        const state = evaluateHabitState(prop, value, today, explicit, weeklyValue, deferredBonus, today);
        const progressValue = goals.mode === 'weekly' ? (weeklyValue || 0) : value;
        return {
            value, weeklyValue: weeklyValue || 0, deferredBonus, goals, explicit, state,
            progressValue,
            percent: Math.min(100, Math.round(progressValue / Math.max(goals.desired, 1) * 100))
        };
    }

    function stateLabel(state: HabitDayState): string {
        const labels: Record<HabitDayState, [string, string]> = {
            completed: ['Выполнено', 'Completed'], partial: ['Частично', 'Partial'],
            skipped: ['Пропущено', 'Skipped'], excused: ['Уважительный пропуск', 'Excused'],
            deferred: ['Перенесено', 'Deferred'], pending: ['В процессе', 'In progress'],
            missed: ['Не выполнено', 'Missed']
        };
        return labels[state][lang === 'ru' ? 0 : 1];
    }

    function formatValue(prop: HabitProperty, value: number): string {
        return (prop.type || 'timer') === 'timer' ? formatDurationShort(value, lang) : String(value);
    }

    function switchHabit(name: string): void {
        activeTab.set('timer');
        selectedHabit.set(name);
        view.refresh();
    }

    async function clearState(prop: HabitProperty): Promise<void> {
        if (!readHabitExplicitState(fm, prop.name)) return;
        await plugin.setHabitDayState(prop.name, null, today);
        delete fm[getHabitStateKey(prop.name)];
        delete fm[getHabitDeferredToKey(prop.name)];
        delete fm[getHabitDeferredAmountKey(prop.name)];
    }

    async function updateCount(prop: HabitProperty, delta: number): Promise<void> {
        await clearState(prop);
        await plugin.updateCountHabit(prop.name, delta);
        fm[prop.name] = Math.max(0, (Number(fm[prop.name]) || 0) + delta);
        refreshVersion++;
        view.refresh();
    }

    async function toggleBinary(prop: HabitProperty, isNegative = false): Promise<void> {
        await clearState(prop);
        if (isNegative) {
            await plugin.logRelapse(prop.name);
            const key = `${prop.name}-Relapse`;
            fm[key] = !fm[key];
        } else {
            await plugin.toggleBinaryHabit(prop.name);
            fm[prop.name] = !fm[prop.name];
        }
        refreshVersion++;
        view.refresh();
    }

    async function setState(prop: HabitProperty, rawState: string, deferredTo?: string): Promise<void> {
        const state = rawState === 'auto' ? null : rawState as HabitExplicitState;
        const target = state === 'deferred'
            ? (deferredTo || window.moment().add(1, 'day').format('YYYY-MM-DD'))
            : undefined;
        const amount = getHabitGoals(prop, today).desired;
        await plugin.setHabitDayState(prop.name, state, today, target, amount);
        if (state) fm[getHabitStateKey(prop.name)] = state;
        else delete fm[getHabitStateKey(prop.name)];
        if (state === 'deferred' && target) {
            fm[getHabitDeferredToKey(prop.name)] = target;
            fm[getHabitDeferredAmountKey(prop.name)] = amount;
        } else {
            delete fm[getHabitDeferredToKey(prop.name)];
            delete fm[getHabitDeferredAmountKey(prop.name)];
        }
        refreshVersion++;
    }
</script>

<div class="habits-grid-container">
    {#each plugin.settings.properties as prop}
        {@const type = prop.type || 'timer'}
        {@const createdAt = prop.createdAt || '0000-00-00'}
        {@const isFuture = today < createdAt}
        {@const data = snapshot(prop)}

        <article class="habit-card-v2 type-{type} state-{data.state}" class:is-future={isFuture}>
            <header class="habit-card-v2-header">
                <div>
                    <div class="habit-card-v2-name">{prop.name}</div>
                    <span class="habit-state state-{data.state}">{stateLabel(data.state)}</span>
                </div>
                {#if data.goals.mode === 'weekly'}<span class="goal-mode">{lang === 'ru' ? 'Неделя' : 'Weekly'}</span>{/if}
            </header>

            {#if isFuture}
                <div class="habit-card-v2-status">{lang === 'ru' ? 'Начало' : 'Starts'}: {createdAt}</div>
            {:else}
                <div class="habit-card-v2-progress" aria-label={`${data.percent}%`}>
                    <div class="habit-card-v2-bar" style:width={`${data.percent}%`}></div>
                    {#if data.goals.minimum < data.goals.desired}
                        <span class="minimum-marker" style:left={`${Math.min(100, data.goals.minimum / data.goals.desired * 100)}%`}></span>
                    {/if}
                </div>
                <div class="habit-card-v2-info">
                    <strong>{formatValue(prop, data.progressValue)}</strong>
                    <span>/ {formatValue(prop, data.goals.desired)}</span>
                </div>
                {#if data.deferredBonus > 0}
                    <div class="deferred-note">+ {formatValue(prop, data.deferredBonus)} {lang === 'ru' ? 'перенесено на сегодня' : 'deferred to today'}</div>
                {/if}

                {#if type === 'timer'}
                    <button class="habit-card-v2-btn" on:click={() => switchHabit(prop.name)}>{lang === 'ru' ? 'Запустить таймер' : 'Start timer'}</button>
                {:else if type === 'count'}
                    <div class="habit-card-v2-ctrls">
                        <button class="habit-card-v2-btn-small" aria-label={lang === 'ru' ? 'Уменьшить' : 'Decrease'} on:click={() => updateCount(prop, -1)}>−</button>
                        <button class="habit-card-v2-btn-small" aria-label={lang === 'ru' ? 'Увеличить' : 'Increase'} on:click={() => updateCount(prop, 1)}>+</button>
                    </div>
                {:else if type === 'binary'}
                    <button class="habit-card-v2-btn" on:click={() => toggleBinary(prop)}>{data.value ? (lang === 'ru' ? 'Отменить' : 'Undo') : (lang === 'ru' ? 'Выполнить' : 'Complete')}</button>
                {:else if type === 'negative'}
                    <button class="habit-card-v2-btn" on:click={() => toggleBinary(prop, true)}>{data.value ? (lang === 'ru' ? 'Отметить срыв' : 'Log relapse') : (lang === 'ru' ? 'Отменить срыв' : 'Undo relapse')}</button>
                {/if}

                <div class="habit-state-control">
                    <select value={data.explicit || 'auto'} on:change={(event) => setState(prop, event.currentTarget.value, String(fm[getHabitDeferredToKey(prop.name)] || ''))}>
                        <option value="auto">{lang === 'ru' ? 'Автоматически' : 'Automatic'}</option>
                        <option value="completed">{lang === 'ru' ? 'Выполнено' : 'Completed'}</option>
                        <option value="partial">{lang === 'ru' ? 'Частично' : 'Partial'}</option>
                        <option value="skipped">{lang === 'ru' ? 'Пропущено' : 'Skipped'}</option>
                        <option value="excused">{lang === 'ru' ? 'Уважительный пропуск' : 'Excused'}</option>
                        <option value="deferred">{lang === 'ru' ? 'Перенести' : 'Defer'}</option>
                    </select>
                    {#if data.explicit === 'deferred'}
                        <input type="date" min={window.moment().add(1, 'day').format('YYYY-MM-DD')} value={String(fm[getHabitDeferredToKey(prop.name)] || window.moment().add(1, 'day').format('YYYY-MM-DD'))} on:change={(event) => setState(prop, 'deferred', event.currentTarget.value)} />
                    {/if}
                </div>
            {/if}
        </article>
    {/each}
</div>

<style>
    .habit-card-v2 { display:flex; flex-direction:column; gap:10px; min-height:210px; }
    .habit-card-v2-header { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
    .habit-state,.goal-mode { display:inline-flex; margin-top:4px; padding:2px 6px; border-radius:4px; background:var(--background-modifier-hover); color:var(--text-muted); font-size:.68rem; }
    .habit-state.state-completed { color:var(--color-green); }
    .habit-state.state-partial { color:var(--color-yellow); }
    .habit-state.state-skipped,.habit-state.state-missed { color:var(--color-red); }
    .habit-state.state-excused,.habit-state.state-deferred { color:var(--color-blue); }
    .habit-card-v2-progress { position:relative; }
    .minimum-marker { position:absolute; top:-2px; bottom:-2px; width:2px; background:var(--text-normal); opacity:.65; }
    .habit-card-v2-info { display:flex; gap:4px; align-items:baseline; }
    .habit-card-v2-info span,.deferred-note { color:var(--text-muted); font-size:.75rem; }
    .habit-state-control { display:flex; flex-wrap:wrap; gap:6px; margin-top:auto; }
    .habit-state-control select,.habit-state-control input { flex:1 1 130px; min-width:0; height:32px; }
</style>
