<script lang="ts">
    import type HabitTimerPlugin from '../main';
    import { t } from '../i18n';
    import { DAILY_GOAL_UNITS, collectionDailyGoalEnabled, dailyGoalUnitLabel, defaultDailyGoal, defaultDailyGoalUnit } from '../library/daily-goals';
    const _t = t;
    
    export let plugin: HabitTimerPlugin;
    
    // We bind local array to trigger reactivity
    let collections = plugin.settings.mediaCollections;
    let lang = plugin.settings.language;

    function addCollection() {
        const id = 'new_collection_' + Date.now();
        collections = [...collections, {
            id,
            enabled: true,
            folder: 'DataBases/New',
            templatePath: 'Разное/Шаблоны/New.md',
            readingStatusName: 'В процессе',
            pausedStatusName: 'На паузе',
            finishedStatusName: 'Завершено',
            icon: 'book',
            dailyGoalEnabled: true,
            dailyGoal: 1,
            dailyGoalUnit: 'units'
        }];
        save();
    }
    
    function removeCollection(idx: number) {
        collections.splice(idx, 1);
        collections = [...collections];
        save();
    }
    
    async function save() {
        plugin.settings.mediaCollections = collections;
        await plugin.saveSettings();
    }

    function setDailyGoalEnabled(index: number, enabled: boolean): void {
        collections[index]!.dailyGoalEnabled = enabled;
        collections = [...collections];
        void save();
    }
</script>

<div class="ht-settings-svelte">
    <h3>{t(lang, 'media_library_section') || 'Media Library (Dynamic)'}</h3>
    <p style="color: var(--text-muted); font-size: 0.9em;">
        Fully dynamic collections. You can add any type of media (Podcasts, Articles, etc.)
    </p>
    
    <button on:click={addCollection} class="mod-cta" style="margin-bottom: 15px;">
        + Add New Collection
    </button>
    
    <div class="collections-list" style="display: flex; flex-direction: column; gap: 15px;">
        {#each collections as col, idx}
            <div class="collection-card" style="border: 1px solid var(--background-modifier-border); padding: 15px; border-radius: 8px; background: var(--background-secondary);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 15px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px;">
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <input type="text" bind:value={col.id} on:input={save} placeholder="ID (e.g. podcasts)" style="font-weight: bold; width: 200px; font-size: 1.1em; background: transparent; border: none; border-bottom: 1px solid var(--background-modifier-border-hover);"/>
                    </div>
                    <button on:click={() => removeCollection(idx)} style="background: transparent; box-shadow: none; color: var(--text-error);">🗑️ Delete</button>
                </div>
                
                <label style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                    <input type="checkbox" bind:checked={col.enabled} on:change={save}/> 
                    <span style="font-weight: bold;">Enabled</span>
                </label>
                
                {#if col.enabled}
                    <div style="display: grid; grid-template-columns: 150px 1fr; gap: 8px; align-items: center;">
                        <span class="setting-item-name" style="color: var(--text-muted);">Icon (lucide name)</span>
                        <input type="text" bind:value={col.icon} on:input={save} placeholder="book, film, mic..."/>
                        
                        <span class="setting-item-name" style="color: var(--text-muted);">Folder</span>
                        <input type="text" bind:value={col.folder} on:input={save}/>
                        
                        <span class="setting-item-name" style="color: var(--text-muted);">Template Path</span>
                        <input type="text" bind:value={col.templatePath} on:input={save}/>
                        
                        <span class="setting-item-name" style="color: var(--text-muted);">Reading/Active Status</span>
                        <input type="text" bind:value={col.readingStatusName} on:input={save}/>

                        <span class="setting-item-name" style="color: var(--text-muted);">Paused Status</span>
                        <input type="text" bind:value={col.pausedStatusName} on:input={save}/>
                        
                        <span class="setting-item-name" style="color: var(--text-muted);">Finished Status</span>
                        <input type="text" bind:value={col.finishedStatusName} on:input={save}/>

                        <span class="setting-item-name" style="color: var(--text-muted);">{lang === 'ru' ? 'Дневная норма' : 'Daily goal'}</span>
                        <label style="display:flex;align-items:center;gap:8px;">
                            <input type="checkbox" checked={collectionDailyGoalEnabled(col)}
                                on:change={(event) => setDailyGoalEnabled(idx, event.currentTarget.checked)} />
                            <span>{lang === 'ru' ? 'Использовать для этой коллекции' : 'Use for this collection'}</span>
                        </label>

                        <span class="setting-item-name" style="color: var(--text-muted);">{lang === 'ru' ? 'Значение и единица' : 'Value and unit'}</span>
                        <div style="display:grid;grid-template-columns:minmax(80px,.6fr) minmax(130px,1fr);gap:8px;">
                            <input type="number" min="1" step="1" value={col.dailyGoal || defaultDailyGoal(col.id, plugin.settings.dailyPagesGoal)}
                                disabled={!collectionDailyGoalEnabled(col)}
                                on:change={(event) => { col.dailyGoal = Math.max(1, Number(event.currentTarget.value) || 1); void save(); }} />
                            <select value={col.dailyGoalUnit || defaultDailyGoalUnit(col.id)}
                                disabled={!collectionDailyGoalEnabled(col)}
                                on:change={(event) => { col.dailyGoalUnit = event.currentTarget.value as typeof col.dailyGoalUnit; void save(); }}>
                                {#each DAILY_GOAL_UNITS as unit}<option value={unit}>{dailyGoalUnitLabel(unit, lang)}</option>{/each}
                            </select>
                        </div>
                        
                        <span class="setting-item-name" style="color: var(--text-muted);">{t(lang, 'lib_target_habit') || 'Target Habit'}</span>
                        <input type="text" bind:value={col.targetHabit} on:input={save} placeholder="e.g. Habit-Read"/>
                    </div>
                {/if}
            </div>
        {/each}
    </div>
</div>
