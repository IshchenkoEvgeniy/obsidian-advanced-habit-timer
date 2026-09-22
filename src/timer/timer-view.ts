import { ItemView, WorkspaceLeaf, Notice, TFile, moment } from 'obsidian';
import { fetchSessionsFromFile } from '../utils';
import { DaySummaryModal } from '../session-modals';
import { SaveMediaSessionModal } from '../media-modals';
import { t } from '../i18n';
import { getHabitValueFromFrontmatter } from '../services/habit-service';
import { MusicPlayer } from './music-player';
import { TimerEngine } from './timer-engine';
import type HabitTimerPlugin from '../main';
import type { Frontmatter } from '../utils/frontmatter';
import { automaticTimerProgress, collectionDailyGoalUnit, dailyGoalUnitLabel, mediaProgressUnit } from '../library/daily-goals';
import type { MediaDailyGoalUnit } from '../types';
import { readPropertyNumber, readPropertyString } from '../library/property-schema';
import {
    evaluateHabitState, readHabitExplicitState, statePreservesStreak
} from '../habits/goals';
import { commitTimerSession } from './timer-session-persistence';
import { mount, unmount } from 'svelte';
import TimerApp from '../components/timer/TimerApp.svelte';
import Heatmap from '../components/charts/Heatmap.svelte';
import { get } from 'svelte/store';
import {
    timerSeconds, timerMode, sessionStartTime,
    selectedHabit, selectedSubTask, selectedBook, sessionNote,
    activeProjectTaskFile, activeProjectTaskName, isSingleFileTask,
    pastHistory, baseSecondsToday
} from '../store/TimerStore';

export const VIEW_TYPE_TIMER = "habit-timer-view";

export class TimerView extends ItemView {
    plugin: HabitTimerPlugin;
    musicPlayer: MusicPlayer;
    engine: TimerEngine;
    svelteApp: Record<string, unknown> | null;

    private lastHeatmapKey: string = '';
    private heatmapControlsApp: Record<string, unknown> | null;
    private heatmapApp: Record<string, unknown> | null;
    private isSaving = false;
    onRefreshCallbacks: ((fm: Record<string, unknown>) => Promise<void>)[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: HabitTimerPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.musicPlayer = new MusicPlayer(this.app, this.plugin);
        this.engine = new TimerEngine(this);
    }

    getViewType() { return VIEW_TYPE_TIMER; }
    getDisplayText() { return t(this.plugin.settings.language, 'timer_view_title'); }
    getIcon() { return "timer"; }

    async onOpen() {
        await this.plugin.ensureHabitProperties();
        await this.render();
        await this.recoverActiveTimer();
    }

    async onClose() {
        // Unmount all Svelte components to prevent memory leaks
        if (this.svelteApp) { try { await unmount(this.svelteApp); } catch { /* ignore */ } this.svelteApp = null; }
        if (this.heatmapApp) { try { await unmount(this.heatmapApp); } catch { /* ignore */ } this.heatmapApp = null; }
        if (this.heatmapControlsApp) { try { await unmount(this.heatmapControlsApp); } catch { /* ignore */ } this.heatmapControlsApp = null; }
        // Stop the tick interval but do NOT reset the timer state —
        // recoverActiveTimer() will resume it when the view is re-opened
        this.engine.suspend();
    }

    async render() {
        const container = this.containerEl.children[1] as HTMLElement;
        if (!container) return;
        container.empty();
        container.addClass('habit-timer-view-container');

        if (this.svelteApp) {
            try { await unmount(this.svelteApp); } catch { /* ignore */ }
        }

        try {
            this.svelteApp = mount(TimerApp, {
                target: container,
                props: {
                    plugin: this.plugin,
                    app: this.app,
                    view: this
                }
            });
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            new Notice("TimerApp mount error: " + err.message, 10000);
            container.createEl("div", { text: "Error loading timer: " + err.stack, attr: { style: 'color: red; padding: 20px; white-space: pre-wrap;' }});
        }

        await this.refresh();
    }

    async refresh() {
        const habitName = get(selectedHabit) || this.plugin.settings.properties[0]?.name;
        if (!habitName) return;
        selectedHabit.set(habitName);

        const prop = this.plugin.settings.properties.find(p => p.name === habitName);
        if (!prop) return;
        const type = prop.type || 'timer';

        const callbacks = [...this.onRefreshCallbacks];

        if (type === 'timer') {
            if (prop.musicFolder && this.plugin.settings.globalMusicFolder) {
                const fullPath = `${this.plugin.settings.globalMusicFolder}/${prop.musicFolder}`;
                this.musicPlayer.loadFolder(fullPath);
            } else {
                this.musicPlayer.clearFolder();
            }
        }

        let newPastHistory = [];
        const todayStr = moment().format('YYYY-MM-DD');
        const createdAt = prop.createdAt || "0000-00-00";

        const historyDays = Math.max(this.plugin.settings.heatmapDays, 30);
        for (let i = historyDays; i >= 1; i--) {
            const d = moment().subtract(i, 'days').format('YYYY-MM-DD');
            if (d < createdAt) continue;

            const f = this.getNote(d);
            let sec = 0;
            if (f) {
                const c = this.app.metadataCache.getFileCache(f);
                if (c?.frontmatter) {
                    sec = getHabitValueFromFrontmatter(c.frontmatter, prop);
                }
            } else if (type === 'negative') {
                sec = 1;
            }
            newPastHistory.push({ date: d, durationSec: sec });
        }
        pastHistory.set(newPastHistory);

        const tf = this.getNote(todayStr);
        let baseSec = 0;
        if (tf) {
            const cache = this.app.metadataCache.getFileCache(tf);
            const fm = cache?.frontmatter || {};
            baseSec = getHabitValueFromFrontmatter(fm, prop);
            for (const cb of callbacks) await cb(fm);
        } else {
            for (const cb of callbacks) await cb({});
        }
        baseSecondsToday.set(baseSec);
    }

    renderHeatmap(container: HTMLElement) {
        const prop = this.plugin.settings.properties.find(p => p.name === get(selectedHabit));
        if (!prop) return;
        const type = prop.type || 'timer';
        const lang = this.plugin.settings.language;

        const todayStr = moment().format('YYYY-MM-DD');
        const heatmapKey = `${prop.name}|${todayStr}|${get(baseSecondsToday)}|${get(pastHistory).length}|${get(timerSeconds)}`;
        if (heatmapKey === this.lastHeatmapKey) return;
        this.lastHeatmapKey = heatmapKey;

        if (this.heatmapControlsApp) { try { void unmount(this.heatmapControlsApp); } catch { /* ignore */ } }
        if (this.heatmapApp) { try { void unmount(this.heatmapApp); } catch { /* ignore */ } }

        container.empty();
        const hmHead = container.createDiv({ cls: "heatmap-timer-header", attr: { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;" } });
        hmHead.createDiv({ text: t(lang, 'last_30_days'), cls: "heatmap-title" });
        // Heatmap controls were deleted from StatsView, using fixed window for now

        const fullHistory = [...get(pastHistory)];
        
        let currentSec = 0;
        if (type === 'timer') {
            const sec = get(timerSeconds);
            const isPm = get(timerMode) === 'pm';
            currentSec = isPm ? (this.plugin.settings.pomodoroDuration * 60) - sec : sec;
        }

        const totalToday = get(baseSecondsToday) + currentSec;
        fullHistory.push({ date: todayStr, durationSec: totalToday });

        const hmRecs = fullHistory.map(history => {
            const file = this.getNote(history.date);
            const fm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
            const explicit = fm ? readHabitExplicitState(fm, prop.name) : null;
            const weeklyValue = (prop.goalMode || 'daily') === 'weekly'
                ? fullHistory
                    .filter(other => moment(other.date).isSame(moment(history.date), 'isoWeek'))
                    .reduce((sum, other) => sum + other.durationSec, 0)
                : undefined;
            const state = evaluateHabitState(prop, history.durationSec, history.date, explicit, weeklyValue);
            return { date: history.date, value: history.durationSec, isMet: statePreservesStreak(state) };
        });

        const heatmapTarget = container.createDiv({ cls: 'heatmap-mount-target' });
        this.heatmapApp = mount(Heatmap, {
            target: heatmapTarget,
            props: {
                records: hmRecs,
                days: 30, // timer usually shows 30 days
                formatValue: (v: number) => this.plugin.formatTime(v),
                onBoxClick: (d: string) => this.showDaySummary(d)
            }
        });

        const initBtnCont = container.createDiv({ attr: { style: "margin-top: 15px; display: flex; justify-content: center;" } });
        const initBtn = initBtnCont.createEl("button", { text: `✨ ${t(lang, 'init_today_btn')}`, cls: "music-btn", attr: { style: "width: 100%; opacity: 0.8;" } });
        initBtn.onclick = async () => {
            const today = moment().format('YYYY-MM-DD');
            let f = this.plugin.getDailyNote(today);
            if (!f) {
                const folder = this.plugin.settings.dailyNotesFolder;
                const path = folder ? `${folder}/${today}.md` : `${today}.md`;
                f = await this.app.vault.create(path, "---\n---\n");
            }
            if (f instanceof TFile) {
                await this.app.fileManager.processFrontMatter(f, (frontmatter) => {
                    const fm = frontmatter as Record<string, unknown>;
                    this.plugin.settings.properties.forEach(p => {
                        const t = p.type || 'timer';
                        if (t === 'timer' && !fm[p.name]) fm[p.name] = "00:00:00";
                        else if (t === 'count' && fm[p.name] === undefined) fm[p.name] = 0;
                        else if (t === 'binary' && fm[p.name] === undefined) fm[p.name] = false;
                        else if (t === 'negative' && fm[`${p.name}-Relapse`] === undefined) fm[`${p.name}-Relapse`] = false;
                    });
                });
                new Notice(t(lang, 'init_success'));
                this.lastHeatmapKey = '';
                void this.refresh();
            }
        };
    }

    async setProjectTask(taskFile: TFile, taskName: string, habitName: string, isSingleFileTaskParam?: boolean) {
        activeProjectTaskFile.set(taskFile);
        activeProjectTaskName.set(taskName);
        isSingleFileTask.set(!!isSingleFileTaskParam);
        selectedHabit.set(habitName);
        await this.refresh();
    }

    getNote(d: string): TFile | null {
        return this.plugin.getDailyNote(d);
    }

    async ensureDailyNote(date: string): Promise<TFile | null> {
        const existing = this.getNote(date);
        if (existing) return existing;

        const folder = this.plugin.settings.dailyNotesFolder;
        const path = folder ? `${folder}/${date}.md` : `${date}.md`;
        try {
            return await this.app.vault.create(path, '---\n---\n');
        } catch (error) {
            const retry = this.app.vault.getAbstractFileByPath(path);
            if (retry instanceof TFile) return retry;
            console.error('Could not create daily note for timer:', error);
            return null;
        }
    }

    async save() {
        if (this.isSaving) return;
        this.isSaving = true;
        await this.engine.pause();

        const f = await this.ensureDailyNote(moment().format("YYYY-MM-DD"));
        if (!f) {
            this.isSaving = false;
            new Notice(t(this.plugin.settings.language, 'daily_note_not_found'));
            return;
        }
        
        const habitName = get(selectedHabit);
        const projectSubTaskName = get(selectedSubTask);
        const pTaskFile = get(activeProjectTaskFile);
        
        const subTask = pTaskFile ? `[[${pTaskFile.basename}]]${projectSubTaskName ? ` (${projectSubTaskName})` : ''}` : projectSubTaskName;
        const displayProp = subTask ? `${habitName}: ${subTask}` : habitName;
        
        const isPm = get(timerMode) === 'pm';
        const currentSec = get(timerSeconds);
        const sSec = isPm ? (this.plugin.settings.pomodoroDuration * 60) - currentSec : currentSec;
        if (sSec <= 0) {
            this.isSaving = false;
            new Notice(this.plugin.settings.language === 'ru' ? 'В сессии пока нет времени.' : 'This session has no elapsed time yet.');
            return;
        }

        const mediaPath = get(selectedBook);
        const note = get(sessionNote);

        if (mediaPath) {
            let currentProgress = 0;
            const mediaFile = this.app.vault.getAbstractFileByPath(mediaPath);
            if (mediaFile instanceof TFile) {
                const cache = this.app.metadataCache.getFileCache(mediaFile);
                if (cache && cache.frontmatter) {
                    currentProgress = readPropertyNumber(cache.frontmatter as Frontmatter, this.plugin.settings, 'progress');
                }
            }
            const progressUnit = this.getMediaProgressUnit(mediaFile instanceof TFile ? mediaFile : null);
            const automaticProgress = automaticTimerProgress(
                this.getMediaProgressUnitId(mediaFile instanceof TFile ? mediaFile : null), sSec
            );
            new SaveMediaSessionModal(this.app, this.plugin, currentProgress, sSec, note, async (progressAdded, modalNote) => {
                try {
                    await this.executeSave(f, habitName, displayProp, sSec, progressAdded, modalNote, mediaPath);
                } finally {
                    this.isSaving = false;
                }
            }, () => { this.isSaving = false; }, progressUnit, automaticProgress).open();
        } else {
            try {
                await this.executeSave(f, habitName, displayProp, sSec, null, note, null);
            } finally {
                this.isSaving = false;
            }
        }
    }

    async executeSave(dailyNote: TFile, habitName: string, displayProp: string, durationSec: number, pagesRead: number | null, note: string, bookPath: string | null) {
        const pTaskFile = get(activeProjectTaskFile);
        const pTaskName = get(activeProjectTaskName);
        const isSingle = get(isSingleFileTask);
        const subTaskDrop = get(selectedSubTask);
        await commitTimerSession(this.plugin, {
            dailyNote,
            habitName,
            displayProperty: displayProp,
            durationSeconds: durationSec,
            progressAdded: pagesRead,
            note,
            mediaPath: bookPath,
            mode: get(timerMode),
            sessionStartTime: get(sessionStartTime) || moment().format('HH:mm'),
            projectTaskPath: pTaskFile?.path,
            projectTaskName: pTaskName || undefined,
            projectSubTask: subTaskDrop || undefined,
            isSingleFileTask: isSingle
        });

        new Notice(t(this.plugin.settings.language, 'saved_notice'));
        await this.engine.reset();
        await this.refresh();
    }

    private getMediaProgressUnit(file: TFile | null): string {
        return dailyGoalUnitLabel(this.getMediaProgressUnitId(file), this.plugin.settings.language);
    }

    private getMediaProgressUnitId(file: TFile | null): MediaDailyGoalUnit {
        if (!file) return 'units';
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Frontmatter | undefined;
        const rawType = fm ? readPropertyString(fm, this.plugin.settings, 'format').toLowerCase() : '';
        const libraryType = fm ? readPropertyString(fm, this.plugin.settings, 'libraryType').toLowerCase() : '';
        const explicitUnit = fm ? readPropertyString(fm, this.plugin.settings, 'unit') : '';
        const total = fm ? readPropertyNumber(fm, this.plugin.settings, 'total') : 0;
        const collection = this.plugin.settings.mediaCollections.find(value =>
            value.id.toLocaleLowerCase() === libraryType || Boolean(value.folder && file.path.startsWith(value.folder + '/'))
        );
        return mediaProgressUnit(
            explicitUnit,
            collection?.id || libraryType,
            rawType,
            total,
            collection ? collectionDailyGoalUnit(collection) : 'pages'
        );
    }

    async recoverActiveTimer() {
        await this.engine.recoverActiveTimer();
    }

    async showDaySummary(date: string) {
        const f = this.getNote(date);
        if (!f) {
            new DaySummaryModal(this.app, date, [], this.plugin.settings.language).open();
            return;
        }
        const sessions = await fetchSessionsFromFile(this.app, f);
        new DaySummaryModal(this.app, date, sessions, this.plugin.settings.language).open();
    }
}
