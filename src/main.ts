import { Plugin, WorkspaceLeaf, Notice, moment, TFile, Platform } from 'obsidian';
import { StatsView, VIEW_TYPE_STATS } from './stats-view';
import { LibraryView, VIEW_TYPE_LIBRARY } from './library-view';
import { ProjectsView, VIEW_TYPE_PROJECTS } from './projects-view';
import { formatDuration } from './utils';
import { t } from './i18n';
import { ProjectDataEngine } from './projects/project-data';
import { DEFAULT_SETTINGS } from './types';
import { defaultDailyGoal, defaultDailyGoalUnit } from './library/daily-goals';
import type { HabitTimerSettings } from './types';
import { normalizeAliases } from './library/property-schema';
import { TimerView, VIEW_TYPE_TIMER } from './timer/timer-view';
import { HabitTimerSettingTab } from './settings/settings-tab';
import { TelegramService } from './services/telegram-service';
import { calculateHabitStreak } from './services/habit-service';
import { DailyNoteService } from './services/daily-note-service';
import { CloudflareCompanionService } from './services/cloudflare-companion-service';
import { WidgetDashboardView, VIEW_TYPE_WIDGETS } from './widgets/widget-dashboard-view';
import { WorkspaceOverview, VIEW_TYPE_OVERVIEW } from './workspace-overview';
const VIEW_TYPE_TODAY = 'habit-today-view';
import { TasksService } from './tasks/service';
import { TasksView, VIEW_TYPE_TASKS } from './tasks/view';
import { withWorkspaceNavigation, WORKSPACE_SECTIONS } from './workspace-navigation';
import { migrateLegacySettings, migrateMediaFrontmatter } from './migration';
import { StateManager } from './store/StateManager';
import type { MediaItem } from './store/StateManager';
import { isDone, isInProgress } from './utils/status';
import type { HabitExplicitState } from './types';
import { habitForCollection } from './library/habit-links';
import { DashboardApiBridge } from './integration/dashboard-api';
import { ensureHabitPropertyIds } from './integration/habit-id';
import { TimerSessionService } from './timer/timer-session-service';
import type { FinishTimerInput, FinishTimerRequirements } from './integration/dashboard-api-contract';


export default class HabitTimerPlugin extends Plugin {
    settings: HabitTimerSettings;
    statusBarItem: HTMLElement;
    telegram: TelegramService;
    dailyNotes: DailyNoteService;
    tasks: TasksService;
    companion: CloudflareCompanionService;
    stateManager: StateManager;
    /** Shared engine instance — preserves file-level cache across calls. */
    projectEngine: ProjectDataEngine;
    timerSessions: TimerSessionService;
    dashboardApiBridge: DashboardApiBridge;
    private currentThemeClass: string = '';


    async onload() {
        await this.loadSettings();
        this.applyTheme(this.settings.theme);

        this.telegram = new TelegramService(this);
        this.dailyNotes = new DailyNoteService(this.app, this);
        this.tasks = new TasksService(this);
        await this.dailyNotes.normalizeSessionLog();
        this.companion = new CloudflareCompanionService(this);
        this.stateManager = new StateManager(this.app, this);
        this.projectEngine = new ProjectDataEngine(this.app, this);
        this.timerSessions = new TimerSessionService(this);
        this.dashboardApiBridge = new DashboardApiBridge(this);
        this.dashboardApiBridge.start();


        this.statusBarItem = this.addStatusBarItem();
        this.updateStatusBar(0);

        this.addSettingTab(new HabitTimerSettingTab(this.app, this));

        this.registerView(VIEW_TYPE_TIMER, (leaf) => withWorkspaceNavigation(new TimerView(leaf, this), this));
        this.registerView(VIEW_TYPE_STATS, (leaf) => withWorkspaceNavigation(new StatsView(leaf, this), this));
        this.registerView(VIEW_TYPE_LIBRARY, (leaf) => withWorkspaceNavigation(new LibraryView(leaf, this), this));
        this.registerView(VIEW_TYPE_PROJECTS, (leaf) => withWorkspaceNavigation(new ProjectsView(leaf, this), this));
        this.registerView(VIEW_TYPE_WIDGETS, (leaf) => withWorkspaceNavigation(new WidgetDashboardView(leaf, this), this));
        this.registerView(VIEW_TYPE_OVERVIEW, (leaf) => withWorkspaceNavigation(new WorkspaceOverview(leaf, this), this));
        this.registerView(VIEW_TYPE_TASKS, leaf => withWorkspaceNavigation(new TasksView(leaf, this), this));
        this.addCommand({id:'open-standalone-tasks',name:'Задания',callback:()=>this.activateView(VIEW_TYPE_TASKS)});
        this.app.workspace.onLayoutReady(() => {
            void this.tasks.list().catch(error=>console.error('Task registry update failed',error));
            this.registerInterval(window.setInterval(()=>{void this.tasks.list().catch(error=>console.error('Task daily projection failed',error));},60000));
            for(const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TODAY))void leaf.setViewState({type:VIEW_TYPE_OVERVIEW,active:false});
            void this.refreshStaleInteractiveViews();
            this.companion.start();
        });

        this.addRibbonIcon('layers', 'Focus Library', () => this.openFocusWindow());
        this.addCommand({id:'open-focus-workspace',name:'Focus Library: главное окно',callback:()=>this.openFocusWindow()});
        
        this.addCommand({
            id: 'open-today-dashboard',
            name: this.settings.language === 'ru' ? 'Открыть обзор Focus Library' : 'Open Focus Library overview',
            callback: () => this.activateView(VIEW_TYPE_OVERVIEW, true)
        });

        this.addCommand({
            id: 'open-library',
            name: 'Open Library',
            callback: () => this.activateView(VIEW_TYPE_LIBRARY)
        });

        this.addCommand({
            id: 'sync-cloudflare-companion',
            name: 'Telegram: Sync Cloudflare companion',
            callback: async () => {
                const ok = await this.companion.sync();
                new Notice(ok ? 'Cloudflare Companion synchronized.' : 'Cloudflare Companion sync failed.');
            }
        });

        this.addCommand({
            id: 'setup-cloudflare-webhook',
            name: 'Telegram: Configure Cloudflare webhook',
            callback: async () => {
                const result = await this.companion.setupWebhook();
                new Notice(result.ok ? `Webhook configured: ${result.message}` : `Webhook setup failed: ${result.message}`, 8000);
            }
        });

        this.addCommand({
            id: 'send-telegram-morning',
            name: 'Telegram: Send Morning Plan Briefing',
            callback: async () => {
                const msg = await this.telegram.generateMorningBriefing();
                const ok = await this.telegram.send(msg);
                if (ok) {
                    this.settings.telegramLastMorningDate = moment().format("YYYY-MM-DD");
                    await this.saveSettings();
                    new Notice("Morning Plan sent to Telegram!");
                } else { new Notice("Failed to send Morning Plan."); }
            }
        });

        this.addCommand({
            id: 'send-telegram-evening',
            name: 'Telegram: Send Evening Summary Report',
            callback: async () => {
                const msg = await this.telegram.generateEveningSummary();
                const ok = await this.telegram.send(msg);
                if (ok) {
                    this.settings.telegramLastEveningDate = moment().format("YYYY-MM-DD");
                    await this.saveSettings();
                    new Notice("Evening Summary sent to Telegram!");
                } else { new Notice("Failed to send Evening Summary."); }
            }
        });

        this.addCommand({
            id: 'update-daily-project-log',
            name: 'Update Daily Note Project Log',
            callback: async () => {
                const todayStr = moment().format("YYYY-MM-DD");
                await this.dailyNotes.updateProjectLog(todayStr);
                new Notice("Daily note project log updated!");
            }
        });

        this.addCommand({
            id: 'migrate-media-frontmatter',
            name: 'Migrate Media Frontmatter (Legacy to New)',
            callback: async () => {
                await migrateMediaFrontmatter(this.app, this);
            }
        });

        // Initialize Telegram background scheduler interval
        this.telegram.startScheduler();
    }

    updateStatusBar(seconds: number) {
        this.statusBarItem.setText(`[T]: ${this.formatTime(seconds)}`);
    }

    formatTime(seconds: number): string {
        return formatDuration(seconds);
    }

    private focusLeaf: WorkspaceLeaf | null = null;
    async openFocusWindow() {
        const workspace=this.app.workspace;
        if(this.focusLeaf && WORKSPACE_SECTIONS.some(s=>workspace.getLeavesOfType(s.type).includes(this.focusLeaf!))){await workspace.revealLeaf(this.focusLeaf);return;}
        this.focusLeaf = Platform.isMobile ? workspace.getLeaf('tab') : workspace.openPopoutLeaf();
        await this.focusLeaf.setViewState({type:VIEW_TYPE_OVERVIEW,active:true});
        await workspace.revealLeaf(this.focusLeaf);
    }
    async activateView(viewType: string, mainArea = false) {
        if(viewType===VIEW_TYPE_TODAY)viewType=VIEW_TYPE_OVERVIEW;
        const { workspace } = this.app;
        const sections = new Set<string>(WORKSPACE_SECTIONS.map(section=>section.type));
        const currentLeaf = workspace.getMostRecentLeaf();
        const localLeaf = currentLeaf && sections.has(currentLeaf.view.getViewType()) && sections.has(viewType) ? currentLeaf : null;
        let leaf: WorkspaceLeaf | undefined | null = localLeaf || workspace.getLeavesOfType(viewType)[0];
        if (leaf && leaf.view.getViewType() !== viewType) await leaf.setViewState({type:viewType,active:true});
        if (leaf && this.isStaleInteractiveView(viewType, leaf)) {
            await this.recreateView(leaf, viewType);
        }
        const viewAlreadyOpen = Boolean(leaf);
        if (!leaf) {
            const sections = new Set<string>(WORKSPACE_SECTIONS.map(section=>section.type));
            const active = workspace.getMostRecentLeaf();
            leaf = sections.has(viewType)
                ? (active && sections.has(active.view.getViewType()) ? active : WORKSPACE_SECTIONS.flatMap(section=>workspace.getLeavesOfType(section.type))[0]) || workspace.getLeaf('tab')
                : mainArea ? workspace.getLeaf('tab') : workspace.getRightLeaf(false);
            if (leaf) await leaf.setViewState({ type: viewType, active: true });
        }
        if (leaf) {
            await workspace.revealLeaf(leaf);
            if (
                viewAlreadyOpen &&
                viewType === VIEW_TYPE_TIMER &&
                this.settings.activeTimer &&
                leaf.view instanceof TimerView
            ) {
                await leaf.view.recoverActiveTimer();
            }
        }
    }

    private isStaleInteractiveView(viewType: string, leaf: WorkspaceLeaf): boolean {
        if (viewType === VIEW_TYPE_OVERVIEW) return !(leaf.view instanceof WorkspaceOverview);
        if (viewType === VIEW_TYPE_TIMER) return !(leaf.view instanceof TimerView);
        return false;
    }

    private async recreateView(leaf: WorkspaceLeaf, viewType: string): Promise<void> {
        const previous = leaf.getViewState();
        await leaf.setViewState({ type: 'empty' });
        await leaf.setViewState({
            type: viewType,
            active: previous.active,
            state: previous.state
        });
    }

    private async refreshStaleInteractiveViews(): Promise<void> {
        for (const viewType of [VIEW_TYPE_OVERVIEW, VIEW_TYPE_TIMER]) {
            for (const leaf of this.app.workspace.getLeavesOfType(viewType)) {
                if (this.isStaleInteractiveView(viewType, leaf)) {
                    await this.recreateView(leaf, viewType);
                }
            }
        }
    }

    async loadSettings() {
        const loadedData = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
        const habitIdsChanged = ensureHabitPropertyIds(this.settings.properties);
        this.settings.libraryPropertyAliases = normalizeAliases(this.settings.libraryPropertyAliases);
        if (!this.settings.projectScopes) {
            this.settings.projectScopes = [];
        }
        // Auto-initialize first scope from legacy settings if none exist
        if (this.settings.projectScopes.length === 0 && (this.settings.projectsFolder || this.settings.projectsStatuses)) {
            this.settings.projectScopes.push({
                id: 'default-legacy-scope',
                name: 'Default Project',
                sourceType: 'folder',
                sourceValue: this.settings.projectsFolder || '',
                statuses: this.settings.projectsStatuses || 'Backlog, To Do, In Progress, Done',
                color: '#3b82f6'
            });
        }
        
        // Ensure any new default media collections are appended if they are missing from user settings
        if (this.settings.mediaCollections) {
            for (const dc of DEFAULT_SETTINGS.mediaCollections) {
                const existing = this.settings.mediaCollections.find(c => c.id === dc.id);
                if (!existing) {
                    this.settings.mediaCollections.push(dc);
                } else {
                    if (!existing.folder) existing.folder = dc.folder;
                    if (!existing.templatePath) existing.templatePath = dc.templatePath;
                    if (!existing.pausedStatusName) existing.pausedStatusName = dc.pausedStatusName || 'На паузе';
                    if (!existing.dailyGoal) existing.dailyGoal = existing.id === 'book'
                        ? defaultDailyGoal(existing.id, this.settings.dailyPagesGoal)
                        : dc.dailyGoal || defaultDailyGoal(existing.id, this.settings.dailyPagesGoal);
                    if (!existing.dailyGoalUnit) existing.dailyGoalUnit = dc.dailyGoalUnit || defaultDailyGoalUnit(existing.id);
                }
            }
        }
        
        await migrateLegacySettings(this, loadedData);
        if (habitIdsChanged) await this.saveData(this.settings);
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.dashboardApiBridge?.emitChanged(['timer', 'habits', 'projects', 'library', 'stats', 'settings']);
    }

    applyTheme(theme: string) {
        if (this.currentThemeClass) {
            document.body.classList.remove(this.currentThemeClass);
        }
        document.body.classList.add(theme);
        this.currentThemeClass = theme;
    }

    // --- Delegation API wrappers to preserve compatibility with other files ---

    getDailyNote(date: string): TFile | null {
        return this.dailyNotes.getNote(date);
    }

    async toggleBinaryHabit(habitName: string, date: string = moment().format('YYYY-MM-DD')) {
        return this.dailyNotes.toggleBinary(habitName, date);
    }

    async logRelapse(habitName: string, date: string = moment().format('YYYY-MM-DD')) {
        return this.dailyNotes.logRelapse(habitName, date);
    }

    async updateCountHabit(habitName: string, delta: number, date: string = moment().format('YYYY-MM-DD')) {
        return this.dailyNotes.updateCount(habitName, delta, date);
    }

    async updateTimerHabit(habitName: string, seconds: number, date: string = moment().format('YYYY-MM-DD')) {
        return this.dailyNotes.updateTimer(habitName, seconds, date);
    }

    async setHabitDayState(
        habitName: string,
        state: HabitExplicitState | null,
        date: string = moment().format('YYYY-MM-DD'),
        deferredTo?: string,
        deferredAmount = 0
    ) {
        return this.dailyNotes.setHabitState(habitName, state, date, deferredTo, deferredAmount);
    }

    async ensureHabitProperties(date: string = moment().format('YYYY-MM-DD')) {
        return this.dailyNotes.ensureProperties(date);
    }

    async updateDailyNoteProjectLog(dateStr: string = moment().format('YYYY-MM-DD')) {
        return this.dailyNotes.updateProjectLog(dateStr);
    }

    async sendTelegramMessage(text: string): Promise<boolean> {
        return this.telegram.send(text);
    }

    async getHabitStreak(habitName: string): Promise<number> {
        const prop = this.settings.properties.find(p => p.name === habitName);
        if (!prop) return 0;
        return calculateHabitStreak(this.app, this.settings.dailyNotesFolder, prop);
    }

    // --- Project tasks queries ---

    async getActiveProjectTasks(): Promise<{ name: string, status: string, scopeName: string }[]> {
        const active: { name: string, status: string, scopeName: string }[] = [];
        const todayStr = moment().format("YYYY-MM-DD");
        for (const scope of this.settings.projectScopes) {
            try {
                const tasks = await this.projectEngine.loadTasks(scope);
                for (const t of tasks) {
                    const status = t.status || '';
                    const isStartToday = t.startDate === todayStr;
                    if (!isDone(status) && (isInProgress(status) || status.toLowerCase().includes('to do') || isStartToday)) {
                        active.push({ name: t.name, status, scopeName: scope.name });
                    }
                }
            } catch (e) {
                console.error("Error loading active tasks: ", e);
            }
        }
        return active;
    }

    async getCompletedProjectTasksToday(): Promise<{ name: string, scopeName: string }[]> {
        const completed: { name: string, scopeName: string }[] = [];
        const todayStr = moment().format("YYYY-MM-DD");
        for (const scope of this.settings.projectScopes) {
            try {
                const tasks = await this.projectEngine.loadTasks(scope);
                for (const t of tasks) {
                    const status = t.status || '';
                    if (isDone(status) && t.endDate === todayStr) {
                        completed.push({ name: t.name, scopeName: scope.name });
                    }
                }
            } catch (e) {
                console.error("Error loading completed tasks: ", e);
            }
        }
        return completed;
    }

    // --- Timer control API (used by TelegramService to avoid direct view access) ---

    /**
     * Start the timer for a specific habit name.
     * Finds the active TimerView and delegates via its public engine API.
     * Returns true if the timer was started successfully.
     */
    async startTimerForHabit(
        habitName: string,
        context: {
            bookPath?: string;
            taskFile?: TFile;
            taskName?: string;
            isSingleFileTask?: boolean;
            mode?: 'timer' | 'pm';
            subTask?: string;
            openView?: boolean;
        } = {}
    ): Promise<boolean> {
        const prop = this.settings.properties.find(p => p.name === habitName);
        if (!prop) {
            new Notice(this.settings.language === 'ru'
                ? `Привычка «${habitName}» не найдена в настройках.`
                : `Habit “${habitName}” was not found in settings.`);
            return false;
        }

        if (context.openView === false) {
            return this.timerSessions.start({
                habitName,
                mode: context.mode,
                subTask: context.subTask,
                mediaPath: context.bookPath,
                taskPath: context.taskFile?.path,
                taskName: context.taskName,
                isSingleFileTask: context.isSingleFileTask
            });
        }

        if (this.settings.activeTimer) {
            await this.activateView(VIEW_TYPE_TIMER);
            const sameHabit = this.settings.activeTimer.habitName === habitName;
            const sameMedia = !context.bookPath || this.settings.activeTimer.bookPath === context.bookPath;
            const sameMode = !context.mode || this.settings.activeTimer.mode === context.mode;
            if (sameHabit && sameMedia && sameMode) return true;
            new Notice(this.settings.language === 'ru'
                ? 'Сначала завершите или сбросьте активный таймер.'
                : 'Finish or reset the active timer first.');
            return false;
        }

        if (this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMER).length === 0) await this.activateView(VIEW_TYPE_TIMER);
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMER);
        if (leaves.length === 0) {
            new Notice(this.settings.language === 'ru'
                ? 'Не удалось открыть вкладку таймера.'
                : 'Could not open the timer view.');
            return false;
        }

        const timerView = leaves[0]!.view;
        if (!(timerView instanceof TimerView)) {
            new Notice(this.settings.language === 'ru'
                ? 'Вкладка таймера устарела. Закройте её и повторите запуск.'
                : 'The timer view is stale. Close it and try again.');
            return false;
        }

        // Use the Svelte store to set the habit, then start via the engine
        const {
            selectedHabit, selectedBook, activeProjectTaskFile, activeProjectTaskName, isSingleFileTask, timerMode
        } = await import('./store/TimerStore');
        await timerView.engine.reset();
        selectedHabit.set(habitName);
        if (context.mode) timerMode.set(context.mode);
        selectedBook.set(context.bookPath || '');
        activeProjectTaskFile.set(context.taskFile || null);
        activeProjectTaskName.set(context.taskName || null);
        isSingleFileTask.set(Boolean(context.isSingleFileTask));
        await timerView.engine.start();
        return true;
    }

    getTimerHabitForMedia(item: Pick<MediaItem, 'collectionId'>) {
        const habit = habitForCollection(this.settings, item.collectionId);
        return habit && (habit.type || 'timer') === 'timer' ? habit : undefined;
    }

    async startTimerForMedia(
        item: Pick<MediaItem, 'collectionId' | 'file' | 'title'>,
        options: { openView?: boolean } = {}
    ): Promise<boolean> {
        const habit = this.getTimerHabitForMedia(item);
        if (!habit) {
            new Notice(this.settings.language === 'ru'
                ? `Для коллекции «${item.collectionId}» не настроена привычка-таймер.`
                : `No timer habit is linked to the “${item.collectionId}” collection.`);
            return false;
        }

        const started = await this.startTimerForHabit(habit.name, {
            bookPath: item.file.path,
            openView: options.openView
        });
        if (started && options.openView !== false) await this.activateView(VIEW_TYPE_TIMER);
        return started;
    }

    async pauseTimerSession(): Promise<boolean> {
        const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMER)[0]?.view;
        if (view instanceof TimerView) {
            if (!this.settings.activeTimer) return false;
            await view.engine.pause();
            return true;
        }
        return this.timerSessions.pause();
    }

    async resumeTimerSession(): Promise<boolean> {
        const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMER)[0]?.view;
        if (view instanceof TimerView) {
            if (!this.settings.activeTimer) return false;
            await view.engine.start();
            return true;
        }
        return this.timerSessions.resume();
    }

    async prepareFinishTimerSession(): Promise<FinishTimerRequirements | null> {
        return this.timerSessions.prepareFinish();
    }

    async finishTimerSession(input: FinishTimerInput = {}): Promise<boolean> {
        const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMER)[0]?.view;
        if (view instanceof TimerView) view.engine.suspend();
        const result = await this.timerSessions.finish(input);
        if (view instanceof TimerView && result) await view.refresh();
        return Boolean(result);
    }

    async cancelTimerSession(): Promise<boolean> {
        const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMER)[0]?.view;
        if (view instanceof TimerView) {
            if (!this.settings.activeTimer) return false;
            await view.engine.reset();
            return true;
        }
        return this.timerSessions.cancel();
    }

    /**
     * Stop the currently running timer.
     * Returns true if a timer was running and was stopped.
     */
    async stopTimer(): Promise<boolean> {
        return this.cancelTimerSession();
    }

    onunload() {
        this.dashboardApiBridge?.stop();
        this.telegram.stopScheduler();
        this.companion.stop();
        this.stateManager.destroy();
        if (this.currentThemeClass) {
            document.body.classList.remove(this.currentThemeClass);
        }
    }

}
