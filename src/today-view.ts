import { ItemView, moment, Notice, setIcon, type EventRef, type WorkspaceLeaf } from 'obsidian';
import type HabitTimerPlugin from './main';
import type { HabitDayState, HabitProperty } from './types';
import type { MediaItem } from './store/StateManager';
import type { ProjectScopeDefinition, ProjectTask } from './projects/types';
import { getHabitDeferredBonus, getHabitValueFromFrontmatter, getHabitWeeklyValue } from './services/habit-service';
import { evaluateHabitState, getHabitGoals, readHabitExplicitState } from './habits/goals';
import { isDone } from './utils/status';
import { MediaInteractionModal } from './media-modals';
import { VIEW_TYPE_TIMER } from './timer/timer-view';
import {
    collectionDailyGoal,
    collectionDailyGoalEnabled,
    collectionDailyGoalUnit,
    dailyGoalUnitLabel
} from './library/daily-goals';
import { mediaProgressForDate } from './library/daily-media-progress';

export const VIEW_TYPE_TODAY = 'habit-today-view';

interface HabitEntry {
    property: HabitProperty;
    value: number;
    desired: number;
    state: HabitDayState;
}

interface TaskEntry {
    task: ProjectTask;
    scope: ProjectScopeDefinition;
    overdue: boolean;
}

interface DailyMediaEntry {
    item: MediaItem;
    goalEnabled: boolean;
    value: number;
    goal: number;
    unitLabel: string;
}

export class TodayView extends ItemView {
    private rootEl: HTMLElement | null = null;
    private mediaItems: MediaItem[] = [];
    private unsubscribeMedia: (() => void) | null = null;
    private metadataRef: EventRef | null = null;
    private refreshTimeout: number | null = null;
    private clockInterval: number | null = null;
    private renderVersion = 0;
    private renderedTimerKey = '';

    constructor(leaf: WorkspaceLeaf, private plugin: HabitTimerPlugin) {
        super(leaf);
    }

    getViewType(): string { return VIEW_TYPE_TODAY; }
    getDisplayText(): string { return this.plugin.settings.language === 'ru' ? 'Сегодня' : 'Today'; }
    getIcon(): string { return 'calendar-check-2'; }

    async onOpen(): Promise<void> {
        this.rootEl = this.containerEl.children[1] as HTMLElement;
        this.rootEl.empty();
        this.rootEl.addClass('ht-today-native');

        this.unsubscribeMedia = this.plugin.stateManager.mediaItems.subscribe(items => {
            this.mediaItems = items;
            this.scheduleRefresh();
        });
        this.metadataRef = this.app.metadataCache.on('changed', () => this.scheduleRefresh());
        this.clockInterval = window.setInterval(() => this.updateClock(), 1000);
        await this.refresh();
    }

    async onClose(): Promise<void> {
        this.unsubscribeMedia?.();
        this.unsubscribeMedia = null;
        if (this.metadataRef) this.app.metadataCache.offref(this.metadataRef);
        this.metadataRef = null;
        if (this.refreshTimeout !== null) window.clearTimeout(this.refreshTimeout);
        if (this.clockInterval !== null) window.clearInterval(this.clockInterval);
        this.refreshTimeout = null;
        this.clockInterval = null;
        this.rootEl = null;
    }

    private scheduleRefresh(): void {
        if (!this.rootEl) return;
        if (this.refreshTimeout !== null) window.clearTimeout(this.refreshTimeout);
        this.refreshTimeout = window.setTimeout(() => {
            this.refreshTimeout = null;
            void this.refresh();
        }, 160);
    }

    private async refresh(): Promise<void> {
        const root = this.rootEl;
        if (!root) return;
        const version = ++this.renderVersion;
        const scrollTop = root.scrollTop;

        try {
            const today = moment().format('YYYY-MM-DD');
            const dailyNote = this.plugin.getDailyNote(today);
            const frontmatter = dailyNote
                ? (this.app.metadataCache.getFileCache(dailyNote)?.frontmatter || {}) as Record<string, unknown>
                : {};

            const habits = this.plugin.settings.properties
                .filter(property => (property.createdAt || '0000-00-00') <= today)
                .map(property => this.buildHabitEntry(property, frontmatter, today));

            const taskEntries: TaskEntry[] = [];
            for (const scope of this.plugin.settings.projectScopes) {
                try {
                    const tasks = await this.plugin.projectEngine.loadTasks(scope);
                    tasks
                        .filter(task => !isDone(task.status || '') && Boolean(task.endDate) && task.endDate! <= today)
                        .forEach(task => taskEntries.push({ task, scope, overdue: task.endDate! < today }));
                } catch (error) {
                    console.warn(`Today view skipped scope ${scope.name}:`, error);
                }
            }

            if (!this.rootEl || version !== this.renderVersion) return;
            const dueTasks = taskEntries
                .filter(entry => !entry.overdue)
                .sort((a, b) => this.priorityRank(a.task.priority) - this.priorityRank(b.task.priority));
            const overdueTasks = taskEntries
                .filter(entry => entry.overdue)
                .sort((a, b) => (a.task.endDate || '').localeCompare(b.task.endDate || ''));
            const media = await Promise.all(this.activeMedia().map(item => this.buildDailyMediaEntry(item, today)));

            root.empty();
            this.renderHeader(root, today);
            this.renderActiveTimer(root);
            this.renderSummary(root, habits, dueTasks, overdueTasks, media);

            const content = root.createDiv('ht-today-content');
            this.renderHabits(content, habits);
            this.renderTasks(content, dueTasks, overdueTasks);
            this.renderMedia(content, media);
            root.scrollTop = scrollTop;
        } catch (error) {
            console.error('Could not render Today view:', error);
            root.empty();
            const errorEl = root.createDiv('ht-today-error');
            this.addIcon(errorEl, 'circle-alert');
            errorEl.createEl('strong', { text: this.ru('Не удалось загрузить экран «Сегодня»', 'Could not load Today') });
            errorEl.createEl('span', { text: error instanceof Error ? error.message : String(error) });
            this.iconButton(errorEl, 'refresh-cw', this.ru('Повторить', 'Retry'), () => void this.refresh(), true);
        }
    }

    private buildHabitEntry(
        property: HabitProperty,
        frontmatter: Record<string, unknown>,
        today: string
    ): HabitEntry {
        const value = getHabitValueFromFrontmatter(frontmatter, property);
        const deferred = getHabitDeferredBonus(
            this.app,
            this.plugin.settings.dailyNotesFolder,
            property,
            today
        );
        const goals = getHabitGoals(property, today, deferred);
        const aggregate = goals.mode === 'weekly'
            ? getHabitWeeklyValue(this.app, this.plugin.settings.dailyNotesFolder, property, today)
            : undefined;
        return {
            property,
            value,
            desired: goals.desired,
            state: evaluateHabitState(
                property,
                value,
                today,
                readHabitExplicitState(frontmatter, property.name),
                aggregate,
                deferred,
                today
            )
        };
    }

    private renderHeader(root: HTMLElement, today: string): void {
        const header = root.createEl('header', { cls: 'ht-today-header' });
        const title = header.createDiv('ht-today-title');
        title.createEl('span', { text: moment(today).format('dddd') });
        title.createEl('h1', { text: this.ru('Сегодня', 'Today') });
        title.createEl('time', { text: moment(today).format('D MMMM YYYY') });
        this.iconButton(header, 'refresh-cw', this.ru('Обновить', 'Refresh'), () => void this.refresh());
    }

    private renderActiveTimer(root: HTMLElement): void {
        const active = this.plugin.settings.activeTimer;
        this.renderedTimerKey = active
            ? `${active.habitName}|${active.bookPath || ''}|${active.taskName || ''}|${active.timerState || ''}`
            : '';
        if (!active) return;

        const panel = root.createDiv('ht-today-active');
        this.makeClickable(panel, () => void this.plugin.activateView(VIEW_TYPE_TIMER));
        const icon = panel.createDiv('ht-today-active-icon');
        this.addIcon(icon, active.timerState === 'paused' ? 'pause' : 'timer');
        const copy = panel.createDiv('ht-today-active-copy');
        copy.createEl('span', {
            text: active.timerState === 'paused'
                ? this.ru('На паузе', 'Paused')
                : this.ru('Активный таймер', 'Active timer')
        });
        copy.createEl('strong', { text: active.habitName });
        const context = active.taskName || active.bookPath?.split('/').pop()?.replace(/\.md$/, '');
        if (context) copy.createEl('small', { text: context });
        panel.createEl('time', {
            cls: 'ht-today-active-time',
            text: this.plugin.formatTime(this.activeElapsed())
        });
        this.iconButton(panel, 'arrow-right', this.ru('Открыть таймер', 'Open timer'), event => {
            event.stopPropagation();
            void this.plugin.activateView(VIEW_TYPE_TIMER);
        });
    }

    private renderSummary(
        root: HTMLElement,
        habits: HabitEntry[],
        dueTasks: TaskEntry[],
        overdueTasks: TaskEntry[],
        media: DailyMediaEntry[]
    ): void {
        const summary = root.createDiv('ht-today-summary');
        const completed = habits.filter(item => ['completed', 'excused', 'deferred'].includes(item.state)).length;
        this.summaryButton(summary, `${completed}/${habits.length}`, this.ru('привычек', 'habits'), 'ht-today-habits');
        this.summaryButton(summary, String(dueTasks.length), this.ru('срок сегодня', 'due today'), 'ht-today-tasks');
        this.summaryButton(summary, String(overdueTasks.length), this.ru('перенесено', 'overdue'), 'ht-today-tasks', overdueTasks.length > 0);
        this.summaryButton(summary, String(media.length), this.ru('в процессе', 'in progress'), 'ht-today-media');
    }

    private summaryButton(
        parent: HTMLElement,
        value: string,
        label: string,
        targetId: string,
        attention = false
    ): void {
        const button = parent.createEl('button', { cls: `ht-today-metric${attention ? ' is-attention' : ''}` });
        button.type = 'button';
        button.createEl('strong', { text: value });
        button.createEl('span', { text: label });
        button.onclick = () => this.rootEl?.querySelector<HTMLElement>(`#${targetId}`)?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }

    private renderHabits(parent: HTMLElement, habits: HabitEntry[]): void {
        const section = parent.createEl('section', { cls: 'ht-today-section', attr: { id: 'ht-today-habits' } });
        this.sectionTitle(section, 'repeat-2', this.ru('Привычки', 'Habits'), habits.length);
        const list = section.createDiv('ht-today-list');
        if (!habits.length) {
            this.emptyState(list, 'calendar-x-2', this.ru('Нет привычек на сегодня', 'No habits today'));
            return;
        }

        habits.forEach(entry => {
            const row = list.createDiv(`ht-today-row state-${entry.state}`);
            this.makeClickable(row, () => void this.runHabit(entry));
            row.createSpan({ cls: 'ht-today-state-dot' });
            const body = row.createDiv('ht-today-row-body');
            body.createEl('strong', { text: entry.property.name });
            body.createEl('span', { text: this.formatHabit(entry) });
            const progress = body.createDiv('ht-today-progress');
            const fill = progress.createSpan();
            fill.setCssProps({ '--ht-today-progress': `${Math.min(100, Math.round(entry.value / Math.max(1, entry.desired) * 100))}%` });
            row.createEl('span', { cls: 'ht-today-state-label', text: this.stateLabel(entry.state) });
            this.iconButton(row, this.habitActionIcon(entry.property), this.habitActionTitle(entry.property), event => {
                event.stopPropagation();
                void this.runHabit(entry);
            }, true);
        });
    }

    private renderTasks(parent: HTMLElement, dueTasks: TaskEntry[], overdueTasks: TaskEntry[]): void {
        const section = parent.createEl('section', { cls: 'ht-today-section', attr: { id: 'ht-today-tasks' } });
        this.sectionTitle(section, 'calendar-clock', this.ru('Задачи', 'Tasks'), dueTasks.length + overdueTasks.length);
        const list = section.createDiv('ht-today-list');
        if (!dueTasks.length && !overdueTasks.length) {
            this.emptyState(list, 'list-checks', this.ru('Нет срочных задач', 'No urgent tasks'));
            return;
        }

        if (overdueTasks.length) {
            list.createEl('h3', { text: this.ru('Перенесённые', 'Overdue') });
            overdueTasks.forEach(entry => this.renderTaskRow(list, entry));
        }
        if (dueTasks.length) {
            list.createEl('h3', { text: this.ru('Срок сегодня', 'Due today') });
            dueTasks.forEach(entry => this.renderTaskRow(list, entry));
        }
    }

    private renderTaskRow(parent: HTMLElement, entry: TaskEntry): void {
        const row = parent.createDiv(`ht-today-row${entry.overdue ? ' is-overdue' : ''}`);
        this.makeClickable(row, () => void this.runTask(entry));
        const icon = row.createDiv('ht-today-row-icon');
        this.addIcon(icon, entry.overdue ? 'triangle-alert' : 'circle-dot');
        const body = row.createDiv('ht-today-row-body');
        body.createEl('strong', { text: entry.task.name });
        body.createEl('span', {
            text: [entry.scope.name, entry.task.endDate, entry.task.priority].filter(Boolean).join(' · ')
        });
        this.iconButton(
            row,
            entry.task.habitName ? 'play' : 'file-text',
            entry.task.habitName ? this.ru('Запустить', 'Start') : this.ru('Открыть', 'Open'),
            event => {
                event.stopPropagation();
                void this.runTask(entry);
            },
            Boolean(entry.task.habitName)
        );
    }

    private renderMedia(parent: HTMLElement, media: DailyMediaEntry[]): void {
        const section = parent.createEl('section', {
            cls: 'ht-today-section ht-today-media-section',
            attr: { id: 'ht-today-media' }
        });
        this.sectionTitle(section, 'library', this.ru('Сейчас в процессе', 'In progress'), media.length);
        const grid = section.createDiv('ht-today-media-grid');
        if (!media.length) {
            this.emptyState(grid, 'book-open', this.ru('Нет активных произведений', 'No active media'));
            return;
        }

        media.forEach(entry => {
            const { item } = entry;
            const card = grid.createDiv('ht-today-media-card');
            this.makeClickable(card, () => new MediaInteractionModal(this.app, this.plugin, item).open());
            if (item.cover) card.createEl('img', { attr: { src: item.cover, alt: '' } });
            else {
                const placeholder = card.createDiv('ht-today-cover-placeholder');
                this.addIcon(placeholder, 'book-open');
            }
            const body = card.createDiv('ht-today-media-copy');
            body.createEl('span', { text: item.collectionId });
            body.createEl('strong', { text: item.title });
            if (entry.goalEnabled) {
                body.createEl('small', {
                    text: `${this.ru('Сегодня', 'Today')}: ${entry.value} / ${entry.goal} ${entry.unitLabel}`
                });
                const progress = body.createDiv('ht-today-progress');
                const fill = progress.createSpan();
                fill.setCssProps({
                    '--ht-today-progress': `${Math.min(100, Math.round(entry.value / Math.max(1, entry.goal) * 100))}%`
                });
            } else {
                body.createEl('small', { text: this.ru('Без дневной нормы', 'No daily goal') });
            }
            this.iconButton(card, 'panel-right-open', this.ru('Открыть произведение', 'Open media'), event => {
                event.stopPropagation();
                new MediaInteractionModal(this.app, this.plugin, item).open();
            });
            this.iconButton(card, 'play', this.ru('Продолжить', 'Continue'), event => {
                event.stopPropagation();
                void this.runMedia(item);
            }, true);
        });
    }

    private sectionTitle(parent: HTMLElement, iconName: string, title: string, count: number): void {
        const header = parent.createDiv('ht-today-section-title');
        this.addIcon(header, iconName);
        header.createEl('h2', { text: title });
        header.createEl('span', { text: String(count) });
    }

    private emptyState(parent: HTMLElement, iconName: string, text: string): void {
        const empty = parent.createDiv('ht-today-empty');
        this.addIcon(empty, iconName);
        empty.createEl('span', { text });
    }

    private iconButton(
        parent: HTMLElement,
        iconName: string,
        title: string,
        handler: (event: MouseEvent) => void,
        primary = false
    ): HTMLButtonElement {
        const button = parent.createEl('button', {
            cls: `ht-today-icon-button${primary ? ' is-primary' : ''}`,
            attr: { 'aria-label': title, title }
        });
        button.type = 'button';
        this.addIcon(button, iconName);
        button.onclick = handler;
        return button;
    }

    private addIcon(parent: HTMLElement, iconName: string): void {
        const icon = parent.createSpan('ht-today-lucide');
        setIcon(icon, iconName);
    }

    private makeClickable(element: HTMLElement, handler: () => void): void {
        element.addClass('is-clickable');
        element.tabIndex = 0;
        element.setAttribute('role', 'button');
        element.onclick = handler;
        element.onkeydown = event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            handler();
        };
    }

    private async runHabit(entry: HabitEntry): Promise<void> {
        await this.runAction(async () => {
            const type = entry.property.type || 'timer';
            if (type === 'timer') await this.plugin.startTimerForHabit(entry.property.name);
            else if (type === 'binary') await this.plugin.toggleBinaryHabit(entry.property.name, moment().format('YYYY-MM-DD'));
            else if (type === 'count') await this.plugin.updateCountHabit(entry.property.name, 1, moment().format('YYYY-MM-DD'));
            else await this.plugin.logRelapse(entry.property.name, moment().format('YYYY-MM-DD'));
        });
    }

    private async runMedia(item: MediaItem): Promise<void> {
        await this.runAction(() => this.plugin.startTimerForMedia(item));
    }

    private async runTask(entry: TaskEntry): Promise<void> {
        await this.runAction(async () => {
            const habit = this.plugin.settings.properties.find(value => value.name === entry.task.habitName);
            if (!habit || (habit.type || 'timer') !== 'timer') {
                await this.app.workspace.getLeaf(false).openFile(entry.task.file);
                return;
            }
            await this.plugin.startTimerForHabit(habit.name, {
                taskFile: entry.task.file,
                taskName: entry.task.name,
                isSingleFileTask: entry.scope.sourceType === 'file'
            });
        });
    }

    private async runAction(action: () => void | boolean | Promise<void | boolean>): Promise<void> {
        try {
            await action();
            this.scheduleRefresh();
        } catch (error) {
            console.error('Today action failed:', error);
            new Notice(`${this.ru('Действие не выполнено', 'Action failed')}: ${
                error instanceof Error ? error.message : String(error)
            }`, 7000);
        }
    }

    private activeMedia(): MediaItem[] {
        return this.mediaItems.filter(item => {
            const collection = this.plugin.settings.mediaCollections.find(value =>
                value.id.trim().toLocaleLowerCase() === item.collectionId.trim().toLocaleLowerCase()
            );
            return Boolean(collection?.readingStatusName)
                && item.status.trim().toLocaleLowerCase() === collection!.readingStatusName.trim().toLocaleLowerCase();
        });
    }

    private async buildDailyMediaEntry(item: MediaItem, today: string): Promise<DailyMediaEntry> {
        const collection = this.plugin.settings.mediaCollections.find(value =>
            value.id.trim().toLocaleLowerCase() === item.collectionId.trim().toLocaleLowerCase()
        );
        if (!collection) {
            return { item, goalEnabled: false, value: 0, goal: 1, unitLabel: this.ru('единиц', 'units') };
        }

        const goalEnabled = collectionDailyGoalEnabled(collection);
        const goal = collectionDailyGoal(collection, this.plugin.settings.dailyPagesGoal);
        const unit = collectionDailyGoalUnit(collection);
        let value = 0;
        if (!goalEnabled) {
            value = 0;
        } else if (unit === 'items') {
            value = item.status === collection.finishedStatusName && item.endDate?.slice(0, 10) === today ? 1 : 0;
        } else {
            try {
                value = mediaProgressForDate(await this.app.vault.cachedRead(item.file), today);
            } catch (error) {
                console.warn(`Could not read daily progress for ${item.file.path}:`, error);
            }
        }
        return {
            item,
            goalEnabled,
            value,
            goal,
            unitLabel: dailyGoalUnitLabel(unit, this.plugin.settings.language)
        };
    }

    private updateClock(): void {
        if (!this.rootEl) return;
        const active = this.plugin.settings.activeTimer;
        const nextKey = active
            ? `${active.habitName}|${active.bookPath || ''}|${active.taskName || ''}|${active.timerState || ''}`
            : '';
        if (nextKey !== this.renderedTimerKey) {
            this.scheduleRefresh();
            return;
        }
        const time = this.rootEl.querySelector<HTMLElement>('.ht-today-active-time');
        if (time && active) time.setText(this.plugin.formatTime(this.activeElapsed()));
    }

    private activeElapsed(): number {
        const active = this.plugin.settings.activeTimer;
        if (!active) return 0;
        return Math.max(0, active.elapsedSeconds || 0) + (
            active.timerState === 'running' && active.lastStartedAt
                ? Math.max(0, Math.floor((Date.now() - active.lastStartedAt) / 1000))
                : 0
        );
    }

    private formatHabit(entry: HabitEntry): string {
        return (entry.property.type || 'timer') === 'timer'
            ? `${this.plugin.formatTime(entry.value)} / ${this.plugin.formatTime(entry.desired)}`
            : `${entry.value} / ${entry.desired}`;
    }

    private priorityRank(value?: string): number {
        const normalized = (value || '').toLocaleLowerCase();
        return normalized === 'high' ? 0 : normalized === 'medium' ? 1 : normalized === 'low' ? 2 : 3;
    }

    private stateLabel(state: HabitDayState): string {
        const ru: Record<HabitDayState, string> = {
            completed: 'Выполнено',
            partial: 'Частично',
            pending: 'Осталось',
            missed: 'Пропущено',
            skipped: 'Пропущено',
            excused: 'Уважительный пропуск',
            deferred: 'Перенесено'
        };
        const en: Record<HabitDayState, string> = {
            completed: 'Done',
            partial: 'Partial',
            pending: 'Remaining',
            missed: 'Missed',
            skipped: 'Skipped',
            excused: 'Excused',
            deferred: 'Deferred'
        };
        return (this.plugin.settings.language === 'ru' ? ru : en)[state];
    }

    private habitActionIcon(property: HabitProperty): string {
        const type = property.type || 'timer';
        return type === 'timer' ? 'play' : type === 'binary' ? 'check' : type === 'negative' ? 'triangle-alert' : 'plus';
    }

    private habitActionTitle(property: HabitProperty): string {
        const type = property.type || 'timer';
        if (type === 'timer') return this.ru('Запустить таймер', 'Start timer');
        if (type === 'binary') return this.ru('Переключить выполнение', 'Toggle completion');
        if (type === 'negative') return this.ru('Зафиксировать срыв', 'Log relapse');
        return this.ru('Добавить один', 'Add one');
    }

    private ru(russian: string, english: string): string {
        return this.plugin.settings.language === 'ru' ? russian : english;
    }
}
