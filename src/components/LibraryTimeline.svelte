<script lang="ts">
    import { setIcon } from 'obsidian';
    import type { App } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type { Language } from '../i18n';
    import type HabitTimerPlugin from '../main';
    import type { MediaItem } from '../store/StateManager';
    import type { MediaCollectionConfig } from '../types';
    import { collectionDailyGoal, collectionDailyGoalEnabled, collectionDailyGoalUnit, dailyGoalUnitLabel } from '../library/daily-goals';

    export let items: MediaItem[] = [];
    export let app: App;
    export let plugin: HabitTimerPlugin;
    export let lang: Language = 'en';
    export let collections: MediaCollectionConfig[] = [];
    export let collectionId = 'all';

    type EventType = 'started' | 'finished' | 'progress';

    interface TimelineEvent {
        id: string;
        date: string;
        type: EventType;
        item: MediaItem;
        progress?: number;
        timeSpent?: string;
        progressStr?: string;
    }

    interface CalendarDay {
        key: string;
        weekday: string;
        day: number;
        hasEvents: boolean;
    }

    interface GoalRow {
        collectionId: string;
        value: number;
        goal: number;
        percent: number;
        unit: string;
    }

    const WEEKDAYS: Record<Language, string[]> = {
        en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
        ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
    };
    const MONTHS: Record<Language, string[]> = {
        en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
        ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
    };

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };

    let allEvents: TimelineEvent[] = [];
    let selectedDate = toDateKey(new Date());
    let selectedYear = 'all';
    let showFilters = false;
    let showStarted = true;
    let showProgress = true;
    let showFinished = true;
    let isLoading = false;
    let calculationVersion = 0;

    $: void calculateAllEvents(items);
    $: enabledTypes = new Set<EventType>([
        ...(showStarted ? ['started' as const] : []),
        ...(showProgress ? ['progress' as const] : []),
        ...(showFinished ? ['finished' as const] : [])
    ]);
    $: filteredEvents = allEvents.filter(event => enabledTypes.has(event.type)
        && (selectedYear === 'all' || event.date.startsWith(selectedYear)));
    $: dayEvents = filteredEvents.filter(event => event.date === selectedDate);
    $: goalRows = buildGoalRows(allEvents.filter(event => event.date === selectedDate));
    $: goalPercent = goalRows.length ? Math.round(goalRows.reduce((sum, row) => sum + row.percent, 0) / goalRows.length) : 0;
    $: goalDashOffset = 226.2 - 226.2 * goalPercent / 100;
    $: selectedDateObject = parseDate(selectedDate) || new Date();
    $: monthLabel = MONTHS[lang][selectedDateObject.getMonth()];
    $: dateWindow = createDateWindow(selectedDateObject, filteredEvents);
    $: availableYears = [...new Set(allEvents.map(event => event.date.slice(0, 4)))].sort((a, b) => b.localeCompare(a));

    function buildGoalRows(events: TimelineEvent[]): GoalRow[] {
        return collections
            .filter(collection =>
                collection.enabled
                && collectionDailyGoalEnabled(collection)
                && (collectionId === 'all' || collection.id === collectionId)
            )
            .map(collection => {
                const unit = collectionDailyGoalUnit(collection);
                const collectionEvents = events.filter(event => event.item.collectionId === collection.id);
                const value = unit === 'items'
                    ? collectionEvents.filter(event => event.type === 'finished' && event.item.status === collection.finishedStatusName).length
                    : collectionEvents.filter(event => event.type === 'progress')
                        .reduce((sum, event) => sum + Math.max(0, event.progress || 0), 0);
                const goal = collectionDailyGoal(collection, plugin.settings.dailyPagesGoal);
                return {
                    collectionId: collection.id,
                    value,
                    goal,
                    percent: Math.min(100, value / goal * 100),
                    unit: dailyGoalUnitLabel(unit, lang)
                };
            });
    }

    async function calculateAllEvents(source: MediaItem[]): Promise<void> {
        const version = ++calculationVersion;
        isLoading = true;
        const events: TimelineEvent[] = [];

        source.forEach(item => {
            if (item.startDate && parseDate(item.startDate)) {
                events.push({ id: `${item.file.path}-start-${item.startDate}`, date: item.startDate.slice(0, 10), type: 'started', item });
            }
            if (item.endDate && parseDate(item.endDate)) {
                events.push({ id: `${item.file.path}-finish-${item.endDate}`, date: item.endDate.slice(0, 10), type: 'finished', item });
            }
        });

        const progressGroups = await Promise.all(source.map(parseProgressEvents));
        progressGroups.forEach(group => events.push(...group));
        if (version !== calculationVersion) return;
        allEvents = events.sort((a, b) => b.date.localeCompare(a.date));
        isLoading = false;
    }

    async function parseProgressEvents(item: MediaItem): Promise<TimelineEvent[]> {
        try {
            const content = await app.vault.read(item.file);
            const tableMatch = content.match(/###\s+📖\s+(?:Progress|Журнал чтения)\s*\n([\s\S]*?)(?:\n#{1,3}\s|\n---|\n\n---|$)/i);
            if (!tableMatch?.[1]) return [];
            return tableMatch[1].split('\n')
                .filter(line => line.trim().startsWith('|') && !line.includes('---') && !line.toLowerCase().includes('date |'))
                .map((line, index) => {
                    const columns = line.split('|').map(value => value.trim()).slice(1);
                    const date = columns[0] || '';
                    if (!parseDate(date)) return null;
                    const rawProgress = columns[2] || '';
                    const progress = Number.parseFloat(rawProgress);
                    return {
                        id: `${item.file.path}-progress-${date}-${index}`,
                        date: date.slice(0, 10),
                        type: 'progress' as const,
                        item,
                        progress: Number.isFinite(progress) ? progress : undefined,
                        timeSpent: columns[1] || undefined,
                        progressStr: columns[3] || undefined
                    };
                })
                .filter((event): event is TimelineEvent => event !== null);
        } catch {
            return [];
        }
    }

    function parseDate(value: string): Date | null {
        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function toDateKey(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function createDateWindow(center: Date, events: TimelineEvent[]): CalendarDay[] {
        const eventDates = new Set(events.map(event => event.date));
        return Array.from({ length: 9 }, (_, index) => {
            const date = new Date(center);
            date.setDate(center.getDate() + index - 4);
            const key = toDateKey(date);
            return { key, weekday: WEEKDAYS[lang][date.getDay()], day: date.getDate(), hasEvents: eventDates.has(key) };
        });
    }

    function shiftDate(days: number): void {
        const date = parseDate(selectedDate) || new Date();
        date.setDate(date.getDate() + days);
        selectedDate = toDateKey(date);
        selectedYear = String(date.getFullYear());
    }

    function chooseYear(year: string): void {
        selectedYear = year;
        if (year === 'all') return;
        const latest = allEvents.find(event => event.date.startsWith(year));
        if (latest) selectedDate = latest.date;
    }

    function getUnit(item: MediaItem): string {
        const rawFormat = item.format.toLowerCase();
        if (rawFormat.includes('audio') || rawFormat.includes('аудио')) return lang === 'ru' ? 'минут' : 'minutes';
        if (['anime', 'series'].includes(item.collectionId)) return lang === 'ru' ? 'эпизодов' : 'episodes';
        if (item.collectionId === 'game') return lang === 'ru' ? 'часов' : 'hours';
        if (item.collectionId === 'course') return lang === 'ru' ? 'уроков' : 'lessons';
        return lang === 'ru' ? 'страниц' : 'pages';
    }

    function eventLabel(type: EventType): string {
        if (type === 'started') return lang === 'ru' ? 'Начато' : 'Started';
        if (type === 'finished') return lang === 'ru' ? 'Завершено' : 'Finished';
        return lang === 'ru' ? 'Прогресс' : 'Progress';
    }

    function eventIcon(type: EventType): string {
        if (type === 'started') return 'play';
        if (type === 'finished') return 'check';
        return 'book-open';
    }

    function openItem(item: MediaItem): void {
        void app.workspace.getLeaf(false).openFile(item.file);
    }
</script>

<div class="daily-timeline">
    <header class="daily-header">
        <div><h2>{lang === 'ru' ? 'Ежедневная статистика' : 'Daily statistics'}</h2><p>{lang === 'ru' ? 'Активность библиотеки за выбранный день.' : 'Library activity for the selected day.'}</p></div>
        <button class:active={showFilters} class="filter-button" title={lang === 'ru' ? 'Фильтры' : 'Filters'} on:click={() => showFilters = !showFilters}><span use:icon={'sliders-horizontal'}></span></button>
    </header>

    {#if showFilters}
        <div class="filter-panel">
            <label><input type="checkbox" bind:checked={showStarted} />{lang === 'ru' ? 'Начато' : 'Started'}</label>
            <label><input type="checkbox" bind:checked={showProgress} />{lang === 'ru' ? 'Прогресс' : 'Progress'}</label>
            <label><input type="checkbox" bind:checked={showFinished} />{lang === 'ru' ? 'Завершено' : 'Finished'}</label>
            <select value={selectedYear} on:change={(event) => chooseYear(event.currentTarget.value)} aria-label={lang === 'ru' ? 'Год' : 'Year'}>
                <option value="all">{lang === 'ru' ? 'Все годы' : 'All years'}</option>
                {#each availableYears as year}<option value={year}>{year}</option>{/each}
            </select>
        </div>
    {/if}

    <section class="calendar-section">
        <div class="month-navigation">
            <button title={lang === 'ru' ? 'Предыдущая неделя' : 'Previous week'} on:click={() => shiftDate(-7)}><span use:icon={'chevron-left'}></span></button>
            <span>{monthLabel}</span>
            <button title={lang === 'ru' ? 'Следующая неделя' : 'Next week'} on:click={() => shiftDate(7)}><span use:icon={'chevron-right'}></span></button>
        </div>
        <div class="date-strip">
            {#each dateWindow as day (day.key)}
                <button class:selected={day.key === selectedDate} class:has-events={day.hasEvents} on:click={() => { selectedDate = day.key; selectedYear = day.key.slice(0, 4); }}>
                    <span>{day.weekday}</span><strong>{day.day}</strong><i></i>
                </button>
            {/each}
        </div>
    </section>

    <section class="goal-panel">
        <div class="goal-ring">
            <svg viewBox="0 0 84 84" aria-hidden="true"><circle class="ring-track" cx="42" cy="42" r="36" /><circle class="ring-value" cx="42" cy="42" r="36" stroke-dasharray="226.2" stroke-dashoffset={goalDashOffset} /></svg>
            <strong>{goalPercent}%</strong>
        </div>
        <div class="goal-rows">
            {#each goalRows as row (row.collectionId)}
                <div><span>{row.collectionId}</span><strong>{row.value} / {row.goal} {row.unit}</strong></div>
            {/each}
        </div>
    </section>

    <section class="daily-events">
        <h3>{selectedDateObject.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' })}</h3>

        {#if isLoading}
            <div class="daily-empty"><span class="spinner"></span><p>{lang === 'ru' ? 'Загрузка событий…' : 'Loading events…'}</p></div>
        {:else if !dayEvents.length}
            <div class="daily-empty"><span class="empty-icon" use:icon={'folder-open'}></span><p>{lang === 'ru' ? 'Нет записей за выбранный день.' : 'No records for the selected day.'}</p></div>
        {:else}
            <div class="event-list">
                {#each dayEvents as event (event.id)}
                    <button class="event-row" on:click={() => openItem(event.item)}>
                        <span class:finished={event.type === 'finished'} class:progress={event.type === 'progress'} class="event-icon" use:icon={eventIcon(event.type)}></span>
                        <span class="event-info"><strong>{event.item.title}</strong><small>{eventLabel(event.type)} · {event.item.collectionId}</small></span>
                        {#if event.type === 'progress'}
                            <span class="event-progress">{event.progress !== undefined ? `+${event.progress} ${getUnit(event.item)}` : ''}{event.timeSpent ? ` · ${event.timeSpent}` : ''}</span>
                        {:else}
                            <span class="event-status">{event.item.status}</span>
                        {/if}
                    </button>
                {/each}
            </div>
        {/if}
    </section>
</div>

<style>
    .daily-timeline { max-width:940px; margin:0 auto; padding:18px clamp(10px,4vw,38px) 48px; }
    .daily-header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:28px; }
    .daily-header h2 { max-width:540px; margin:0; color:var(--text-normal); font-size:clamp(1.8rem,5vw,3rem); line-height:1.08; letter-spacing:0; }
    .daily-header p { margin:10px 0 0; color:var(--text-muted); font-size:1rem; }
    .filter-button { display:flex; align-items:center; justify-content:center; flex:none; width:44px; height:44px; padding:10px; border-radius:50%; }
    .filter-button span { width:22px; height:22px; }
    .filter-button.active { background:var(--interactive-accent); color:var(--text-on-accent); }
    .filter-panel { display:flex; align-items:center; flex-wrap:wrap; gap:8px 18px; margin:-12px 0 22px; padding:11px 13px; border:1px solid var(--background-modifier-border); border-radius:8px; background:var(--background-secondary); }
    .filter-panel label { display:flex; align-items:center; gap:6px; color:var(--text-muted); font-size:.8rem; }
    .filter-panel select { height:32px; margin-left:auto; }
    .calendar-section { margin-bottom:24px; }
    .month-navigation { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:8px; color:var(--text-accent); }
    .month-navigation button { display:flex; align-items:center; justify-content:center; width:28px; height:28px; padding:6px; background:transparent; box-shadow:none; }
    .month-navigation button span { width:15px; height:15px; }
    .month-navigation > span { min-width:90px; text-align:center; font-size:.78rem; text-transform:capitalize; }
    .date-strip { display:grid; grid-template-columns:repeat(9,minmax(54px,1fr)); gap:5px; overflow-x:auto; padding:2px; }
    .date-strip button { position:relative; display:flex; flex-direction:column; align-items:center; gap:7px; min-width:54px; height:86px; margin:0; padding:8px 4px; border:1px solid transparent; border-radius:7px; background:transparent; box-shadow:none; }
    .date-strip button > span { color:var(--text-muted); font-size:.75rem; font-weight:400; }
    .date-strip button strong { display:flex; align-items:center; justify-content:center; width:38px; height:38px; border:1px solid var(--background-modifier-border); border-radius:50%; color:var(--text-muted); font-size:.95rem; font-weight:500; }
    .date-strip button.selected { background:rgba(var(--color-accent-rgb),.22); }
    .date-strip button.selected strong { border-color:var(--interactive-accent); background:var(--background-primary); color:var(--text-normal); }
    .date-strip button i { width:4px; height:4px; border-radius:50%; background:transparent; }
    .date-strip button.has-events i { background:var(--interactive-accent); }
    .goal-panel { display:grid; grid-template-columns:92px minmax(0,1fr); align-items:center; gap:22px; max-width:620px; margin:0 auto 32px; padding:18px 24px; border:1px solid var(--background-modifier-border); border-radius:8px; background:var(--background-secondary); }
    .goal-ring { position:relative; width:82px; height:82px; }
    .goal-ring svg { width:100%; height:100%; transform:rotate(-90deg); }
    .goal-ring circle { fill:none; stroke-width:4; }
    .ring-track { stroke:var(--background-modifier-border); }
    .ring-value { stroke:var(--interactive-accent); stroke-linecap:round; transition:stroke-dashoffset .3s ease; }
    .goal-ring strong { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:1.35rem; }
    .goal-rows { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:8px; }
    .goal-rows > div { display:flex; flex-direction:column; gap:3px; padding:7px 9px; border-left:2px solid var(--interactive-accent); background:var(--background-primary); }
    .goal-rows span { color:var(--text-muted); font-size:.7rem; text-transform:capitalize; }
    .goal-rows strong { color:var(--text-accent); font-size:.9rem; line-height:1.3; }
    .daily-events h3 { margin:0 0 14px; color:var(--text-normal); font-size:1.25rem; font-weight:600; }
    .daily-empty { display:flex; min-height:220px; flex-direction:column; align-items:center; justify-content:center; gap:18px; color:var(--text-muted); text-align:center; }
    .empty-icon { width:58px; height:58px; color:var(--text-faint); }
    .daily-empty p { margin:0; }
    .spinner { width:24px; height:24px; border:2px solid var(--background-modifier-border); border-top-color:var(--interactive-accent); border-radius:50%; animation:spin .8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .event-list { border-top:1px solid var(--background-modifier-border); }
    .event-row { display:grid; grid-template-columns:34px minmax(150px,1fr) auto; align-items:center; gap:12px; width:100%; min-height:62px; margin:0; padding:9px 5px; border:0; border-bottom:1px solid var(--background-modifier-border); border-radius:0; background:transparent; box-shadow:none; text-align:left; }
    .event-row:hover { background:var(--background-modifier-hover); }
    .event-icon { display:flex; align-items:center; justify-content:center; width:30px; height:30px; padding:7px; border-radius:50%; background:rgba(var(--color-accent-rgb),.14); color:var(--interactive-accent); }
    .event-icon.finished { background:rgba(var(--color-green-rgb),.14); color:var(--color-green); }
    .event-icon.progress { background:var(--background-modifier-form-field); color:var(--text-muted); }
    .event-info { display:flex; flex-direction:column; gap:3px; min-width:0; }
    .event-info strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .event-info small { color:var(--text-muted); text-transform:capitalize; }
    .event-progress { color:var(--text-accent); font-size:.78rem; white-space:nowrap; }
    .event-status { padding:3px 7px; border-radius:4px; background:var(--background-modifier-form-field); color:var(--text-muted); font-size:.7rem; }
    @media (max-width:700px) {
        .daily-timeline { padding-top:8px; }
        .date-strip { grid-template-columns:repeat(9,54px); }
        .goal-panel { margin-left:0; margin-right:0; }
    }
    @media (max-width:460px) {
        .daily-header h2 { font-size:2rem; }
        .goal-panel { grid-template-columns:72px 1fr; padding:15px; gap:15px; }
        .goal-ring { width:68px; height:68px; }
        .goal-rows { grid-template-columns:1fr; }
        .event-row { grid-template-columns:32px minmax(100px,1fr); }
        .event-progress,.event-status { grid-column:2; justify-self:start; }
        .filter-panel select { width:100%; margin-left:0; }
    }
</style>
