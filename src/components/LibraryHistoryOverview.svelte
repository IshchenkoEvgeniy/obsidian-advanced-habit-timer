<script lang="ts">
    import { moment, setIcon } from 'obsidian';
    import type { App } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type { MediaItem } from '../store/StateManager';
    import type { MediaCollectionConfig } from '../types';

    export let items: MediaItem[] = [];
    export let collections: MediaCollectionConfig[] = [];
    export let app: App;
    export let lang: 'en' | 'ru' = 'en';

    interface HistoryItem {
        item: MediaItem;
        date: string;
        startDate: string;
        endDate: string;
        finished: boolean;
    }

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };

    let historyItems: HistoryItem[] = [];
    let loading = false;
    let query = '';
    let selectedYear = 'all';
    let loadVersion = 0;

    $: void loadHistory(items);
    $: availableYears = [...new Set(historyItems.map(entry => entry.date.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
    $: visibleItems = historyItems.filter(entry => {
        if (selectedYear !== 'all' && !entry.date.startsWith(selectedYear)) return false;
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) return true;
        return [entry.item.title, entry.item.authorOrDirector, entry.item.genre, entry.item.series]
            .join(' ').toLowerCase().includes(normalizedQuery);
    });
    $: groupedItems = groupByMonth(visibleItems);
    $: finishedItems = items.filter(item => isFinished(item));
    $: totalProgress = finishedItems.reduce((sum, item) => sum + Math.max(0, item.total), 0);
    $: mediaMinutes = finishedItems
        .filter(item => isTimedMedia(item))
        .reduce((sum, item) => sum + Math.max(0, item.total), 0);
    $: topGenres = getTopGenres(finishedItems);

    async function loadHistory(source: MediaItem[]): Promise<void> {
        const version = ++loadVersion;
        loading = true;
        const loaded = await Promise.all(source.map(async item => {
            const dates = await readProgressDates(item);
            const finished = isFinished(item);
            const startDate = dates[0] || item.startDate || '';
            const endDate = finished ? (dates[dates.length - 1] || item.endDate || '') : '';
            const date = endDate || startDate;
            return date ? { item, date, startDate, endDate, finished } : null;
        }));
        if (version !== loadVersion) return;
        historyItems = loaded
            .filter((entry): entry is HistoryItem => entry !== null)
            .sort((a, b) => b.date.localeCompare(a.date));
        loading = false;
    }

    async function readProgressDates(item: MediaItem): Promise<string[]> {
        try {
            const content = await app.vault.cachedRead(item.file);
            const dates = content.split('\n')
                .filter(line => line.trimStart().startsWith('|'))
                .map(line => line.split('|')[1]?.trim() || '')
                .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value));
            return [...new Set(dates)].sort();
        } catch {
            return [];
        }
    }

    function isFinished(item: MediaItem): boolean {
        const collection = collections.find(value => value.id === item.collectionId);
        return Boolean(collection && item.status === collection.finishedStatusName);
    }

    function isTimedMedia(item: MediaItem): boolean {
        const format = item.format.toLowerCase();
        return format.includes('audio') || format.includes('аудио') || item.collectionId === 'film';
    }

    function getTopGenres(source: MediaItem[]): string {
        const counts = new Map<string, number>();
        source.forEach(item => {
            item.genres.forEach(genre => {
                counts.set(genre, (counts.get(genre) || 0) + 1);
            });
        });
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([genre]) => genre).join(', ') || '—';
    }

    function groupByMonth(source: HistoryItem[]): Array<{ key: string; label: string; items: HistoryItem[] }> {
        const groups = new Map<string, HistoryItem[]>();
        source.forEach(entry => {
            const key = entry.date.slice(0, 7);
            groups.set(key, [...(groups.get(key) || []), entry]);
        });
        return [...groups.entries()].map(([key, values]) => ({
            key,
            label: moment(`${key}-01`).locale(lang).format('MMMM YYYY'),
            items: values
        }));
    }

    function formatDate(date: string): string {
        return moment(date, 'YYYY-MM-DD').format('DD.MM.YYYY');
    }

    function openItem(item: MediaItem): void {
        void app.workspace.getLeaf(false).openFile(item.file);
    }
</script>

<div class="history-overview">
    <div class="overview-summary">
        <div><span>{lang === 'ru' ? 'Завершено' : 'Finished media'}</span><strong>{finishedItems.length}</strong></div>
        <div><span>{lang === 'ru' ? 'Общий объём' : 'Total progress units'}</span><strong>{totalProgress}</strong></div>
        {#if mediaMinutes > 0}<div><span>{lang === 'ru' ? 'Аудио и фильмы' : 'Audio and films'}</span><strong>{Math.floor(mediaMinutes / 60)}h {mediaMinutes % 60}m</strong></div>{/if}
        <div class="genres-stat"><span>{lang === 'ru' ? 'Популярные жанры' : 'Top genres'}</span><strong>{topGenres}</strong></div>
    </div>

    <div class="history-toolbar">
        <div class="search-field"><span use:icon={'search'}></span><input type="search" bind:value={query} placeholder={lang === 'ru' ? 'Поиск по истории' : 'Search history'} /></div>
        <select bind:value={selectedYear} aria-label={lang === 'ru' ? 'Год' : 'Year'}>
            <option value="all">{lang === 'ru' ? 'Все годы' : 'All years'}</option>
            {#each availableYears as year}<option value={year}>{year}</option>{/each}
        </select>
    </div>

    {#if loading}
        <div class="history-empty">{lang === 'ru' ? 'Собираем историю…' : 'Loading history…'}</div>
    {:else if !visibleItems.length}
        <div class="history-empty">{lang === 'ru' ? 'Нет записей с датами прогресса' : 'No dated progress records'}</div>
    {:else}
        <div class="history-list">
            {#each groupedItems as group (group.key)}
                <section>
                    <h3>{group.label}</h3>
                    {#each group.items as entry (entry.item.file.path)}
                        <button class="history-row" on:click={() => openItem(entry.item)}>
                            <span class="date">{formatDate(entry.date)}</span>
                            <span class="row-icon" class:finished={entry.finished} use:icon={entry.finished ? 'check-circle-2' : 'circle-play'}></span>
                            <span class="identity"><strong>{entry.item.title}</strong><small>{entry.item.authorOrDirector || entry.item.collectionId}</small></span>
                            {#if entry.item.rating}<span class="rating">★ {entry.item.rating}</span>{/if}
                            <span class:finished={entry.finished} class="status">{entry.item.status || (lang === 'ru' ? 'Без статуса' : 'No status')}</span>
                        </button>
                    {/each}
                </section>
            {/each}
        </div>
    {/if}
</div>

<style>
    .history-overview { display:flex; flex-direction:column; gap:18px; }
    .overview-summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(145px,1fr)); border:1px solid var(--background-modifier-border); background:var(--background-modifier-border); gap:1px; }
    .overview-summary > div { display:flex; flex-direction:column; gap:5px; min-height:72px; padding:13px; background:var(--background-secondary); }
    .overview-summary span { color:var(--text-muted); font-size:.7rem; text-transform:uppercase; }
    .overview-summary strong { font-size:1.3rem; font-weight:700; }
    .overview-summary .genres-stat strong { font-size:.9rem; line-height:1.35; }
    .history-toolbar { display:flex; gap:8px; justify-content:space-between; }
    .search-field { display:grid; grid-template-columns:16px minmax(0,1fr); align-items:center; gap:7px; flex:1; max-width:420px; padding-left:10px; border:1px solid var(--background-modifier-border); border-radius:5px; background:var(--background-modifier-form-field); }
    .search-field span { width:15px; height:15px; color:var(--text-muted); }
    .search-field input { width:100%; height:34px; padding:0; border:0; box-shadow:none; background:transparent; }
    .history-toolbar select { height:34px; }
    .history-list section { margin:0 0 22px; }
    .history-list h3 { margin:0; padding:7px 0; border-bottom:1px solid var(--background-modifier-border); color:var(--text-muted); font-size:.78rem; text-transform:capitalize; }
    .history-row { display:grid; grid-template-columns:82px 18px minmax(150px,1fr) auto auto; align-items:center; gap:10px; width:100%; min-height:54px; margin:0; padding:8px 6px; border:0; border-bottom:1px solid var(--background-modifier-border); border-radius:0; box-shadow:none; background:transparent; text-align:left; }
    .history-row:hover { background:var(--background-modifier-hover); }
    .date { color:var(--text-muted); font-family:var(--font-monospace); font-size:.72rem; }
    .row-icon { width:16px; height:16px; color:var(--text-muted); }
    .row-icon.finished { color:var(--color-green); }
    .identity { display:flex; flex-direction:column; gap:3px; min-width:0; }
    .identity strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .identity small { color:var(--text-muted); text-transform:capitalize; }
    .rating { color:var(--color-yellow); white-space:nowrap; }
    .status { padding:3px 7px; border-radius:4px; background:var(--background-modifier-form-field); color:var(--text-muted); font-size:.68rem; white-space:nowrap; }
    .status.finished { background:rgba(var(--color-green-rgb),.14); color:var(--color-green); }
    .history-empty { padding:48px 16px; color:var(--text-muted); text-align:center; }
    @media (max-width:620px) {
        .history-row { grid-template-columns:70px 16px minmax(100px,1fr) auto; }
        .history-row .rating { display:none; }
        .status { grid-column:3 / -1; justify-self:start; }
        .history-toolbar { flex-wrap:wrap; }
        .search-field { max-width:none; min-width:100%; }
    }
</style>
