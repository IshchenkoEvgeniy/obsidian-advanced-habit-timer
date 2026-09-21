<script lang="ts">
    import { setIcon } from 'obsidian';
    import type { App } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type HabitTimerPlugin from '../main';
    import type { MediaItem } from '../store/StateManager';
    import { analyzeLibraryData, buildMigrationPreview, PropertyMigrationModal } from '../library/data-health';
    import type { DataHealthIssue, DataIssueKind } from '../library/data-health';

    export let items: MediaItem[] = [];
    export let app: App;
    export let plugin: HabitTimerPlugin;
    export let lang: 'en' | 'ru' = 'en';

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };
    const labels: Record<DataIssueKind, { ru: string; en: string; icon: string }> = {
        'missing-total': { ru: 'Не заполнено значение Total', en: 'Total value is empty', icon: 'circle-slash-2' },
        'unknown-status': { ru: 'Неизвестный статус', en: 'Unknown status', icon: 'circle-help' },
        'invalid-rating': { ru: 'Неверный рейтинг', en: 'Invalid rating', icon: 'star-off' },
        'duplicate-genres': { ru: 'Повторяющиеся жанры', en: 'Duplicate genres', icon: 'copy-x' },
        'legacy-list': { ru: 'Старый строковый список', en: 'Legacy text list', icon: 'list-restart' },
        'alias-conflict': { ru: 'Конфликт алиасов', en: 'Alias conflict', icon: 'git-compare-arrows' },
        'missing-unit': { ru: 'Не указана единица прогресса', en: 'Missing progress unit', icon: 'ruler' }
    };
    let filter: DataIssueKind | 'all' = 'all';
    let refreshVersion = 0;
    $: issues = (refreshVersion, analyzeLibraryData(items, plugin.settings));
    $: visibleIssues = filter === 'all' ? issues : issues.filter(issue => issue.kind === filter);
    $: migrationChanges = buildMigrationPreview(items, plugin.settings);
    $: affectedFiles = new Set(issues.map(issue => issue.item.file.path)).size;

    function count(kind: DataIssueKind): number {
        return issues.filter(issue => issue.kind === kind).length;
    }

    function openIssue(issue: DataHealthIssue): void {
        void app.workspace.getLeaf(false).openFile(issue.item.file);
    }

    function openMigration(): void {
        new PropertyMigrationModal(app, plugin, migrationChanges, () => { refreshVersion++; }).open();
    }
</script>

<div class="data-health">
    <div class="health-summary">
        <div><strong>{items.length}</strong><span>{lang === 'ru' ? 'заметок проверено' : 'notes checked'}</span></div>
        <div class:ok={!issues.length}><strong>{issues.length}</strong><span>{lang === 'ru' ? 'проблем найдено' : 'issues found'}</span></div>
        <div><strong>{affectedFiles}</strong><span>{lang === 'ru' ? 'заметок требуют внимания' : 'notes need attention'}</span></div>
    </div>

    <div class="health-toolbar">
        <select bind:value={filter} aria-label={lang === 'ru' ? 'Тип проблемы' : 'Issue type'}>
            <option value="all">{lang === 'ru' ? 'Все проблемы' : 'All issues'} ({issues.length})</option>
            {#each Object.entries(labels) as [kind, label]}
                <option value={kind}>{lang === 'ru' ? label.ru : label.en} ({count(kind as DataIssueKind)})</option>
            {/each}
        </select>
        <button disabled={!migrationChanges.length} on:click={openMigration}>
            <span use:icon={'list-restart'}></span>
            {lang === 'ru' ? `Миграция свойств (${migrationChanges.length})` : `Migrate properties (${migrationChanges.length})`}
        </button>
    </div>

    {#if !visibleIssues.length}
        <div class="health-empty"><span use:icon={'circle-check-big'}></span><strong>{lang === 'ru' ? 'Свойства в порядке' : 'Properties look good'}</strong></div>
    {:else}
        <div class="issue-list">
            {#each visibleIssues as issue, index (`${issue.item.file.path}-${issue.kind}-${index}`)}
                <button class="issue-row" on:click={() => openIssue(issue)}>
                    <span class="issue-icon" use:icon={labels[issue.kind].icon}></span>
                    <span class="issue-main"><strong>{labels[issue.kind][lang]}</strong><small>{issue.item.title}</small></span>
                    <code>{issue.detail}</code>
                    <span class="open-icon" use:icon={'arrow-up-right'}></span>
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    .data-health { display:flex; flex-direction:column; gap:16px; }
    .health-summary { display:grid; grid-template-columns:repeat(3,minmax(120px,1fr)); gap:1px; border:1px solid var(--background-modifier-border); background:var(--background-modifier-border); }
    .health-summary > div { display:flex; flex-direction:column; gap:4px; padding:12px; background:var(--background-secondary); }
    .health-summary strong { font-size:1.45rem; }
    .health-summary span { color:var(--text-muted); font-size:.72rem; }
    .health-summary .ok strong { color:var(--color-green); }
    .health-toolbar { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .health-toolbar select { height:34px; }
    .health-toolbar button { display:flex; align-items:center; gap:7px; }
    .health-toolbar button span { width:16px; height:16px; }
    .issue-list { border-top:1px solid var(--background-modifier-border); }
    .issue-row { display:grid; grid-template-columns:20px minmax(150px,1fr) minmax(100px,auto) 16px; align-items:center; gap:10px; width:100%; min-height:54px; padding:8px 6px; border:0; border-bottom:1px solid var(--background-modifier-border); border-radius:0; box-shadow:none; background:transparent; text-align:left; }
    .issue-row:hover { background:var(--background-modifier-hover); }
    .issue-icon,.open-icon { width:16px; height:16px; color:var(--text-muted); }
    .issue-main { display:flex; flex-direction:column; gap:2px; min-width:0; }
    .issue-main strong,.issue-main small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .issue-main small { color:var(--text-muted); }
    .issue-row code { overflow:hidden; max-width:280px; color:var(--text-muted); text-overflow:ellipsis; white-space:nowrap; }
    .health-empty { display:flex; flex-direction:column; align-items:center; gap:10px; padding:52px 16px; color:var(--text-muted); }
    .health-empty span { width:42px; height:42px; color:var(--color-green); }
    @media (max-width:650px) {
        .health-summary { grid-template-columns:1fr; }
        .health-toolbar { align-items:stretch; flex-direction:column; }
        .issue-row { grid-template-columns:20px minmax(0,1fr) 16px; }
        .issue-row code { display:none; }
    }
</style>
