<script lang="ts">
    import { onDestroy } from 'svelte';
    import { moment, Notice } from 'obsidian';
    import type { App, WorkspaceLeaf } from 'obsidian';
    import { t } from '../i18n';
    import type { TranslationKey } from '../i18n';
    import type HabitTimerPlugin from '../main';
    import type { MediaItem } from '../store/StateManager';
    import type { Frontmatter } from '../utils/frontmatter';
    import { getRatingValue } from '../utils/rating';
    import { readPropertyNumber, writeProperty } from '../library/property-schema';
    import { collectionDailyGoalUnit, dailyGoalUnitLabel, normalizeDailyGoalUnit, quickProgressStep } from '../library/daily-goals';
    import { AddMediaModal, MediaInteractionModal } from '../media-modals';
    import LibraryCard from './LibraryCard.svelte';
    import SearchFilter from './SearchFilter.svelte';
    import LibraryStats from './LibraryStats.svelte';
    import LibraryTimeline from './LibraryTimeline.svelte';
    import LibraryHistoryOverview from './LibraryHistoryOverview.svelte';
    import LibraryDataHealth from './LibraryDataHealth.svelte';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    export const leaf: WorkspaceLeaf = undefined as unknown as WorkspaceLeaf;

    type StatusFilter = 'all' | 'active' | 'paused' | 'queue' | 'planned' | 'finished';
    type DetailKind = 'author' | 'series';

    const state = plugin.stateManager;
    let items: MediaItem[] = [];
    const unsubscribe = state.mediaItems.subscribe(value => { items = value; });
    onDestroy(unsubscribe);

    let currentCollectionId = 'all';
    let activeTab: 'gallery' | 'stats' | 'timeline' | 'history' | 'health' = 'gallery';
    let searchQuery = '';
    let sortOption = 'title-asc';
    let statusFilter: StatusFilter = 'all';
    let formatFilter = 'all';
    let genreFilter = 'all';
    let seriesFilter = 'all';
    let zoomLevel = plugin.settings.libraryZoom || 1;
    const lang = plugin.settings.language;
    let detailKind: DetailKind | null = null;
    let detailValue = '';
    let previousCollectionId = currentCollectionId;

    const showAuthor = plugin.settings.libraryShowAuthor !== false;
    const showRating = plugin.settings.libraryShowRating !== false;
    const showProgress = plugin.settings.libraryShowProgress !== false;
    const showSeries = plugin.settings.libraryShowSeries !== false;
    const showGenre = plugin.settings.libraryShowGenre !== false;

    $: collections = plugin.settings.mediaCollections.filter(collection => collection.enabled);
    $: collectionItems = currentCollectionId === 'all'
        ? items
        : items.filter(item => item.collectionId === currentCollectionId);
    $: genres = uniqueArrayValues(collectionItems, 'genres');
    $: seriesOptions = uniqueValues(collectionItems, 'series');
    $: activeCollection = collections.find(collection => collection.id === currentCollectionId);
    $: statusOptions = [
        { value: 'active', label: activeCollection?.readingStatusName || (lang === 'ru' ? 'В процессе' : 'In progress') },
        { value: 'paused', label: activeCollection?.pausedStatusName || (lang === 'ru' ? 'На паузе' : 'Paused') },
        { value: 'queue', label: lang === 'ru' ? 'Очередь' : 'Queue' },
        { value: 'planned', label: lang === 'ru' ? 'В планах' : 'Planned' },
        { value: 'finished', label: activeCollection?.finishedStatusName || (lang === 'ru' ? 'Завершено' : 'Finished') }
    ];
    $: formatOptions = [
        { value: 'paper', label: 'Paper' },
        { value: 'ebook', label: 'E-book' },
        { value: 'audiobook', label: 'Audio' }
    ];
    $: genreOptions = genres.map(genre => ({ value: genre, label: genre }));
    $: searchableSeriesOptions = seriesOptions.map(series => ({ value: series, label: series }));
    $: showFormatFilter = currentCollectionId === 'all' || collectionItems.some(item => Boolean(normalizeFormat(item)));
    $: if (currentCollectionId !== previousCollectionId) {
        previousCollectionId = currentCollectionId;
        formatFilter = 'all';
        genreFilter = 'all';
        seriesFilter = 'all';
    }
    $: filteredItems = calculateFilteredItems(
        items, currentCollectionId, searchQuery, sortOption, statusFilter,
        formatFilter, genreFilter, seriesFilter
    );
    $: readingItems = filteredItems.filter(item => getStatusKind(item) === 'active');
    $: pausedItems = filteredItems.filter(item => getStatusKind(item) === 'paused');
    $: queueItems = filteredItems
        .filter(item => getStatusKind(item) === 'queue')
        .sort(compareQueueItems);
    $: plannedItems = filteredItems.filter(item => getStatusKind(item) === 'planned');
    $: finishedItems = filteredItems.filter(item => getStatusKind(item) === 'finished');
    $: detailItems = getDetailItems(items, detailKind, detailValue);
    $: detailFinished = detailItems.filter(item => getStatusKind(item) === 'finished').length;
    $: detailRating = average(detailItems.map(item => getRatingValue(item.rating)).filter(value => value > 0));
    $: detailProgress = getCombinedProgress(detailItems);

    function uniqueValues(source: MediaItem[], key: 'genre' | 'series'): string[] {
        return [...new Set(source.map(item => item[key].trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
    }

    function uniqueArrayValues(source: MediaItem[], key: 'authors' | 'genres'): string[] {
        return [...new Set(source.flatMap(item => item[key]).map(value => value.trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
    }

    function calculateFilteredItems(
        source: MediaItem[], collectionId: string, query: string, sort: string,
        status: StatusFilter, format: string, genre: string, series: string
    ): MediaItem[] {
        const normalizedQuery = query.trim().toLowerCase();
        const filtered = source.filter(item => {
            if (collectionId !== 'all' && item.collectionId !== collectionId) return false;
            if (status !== 'all' && getStatusKind(item) !== status) return false;
            if (format !== 'all' && normalizeFormat(item) !== format) return false;
            if (genre !== 'all' && !item.genres.includes(genre)) return false;
            if (series !== 'all' && item.series !== series) return false;
            if (normalizedQuery) {
                const haystack = [item.title, item.authorOrDirector, item.genre, item.series]
                    .join(' ').toLowerCase();
                if (!haystack.includes(normalizedQuery)) return false;
            }
            return true;
        });

        return filtered.sort((a, b) => compareItems(a, b, sort));
    }

    function compareItems(a: MediaItem, b: MediaItem, sort: string): number {
        const direction = sort.endsWith('asc') ? 1 : -1;
        if (sort.startsWith('progress')) return direction * (progressRatio(a) - progressRatio(b));
        if (sort.startsWith('rating')) return direction * (getRatingValue(a.rating) - getRatingValue(b.rating));
        const aValue = sort.startsWith('author') ? a.authorOrDirector : a.title;
        const bValue = sort.startsWith('author') ? b.authorOrDirector : b.title;
        return direction * aValue.localeCompare(bValue);
    }

    function getStatusKind(item: MediaItem): Exclude<StatusFilter, 'all'> {
        const collection = collections.find(value => value.id === item.collectionId);
        if (collection && item.status === collection.readingStatusName) return 'active';
        if (collection && item.status === collection.pausedStatusName) return 'paused';
        if (collection && item.status === collection.finishedStatusName) return 'finished';
        if ((item.queueOrder || 0) > 0) return 'queue';
        return 'planned';
    }

    function compareQueueItems(a: MediaItem, b: MediaItem): number {
        const orderDifference = (a.queueOrder || Number.MAX_SAFE_INTEGER) - (b.queueOrder || Number.MAX_SAFE_INTEGER);
        return orderDifference || a.title.localeCompare(b.title);
    }

    function normalizeFormat(item: MediaItem): string {
        const value = item.format.toLowerCase();
        if (value.includes('audio') || value.includes('аудио')) return 'audiobook';
        if (value.includes('ebook') || value.includes('e-book') || value.includes('элект')) return 'ebook';
        if (value.includes('paper') || value.includes('бумаж') || item.collectionId === 'book') return 'paper';
        return '';
    }

    function progressRatio(item: MediaItem): number {
        return item.total > 0 ? item.progress / item.total : 0;
    }

    function average(values: number[]): number {
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    }

    function getCombinedProgress(source: MediaItem[]): number {
        const total = source.reduce((sum, item) => sum + Math.max(0, item.total), 0);
        if (!total) return 0;
        const progress = source.reduce((sum, item) => sum + Math.min(Math.max(0, item.progress), item.total), 0);
        return Math.round(progress / total * 100);
    }

    function getDetailItems(source: MediaItem[], kind: DetailKind | null, value: string): MediaItem[] {
        if (!kind || !value) return [];
        return source
            .filter(item => kind === 'author' ? item.authors.includes(value) : item.series === value)
            .sort((a, b) => {
                if (kind === 'series') {
                    const aIndex = a.seriesIndex > 0 ? a.seriesIndex : Number.MAX_SAFE_INTEGER;
                    const bIndex = b.seriesIndex > 0 ? b.seriesIndex : Number.MAX_SAFE_INTEGER;
                    if (aIndex !== bIndex) return aIndex - bIndex;
                }
                return a.title.localeCompare(b.title);
            });
    }

    function openDetail(kind: DetailKind, value: string): void {
        if (!value) return;
        detailKind = kind;
        detailValue = value;
        activeTab = 'gallery';
    }

    function closeDetail(): void {
        detailKind = null;
        detailValue = '';
    }

    function clearFilters(): void {
        statusFilter = 'all';
        formatFilter = 'all';
        genreFilter = 'all';
        seriesFilter = 'all';
        searchQuery = '';
    }

    function openMedia(item: MediaItem): void {
        new MediaInteractionModal(app, plugin, item).open();
    }

    async function openFile(item: MediaItem): Promise<void> {
        await app.workspace.getLeaf(false).openFile(item.file);
    }

    async function incrementProgress(item: MediaItem): Promise<void> {
        const collection = collections.find(value => value.id === item.collectionId);
        const fallbackUnit = normalizeFormat(item) === 'audiobook'
            ? 'minutes'
            : collection ? collectionDailyGoalUnit(collection) : 'units';
        const unit = normalizeDailyGoalUnit(item.unit, fallbackUnit);
        const step = quickProgressStep(unit);
        let added = 0;
        let newProgress = item.progress;
        await app.fileManager.processFrontMatter(item.file, frontmatter => {
            const fm = frontmatter as Frontmatter;
            const current = readPropertyNumber(fm, plugin.settings, 'progress', item.progress);
            newProgress = item.total > 0 ? Math.min(item.total, current + step) : current + step;
            added = Math.max(0, newProgress - current);
            writeProperty(fm, plugin.settings, 'progress', newProgress);
            writeProperty(fm, plugin.settings, 'unit', unit);
        });
        if (added > 0) {
            const total = item.total > 0 ? item.total : '?';
            const percent = item.total > 0 ? `${Math.round(newProgress / item.total * 100)}%` : '-';
            const date = moment().format('YYYY-MM-DD');
            await app.vault.process(item.file, content => {
                if (!content.includes('### 📖 Progress')) {
                    content += '\n\n---\n\n### 📖 Progress\n| Date | Time | Progress | % | Notes |\n|---|---|---|---|---|\n';
                }
                return content + `| ${date} | 00:00:00 | ${added} | (Total: ${newProgress}/${total} - ${percent}) | Quick progress |\n`;
            });
        }
        const unitLabel = dailyGoalUnitLabel(unit, lang === 'ru' ? 'ru' : 'en');
        new Notice(lang === 'ru' ? `Прогресс +${added} ${unitLabel}` : `Progress +${added} ${unitLabel}`);
    }

    async function startMedia(item: MediaItem): Promise<void> {
        const collection = collections.find(value => value.id === item.collectionId);
        if (!collection) return;
        const startDate = item.startDate || moment().format('YYYY-MM-DD');
        if (item.status !== collection.readingStatusName || !item.startDate) {
            await app.fileManager.processFrontMatter(item.file, frontmatter => {
                const fm = frontmatter as Frontmatter;
                writeProperty(fm, plugin.settings, 'status', collection.readingStatusName);
                if (!item.startDate) writeProperty(fm, plugin.settings, 'startDate', startDate);
            });
            new Notice(lang === 'ru' ? `«${item.title}»: чтение начато` : `Started “${item.title}”`);
        }
        // startTimerForMedia использует только collectionId/file/title —
        // дополнительные поля (status/startDate) в вызов не передаются
        await plugin.startTimerForMedia(item);
    }

    async function pauseMedia(item: MediaItem): Promise<void> {
        const collection = collections.find(value => value.id === item.collectionId);
        if (!collection) return;
        await app.fileManager.processFrontMatter(item.file, frontmatter => {
            writeProperty(frontmatter as Frontmatter, plugin.settings, 'status', collection.pausedStatusName || 'На паузе');
        });
        new Notice(lang === 'ru' ? `«${item.title}»: на паузе` : `Paused “${item.title}”`);
    }

    async function writeQueueOrder(item: MediaItem, order: number): Promise<void> {
        await app.fileManager.processFrontMatter(item.file, frontmatter => {
            writeProperty(frontmatter as Frontmatter, plugin.settings, 'queueOrder', Math.max(0, order));
        });
    }

    async function toggleQueue(item: MediaItem): Promise<void> {
        if ((item.queueOrder || 0) > 0) {
            await writeQueueOrder(item, 0);
            new Notice(lang === 'ru' ? `«${item.title}» удалено из очереди` : `Removed “${item.title}” from queue`);
            return;
        }
        const nextOrder = items.reduce((maximum, value) => Math.max(maximum, value.queueOrder || 0), 0) + 1;
        await writeQueueOrder(item, nextOrder);
        new Notice(lang === 'ru' ? `«${item.title}» добавлено в очередь` : `Added “${item.title}” to queue`);
    }

    async function moveQueue(item: MediaItem, direction: -1 | 1): Promise<void> {
        const ordered = items.filter(value => (value.queueOrder || 0) > 0).sort(compareQueueItems);
        const index = ordered.findIndex(value => value.file.path === item.file.path);
        const neighbour = ordered[index + direction];
        if (index < 0 || !neighbour) return;
        const itemOrder = item.queueOrder || index + 1;
        const neighbourOrder = neighbour.queueOrder || index + direction + 1;
        await writeQueueOrder(item, neighbourOrder);
        await writeQueueOrder(neighbour, itemOrder);
    }

    function saveZoom(): void {
        plugin.settings.libraryZoom = zoomLevel;
        void plugin.saveSettings();
    }
</script>

<div class="library-controls">
    <div class="category-chips">
        <!-- Ключи 'all', 'sort_author_asc', 'sort_author_desc' отсутствуют в локалях:
             t() возвращает сам ключ (привычное поведение), i18n намеренно не расширяется -->
        <button class="chip" class:active={currentCollectionId === 'all'} on:click={() => currentCollectionId = 'all'}>{t(lang, 'all' as string as TranslationKey) || 'All'}</button>
        {#each collections as collection}
            <button class="chip" class:active={currentCollectionId === collection.id} on:click={() => currentCollectionId = collection.id}>{collection.id}</button>
        {/each}
    </div>
    <input type="search" placeholder={t(lang, 'search_placeholder') || 'Search...'} bind:value={searchQuery} />
    <select bind:value={sortOption} aria-label={lang === 'ru' ? 'Сортировка' : 'Sort'}>
        <option value="title-asc">{t(lang, 'sort_title_asc')}</option>
        <option value="title-desc">{t(lang, 'sort_title_desc')}</option>
        <option value="author-asc">{t(lang, 'sort_author_asc' as string as TranslationKey)}</option>
        <option value="author-desc">{t(lang, 'sort_author_desc' as string as TranslationKey)}</option>
        <option value="rating-desc">{t(lang, 'sort_rating_desc')}</option>
        <option value="progress-desc">{t(lang, 'sort_progress_desc')}</option>
    </select>
</div>

<div class="filter-bar">
    <SearchFilter bind:value={statusFilter} options={statusOptions} allLabel={lang === 'ru' ? 'Все статусы' : 'All statuses'} ariaLabel={lang === 'ru' ? 'Поиск статуса' : 'Search status'} emptyLabel={lang === 'ru' ? 'Статус не найден' : 'Status not found'} />
    {#if showFormatFilter}
        <SearchFilter bind:value={formatFilter} options={formatOptions} allLabel={lang === 'ru' ? 'Все форматы' : 'All formats'} ariaLabel={lang === 'ru' ? 'Поиск формата' : 'Search format'} emptyLabel={lang === 'ru' ? 'Формат не найден' : 'Format not found'} />
    {/if}
    {#if genreOptions.length}
        <SearchFilter bind:value={genreFilter} options={genreOptions} allLabel={lang === 'ru' ? 'Все жанры' : 'All genres'} ariaLabel={lang === 'ru' ? 'Поиск жанра' : 'Search genre'} emptyLabel={lang === 'ru' ? 'Жанр не найден' : 'Genre not found'} />
    {/if}
    {#if searchableSeriesOptions.length}
        <SearchFilter bind:value={seriesFilter} options={searchableSeriesOptions} allLabel={lang === 'ru' ? 'Все серии' : 'All series'} ariaLabel={lang === 'ru' ? 'Поиск серии' : 'Search series'} emptyLabel={lang === 'ru' ? 'Серия не найдена' : 'Series not found'} />
    {/if}
    <button class="clear-filters" on:click={clearFilters}>{lang === 'ru' ? 'Сбросить' : 'Reset'}</button>
</div>

<div class="library-tabs">
    <button class:active={activeTab === 'gallery'} on:click={() => activeTab = 'gallery'}>{t(lang, 'lib_tab_gallery')}</button>
    <button class:active={activeTab === 'stats'} on:click={() => activeTab = 'stats'}>{t(lang, 'lib_tab_stats')}</button>
    <button class:active={activeTab === 'timeline'} on:click={() => activeTab = 'timeline'}>{t(lang, 'lib_tab_timeline')}</button>
    <button class:active={activeTab === 'history'} on:click={() => activeTab = 'history'}>{lang === 'ru' ? 'Обзор истории' : 'History overview'}</button>
    <button class:active={activeTab === 'health'} on:click={() => activeTab = 'health'}>{lang === 'ru' ? 'Свойства' : 'Properties'}</button>
    {#if activeTab === 'gallery'}
        <label class="zoom-control">{lang === 'ru' ? 'Размер' : 'Size'}<input type="range" bind:value={zoomLevel} min="0.65" max="1.35" step="0.05" on:change={saveZoom} /></label>
    {/if}
</div>

<button class="add-media-fab" title={t(lang, 'add_media_btn')} on:click={() => new AddMediaModal(app, plugin).open()}>+</button>

<main class="library-content-area">
    {#if activeTab === 'gallery'}
        <div class="gallery" style:zoom={zoomLevel}>
            {#if detailKind}
                <section class="detail-page">
                    <button class="back-button" on:click={closeDetail}>← {lang === 'ru' ? 'Назад' : 'Back'}</button>
                    <p class="detail-kind">{detailKind === 'author' ? (lang === 'ru' ? 'Автор' : 'Author') : (lang === 'ru' ? 'Серия' : 'Series')}</p>
                    <h2>{detailValue}</h2>
                    <div class="detail-stats">
                        <div><strong>{detailItems.length}</strong><span>{lang === 'ru' ? 'всего' : 'items'}</span></div>
                        <div><strong>{detailFinished}</strong><span>{lang === 'ru' ? 'завершено' : 'finished'}</span></div>
                        <div><strong>{detailProgress}%</strong><span>{lang === 'ru' ? 'прогресс' : 'progress'}</span></div>
                        <div><strong>{detailRating ? detailRating.toFixed(1) : '—'}</strong><span>{lang === 'ru' ? 'средняя оценка' : 'average rating'}</span></div>
                    </div>
                    <div class="library-grid">
                        {#each detailItems as item (item.file.path)}
                            <LibraryCard {item} collection={collections.find(value => value.id === item.collectionId)} {lang} {showAuthor} {showRating} {showProgress} {showSeries} {showGenre} onOpen={openMedia} onOpenFile={openFile} onIncrement={incrementProgress} onStart={startMedia} onPause={pauseMedia} onQueueToggle={toggleQueue} onQueueMove={moveQueue} onAuthor={(value) => openDetail('author', value)} onSeries={(value) => openDetail('series', value)} />
                        {/each}
                    </div>
                </section>
            {:else}
                {#if readingItems.length}
                    <section><h2>{lang === 'ru' ? 'Сейчас в процессе' : 'In progress'}</h2><div class="hero-grid">
                        {#each readingItems as item (item.file.path)}
                            <LibraryCard {item} hero collection={collections.find(value => value.id === item.collectionId)} {lang} {showAuthor} {showRating} {showProgress} {showSeries} {showGenre} onOpen={openMedia} onOpenFile={openFile} onIncrement={incrementProgress} onStart={startMedia} onPause={pauseMedia} onQueueToggle={toggleQueue} onQueueMove={moveQueue} onAuthor={(value) => openDetail('author', value)} onSeries={(value) => openDetail('series', value)} />
                        {/each}
                    </div></section>
                {/if}
                {#if pausedItems.length}
                    <section><h3>{lang === 'ru' ? 'На паузе' : 'Paused'}</h3><div class="library-grid">
                        {#each pausedItems as item (item.file.path)}
                            <LibraryCard {item} collection={collections.find(value => value.id === item.collectionId)} {lang} {showAuthor} {showRating} {showProgress} {showSeries} {showGenre} onOpen={openMedia} onOpenFile={openFile} onIncrement={incrementProgress} onStart={startMedia} onPause={pauseMedia} onQueueToggle={toggleQueue} onQueueMove={moveQueue} onAuthor={(value) => openDetail('author', value)} onSeries={(value) => openDetail('series', value)} />
                        {/each}
                    </div></section>
                {/if}
                {#if queueItems.length}
                    <section><h3>{lang === 'ru' ? 'Очередь' : 'Queue'}</h3><div class="library-grid queue-grid">
                        {#each queueItems as item (item.file.path)}
                            <LibraryCard {item} collection={collections.find(value => value.id === item.collectionId)} {lang} {showAuthor} {showRating} {showProgress} {showSeries} {showGenre} onOpen={openMedia} onOpenFile={openFile} onIncrement={incrementProgress} onStart={startMedia} onPause={pauseMedia} onQueueToggle={toggleQueue} onQueueMove={moveQueue} onAuthor={(value) => openDetail('author', value)} onSeries={(value) => openDetail('series', value)} />
                        {/each}
                    </div></section>
                {/if}
                {#if plannedItems.length}
                    <section><h3>{lang === 'ru' ? 'В планах' : 'Planned'}</h3><div class="library-grid">
                        {#each plannedItems as item (item.file.path)}
                            <LibraryCard {item} collection={collections.find(value => value.id === item.collectionId)} {lang} {showAuthor} {showRating} {showProgress} {showSeries} {showGenre} onOpen={openMedia} onOpenFile={openFile} onIncrement={incrementProgress} onStart={startMedia} onPause={pauseMedia} onQueueToggle={toggleQueue} onQueueMove={moveQueue} onAuthor={(value) => openDetail('author', value)} onSeries={(value) => openDetail('series', value)} />
                        {/each}
                    </div></section>
                {/if}
                {#if finishedItems.length}
                    <section><h3>{lang === 'ru' ? 'Завершено' : 'Finished'}</h3><div class="library-grid">
                        {#each finishedItems as item (item.file.path)}
                            <LibraryCard {item} collection={collections.find(value => value.id === item.collectionId)} {lang} {showAuthor} {showRating} {showProgress} {showSeries} {showGenre} onOpen={openMedia} onOpenFile={openFile} onIncrement={incrementProgress} onStart={startMedia} onPause={pauseMedia} onQueueToggle={toggleQueue} onQueueMove={moveQueue} onAuthor={(value) => openDetail('author', value)} onSeries={(value) => openDetail('series', value)} />
                        {/each}
                    </div></section>
                {/if}
                {#if !filteredItems.length}<div class="library-empty">{t(lang, 'no_data')}</div>{/if}
            {/if}
        </div>
    {:else if activeTab === 'stats'}
        <LibraryStats items={filteredItems} {collections} collectionId={currentCollectionId} {lang} {plugin} />
    {:else if activeTab === 'timeline'}
        <LibraryTimeline items={filteredItems} {collections} collectionId={currentCollectionId} {app} {plugin} {lang} />
    {:else if activeTab === 'history'}
        <LibraryHistoryOverview items={filteredItems} {collections} {app} {lang} />
    {:else}
        <LibraryDataHealth items={collectionItems} {app} {plugin} {lang} />
    {/if}
</main>

<style>
    .library-controls,.filter-bar { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:10px; border-bottom:1px solid var(--background-modifier-border); }
    .category-chips { display:flex; flex:1 1 360px; flex-wrap:wrap; gap:6px; }
    .chip { padding:5px 10px; border-radius:5px; text-transform:capitalize; }
    .chip.active,.library-tabs button.active { background:var(--interactive-accent); color:var(--text-on-accent); }
    input[type="search"] { flex:1 1 220px; min-width:160px; }
    select,input[type="search"] { height:34px; max-width:220px; }
    .filter-bar { background:var(--background-secondary); }
    .clear-filters { margin-left:auto; }
    .library-tabs { display:flex; align-items:center; gap:6px; margin:12px 0 20px; padding-bottom:10px; border-bottom:1px solid var(--background-modifier-border); }
    .library-tabs button { padding:6px 12px; border-radius:5px; }
    .zoom-control { display:flex; align-items:center; gap:7px; margin-left:auto; color:var(--text-muted); font-size:.8rem; }
    .zoom-control input { width:110px; }
    .library-content-area { position:relative; }
    .gallery { transform-origin:top left; }
    section { margin-bottom:34px; }
    section h2,section h3 { margin:0 0 12px; letter-spacing:0; }
    .hero-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:14px; }
    .library-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(155px,1fr)); gap:12px; }
    .add-media-fab { position:fixed; right:28px; bottom:28px; z-index:20; width:46px; height:46px; padding:0; border-radius:50%; background:var(--interactive-accent); color:var(--text-on-accent); font-size:24px; }
    .detail-page { max-width:1100px; }
    .back-button { margin-bottom:18px; }
    .detail-kind { margin:0 0 3px; color:var(--text-muted); font-size:.75rem; text-transform:uppercase; }
    .detail-page h2 { font-size:1.8rem; }
    .detail-stats { display:grid; grid-template-columns:repeat(4,minmax(90px,1fr)); gap:1px; margin:16px 0 22px; border:1px solid var(--background-modifier-border); background:var(--background-modifier-border); }
    .detail-stats div { display:flex; flex-direction:column; gap:3px; padding:13px; background:var(--background-secondary); }
    .detail-stats strong { font-size:1.25rem; }
    .detail-stats span { color:var(--text-muted); font-size:.72rem; }
    .library-empty { padding:50px; text-align:center; color:var(--text-muted); }
    @media (max-width:600px) {
        .detail-stats { grid-template-columns:repeat(2,1fr); }
        .library-grid { grid-template-columns:repeat(2,minmax(120px,1fr)); }
        .hero-grid { grid-template-columns:1fr; }
    }
</style>
