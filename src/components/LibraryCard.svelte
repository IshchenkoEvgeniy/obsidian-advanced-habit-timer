<script lang="ts">
    import { setIcon } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type { MediaItem } from '../store/StateManager';
    import type { MediaCollectionConfig } from '../types';
    import { calculateMediaPace } from '../library/pace';

    export let item: MediaItem;
    export let collection: MediaCollectionConfig | undefined;
    export let lang: 'en' | 'ru';
    export let hero = false;
    export let showAuthor = true;
    export let showRating = true;
    export let showProgress = true;
    export let showSeries = true;
    export let showGenre = true;
    export let onOpen: (item: MediaItem) => void;
    export let onOpenFile: (item: MediaItem) => void;
    export let onIncrement: (item: MediaItem) => void;
    export let onStart: (item: MediaItem) => void;
    export let onPause: (item: MediaItem) => void;
    export let onQueueToggle: (item: MediaItem) => void;
    export let onQueueMove: (item: MediaItem, direction: -1 | 1) => void;
    export let onAuthor: (value: string) => void;
    export let onSeries: (value: string) => void;

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };

    $: percent = item.total > 0 ? Math.min(100, Math.max(0, item.progress / item.total * 100)) : 0;
    $: format = normalizeFormat(item.format);
    $: formatLabel = format === 'audiobook' ? 'Audio' : format === 'ebook' ? 'E-book' : format === 'paper' ? 'Paper' : '';
    $: statusKind = collection && item.status === collection.finishedStatusName
        ? 'finished'
        : collection && item.status === collection.readingStatusName
            ? 'active'
            : collection?.pausedStatusName && item.status === collection.pausedStatusName ? 'paused' : 'planned';
    $: statusLabel = item.status || (lang === 'ru' ? 'В планах' : 'Planned');
    $: unitLabel = getUnitLabel(item);
    $: pace = statusKind === 'finished'
        ? null
        : calculateMediaPace(item.progress, item.total, item.targetDate || '', new Date().toISOString().slice(0, 10));

    function normalizeFormat(value: string): 'paper' | 'ebook' | 'audiobook' | '' {
        const normalized = value.toLowerCase();
        if (normalized.includes('audio') || normalized.includes('аудио')) return 'audiobook';
        if (normalized.includes('ebook') || normalized.includes('e-book') || normalized.includes('элект')) return 'ebook';
        if (normalized.includes('paper') || normalized.includes('бумаж')) return 'paper';
        return item.collectionId === 'book' ? 'paper' : '';
    }

    function getUnitLabel(media: MediaItem): string {
        const raw = media.unit.toLowerCase();
        if (raw.includes('minute') || raw.includes('мин') || format === 'audiobook') return lang === 'ru' ? 'мин' : 'min';
        if (raw.includes('episode') || raw.includes('эпиз') || ['series', 'anime'].includes(media.collectionId)) return lang === 'ru' ? 'эп.' : 'ep.';
        if (raw.includes('chapter') || raw.includes('глав')) return lang === 'ru' ? 'гл.' : 'ch.';
        if (raw.includes('hour') || raw.includes('час') || media.collectionId === 'game') return lang === 'ru' ? 'ч' : 'h';
        if (raw.includes('lesson') || raw.includes('урок') || media.collectionId === 'course') return lang === 'ru' ? 'ур.' : 'lessons';
        if (raw.includes('item') || raw.includes('произвед') || raw.includes('шт')) return lang === 'ru' ? 'шт.' : 'items';
        if (raw.includes('page') || raw.includes('стр')) return lang === 'ru' ? 'стр.' : 'pages';
        return lang === 'ru' ? 'ед.' : 'units';
    }

    function stop(event: MouseEvent, callback: () => void): void {
        event.stopPropagation();
        callback();
    }
</script>

<div class:hero class="media-card" role="button" tabindex="0" on:click={() => onOpen(item)} on:keydown={(event) => event.key === 'Enter' && onOpen(item)}>
    <div class="media-visual">
        {#if item.cover}
            <img src={item.cover} alt="" loading="lazy" />
        {:else}
            <div class="generated-poster">
                <span>{item.collectionId}</span>
                <strong>{item.title}</strong>
            </div>
        {/if}
    </div>

    <div class="badges">
        {#if formatLabel}<span class="badge format">{formatLabel}</span>{/if}
        <span class="badge status {statusKind}">{statusLabel}</span>
        {#if (item.queueOrder || 0) > 0}
            <span class="queue-controls">
                <span class="badge queue">#{item.queueOrder}</span>
                <button title={lang === 'ru' ? 'Выше' : 'Move up'} on:click={(event) => stop(event, () => onQueueMove(item, -1))}><span use:icon={'arrow-up'}></span></button>
                <button title={lang === 'ru' ? 'Ниже' : 'Move down'} on:click={(event) => stop(event, () => onQueueMove(item, 1))}><span use:icon={'arrow-down'}></span></button>
            </span>
        {/if}
    </div>

    <div class="card-info">
        <div class="card-title">{item.title}</div>
        {#if showAuthor && item.authors.length}
            <div class="meta-links">
                {#each item.authors as author, index}
                    <button class="meta-link" on:click={(event) => stop(event, () => onAuthor(author))}>{author}</button>{#if index < item.authors.length - 1}<span>, </span>{/if}
                {/each}
            </div>
        {/if}
        {#if showSeries && item.series}
            <button class="meta-link" on:click={(event) => stop(event, () => onSeries(item.series))}>{item.series}{item.seriesIndex > 0 ? ` #${item.seriesIndex}` : ''}</button>
        {/if}
        {#if showGenre && item.genres.length}<div class="card-meta">{item.genres.join(' · ')}</div>{/if}
        {#if showRating && item.rating}<div class="rating">★ {item.rating}</div>{/if}
        {#if showProgress && (item.total > 0 || item.progress > 0)}
            <div class="progress"><span style:width={`${percent}%`}></span></div>
            <div class="progress-text">{item.progress} / {item.total || '?'} {unitLabel} · {Math.floor(percent)}%</div>
        {/if}
        {#if pace}<div class:overdue={pace.overdue} class="pace-text">{pace.overdue ? (lang === 'ru' ? 'Цель просрочена' : 'Target overdue') : `${pace.perDay} ${unitLabel}/${lang === 'ru' ? 'день' : 'day'} · ${item.targetDate}`}</div>{/if}
    </div>

    <div class="quick-actions">
        {#if statusKind !== 'finished'}
            <button title={lang === 'ru' ? 'Добавить прогресс' : 'Add progress'} on:click={(event) => stop(event, () => onIncrement(item))}><span use:icon={'plus'}></span></button>
        {/if}
        <button title={lang === 'ru' ? 'Открыть заметку' : 'Open note'} on:click={(event) => stop(event, () => onOpenFile(item))}><span use:icon={'file-text'}></span></button>
        {#if statusKind === 'active'}
            <button title={lang === 'ru' ? 'Поставить на паузу' : 'Pause'} on:click={(event) => stop(event, () => onPause(item))}><span use:icon={'pause'}></span></button>
        {/if}
        {#if statusKind !== 'finished'}
            <button title={(item.queueOrder || 0) > 0 ? (lang === 'ru' ? 'Убрать из очереди' : 'Remove from queue') : (lang === 'ru' ? 'Добавить в очередь' : 'Add to queue')} on:click={(event) => stop(event, () => onQueueToggle(item))}><span use:icon={(item.queueOrder || 0) > 0 ? 'list-x' : 'list-plus'}></span></button>
        {/if}
        {#if statusKind !== 'finished'}
            <button title={statusKind === 'active'
                ? (lang === 'ru' ? 'Продолжить' : 'Continue')
                : (lang === 'ru' ? 'Начать чтение' : 'Start')}
                on:click={(event) => stop(event, () => onStart(item))}><span use:icon={'play'}></span></button>
        {/if}
    </div>
</div>

<style>
    .media-card { position:relative; min-height:270px; overflow:hidden; border:1px solid var(--background-modifier-border); border-radius:8px; background:var(--background-secondary); cursor:pointer; transition:transform .18s ease,border-color .18s ease; }
    .media-card:hover,.media-card:focus-visible { transform:translateY(-3px); border-color:var(--interactive-accent); }
    .media-card.hero { min-height:260px; }
    .media-visual { position:absolute; inset:0; }
    .media-visual img { width:100%; height:100%; object-fit:cover; }
    .media-visual::after { content:""; position:absolute; inset:0; background:linear-gradient(to top,rgba(10,10,14,.97) 0%,rgba(10,10,14,.32) 72%); }
    .generated-poster { height:100%; display:flex; flex-direction:column; justify-content:flex-start; gap:10px; padding:54px 22px 130px; background:linear-gradient(145deg,var(--background-secondary-alt),var(--background-primary-alt)); color:var(--text-normal); }
    .generated-poster span { font-size:.7rem; text-transform:uppercase; color:var(--text-accent); }
    .generated-poster strong { display:-webkit-box; overflow:hidden; font-size:1.15rem; line-height:1.25; overflow-wrap:anywhere; opacity:.45; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
    .badges { position:absolute; top:9px; left:9px; right:9px; display:flex; gap:6px; flex-wrap:wrap; }
    .badge { padding:3px 7px; border-radius:4px; font-size:.65rem; font-weight:700; background:rgba(15,15,20,.82); color:#fff; }
    .badge.format { color:#bcd7ff; }
    .badge.status.active { background:var(--interactive-accent); }
    .badge.status.paused { background:var(--color-orange); color:#181818; }
    .badge.status.finished { background:var(--color-green); color:#101510; }
    .badge.queue { background:rgba(15,15,20,.82); color:#ffd36a; }
    .queue-controls { display:flex; align-items:center; gap:2px; margin-left:auto; }
    .queue-controls button { width:22px; height:22px; padding:3px; border-radius:4px; background:rgba(15,15,20,.82); color:#fff; }
    .queue-controls button span { display:block; width:14px; height:14px; }
    .card-info { position:absolute; left:0; right:0; bottom:0; z-index:1; padding:44px 11px 42px; color:#fff; }
    .card-title { margin-bottom:4px; font-size:.95rem; font-weight:700; line-height:1.25; overflow-wrap:anywhere; }
    .meta-link { display:block; max-width:100%; height:auto; padding:0; border:0; box-shadow:none; background:transparent; color:#d4d4dc; font-size:.75rem; line-height:1.35; text-align:left; white-space:normal; overflow-wrap:anywhere; }
    .meta-link:hover { color:#fff; text-decoration:underline; background:transparent; }
    .meta-links { display:-webkit-box; overflow:hidden; color:#d4d4dc; font-size:.75rem; line-height:1.35; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
    .meta-links .meta-link { display:inline; }
    .card-meta,.rating,.progress-text,.pace-text { font-size:.7rem; color:#c7c7cf; }
    .card-meta { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .rating { color:#ffd36a; margin-top:2px; }
    .progress { height:4px; margin-top:7px; overflow:hidden; border-radius:2px; background:rgba(255,255,255,.2); }
    .progress span { display:block; height:100%; background:var(--interactive-accent); }
    .progress-text { margin-top:3px; }
    .pace-text { margin-top:3px; color:#a8d5ff; }
    .pace-text.overdue { color:#ff9b9b; }
    .quick-actions { position:absolute; right:8px; bottom:8px; z-index:2; display:flex; gap:4px; opacity:0; transform:translateY(4px); transition:opacity .15s ease,transform .15s ease; }
    .media-card:hover .quick-actions,.media-card:focus-within .quick-actions { opacity:1; transform:none; }
    .quick-actions button { width:28px; height:28px; padding:5px; border-radius:4px; background:rgba(20,20,24,.9); color:#fff; }
    .quick-actions span { display:block; width:16px; height:16px; }
</style>
