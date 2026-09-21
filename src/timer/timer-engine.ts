import { Notice, TFile, moment } from 'obsidian';
import { get } from 'svelte/store';
import { t } from '../i18n';
import { getBoolean, getNumber, getString } from '../utils';
import type { TimerView } from './timer-view';
import { recoverTimerSeconds } from './timer-state';
import {
    timerSeconds, timerMode, isRunning, sessionStartTime,
    selectedHabit, selectedSubTask, selectedBook,
    sessionNote, activeProjectTaskFile, activeProjectTaskName, isSingleFileTask
} from '../store/TimerStore';

type PersistedTimerState = 'running' | 'paused';

export class TimerEngine {
    private timerInterval: number | null = null;
    private lastTickTime = 0;

    constructor(private view: TimerView) {}

    get plugin() { return this.view.plugin; }
    get app() { return this.view.app; }

    async start(notifyTelegram = true): Promise<void> {
        if (this.timerInterval !== null) return;

        const mode = get(timerMode);
        let currentSeconds = get(timerSeconds);
        if (mode === 'pm' && currentSeconds === 0) {
            if (this.plugin.settings.activeTimer) {
                new Notice(t(this.plugin.settings.language, 'timer_finished'));
                return;
            }
            currentSeconds = this.plugin.settings.pomodoroDuration * 60;
            timerSeconds.set(currentSeconds);
        }

        let startTime = get(sessionStartTime);
        if (!startTime) {
            startTime = moment().format('HH:mm');
            sessionStartTime.set(startTime);
        }

        const habit = get(selectedHabit);
        const subTask = get(selectedSubTask);
        const book = get(selectedBook);
        const taskFile = get(activeProjectTaskFile);
        const taskName = get(activeProjectTaskName);
        const isSingle = get(isSingleFileTask);
        const todayStr = moment().format('YYYY-MM-DD');
        const dailyNote = await this.view.ensureDailyNote(todayStr);
        const activeFile = taskFile || dailyNote;
        if (!activeFile) {
            new Notice(t(this.plugin.settings.language, 'daily_note_not_found'));
            return;
        }

        const now = Date.now();
        const previousTimer = this.plugin.settings.activeTimer;
        this.plugin.settings.activeTimer = {
            path: activeFile.path,
            habitName: habit,
            subTask: taskFile ? undefined : subTask,
            mode,
            startTime,
            bookPath: book || undefined,
            taskName: taskName || undefined,
            isSingleFileTask: isSingle || undefined,
            timerState: 'running',
            elapsedSeconds: this.getElapsedSeconds(),
            remainingSeconds: mode === 'pm' ? currentSeconds : undefined,
            lastStartedAt: now,
            targetSeconds: previousTimer?.targetSeconds,
            source: previousTimer?.source || 'obsidian'
        };
        await this.plugin.saveSettings();
        await this.writeTimerFrontmatter(activeFile, 'running', now);

        if (notifyTelegram && this.plugin.settings.telegramLiveNotifications) {
            const extra = taskFile ? ` (${taskFile.basename})` : (subTask ? ` (${subTask})` : '');
            void this.plugin.telegram.send(`▶️ Timer started: ${habit}${extra}`);
        }

        this.view.musicPlayer.playIfReady();
        isRunning.set(true);
        this.lastTickTime = now;
        this.timerInterval = window.setInterval(() => this.tick(), 1000);
    }

    async pause(): Promise<void> {
        this.clearInterval();
        isRunning.set(false);
        this.view.musicPlayer.pause();
        await this.syncSnapshot('paused');
    }

    /** Stop rendering ticks while preserving a logically running session. */
    suspend(): void {
        this.clearInterval();
        isRunning.set(false);
        this.view.musicPlayer.pause();
    }

    async reset(): Promise<void> {
        this.clearInterval();
        isRunning.set(false);
        this.view.musicPlayer.pause();
        timerSeconds.set(get(timerMode) === 'pm' ? this.plugin.settings.pomodoroDuration * 60 : 0);
        sessionStartTime.set(null);
        sessionNote.set('');

        const activeTimer = this.plugin.settings.activeTimer;
        if (activeTimer) {
            const file = this.app.vault.getAbstractFileByPath(activeTimer.path);
            if (file instanceof TFile) {
                await this.app.fileManager.processFrontMatter(file, frontmatter => {
                    const fm = frontmatter as Record<string, unknown>;
                    for (const key of [
                        'timer_active', 'timer_state', 'timer_start_ts', 'timer_start_time',
                        'timer_habit', 'timer_task_name', 'timer_elapsed_seconds', 'timer_remaining_seconds'
                    ]) delete fm[key];
                });
            }
        }

        this.plugin.settings.activeTimer = undefined;
        await this.plugin.saveSettings();
        activeProjectTaskFile.set(null);
        activeProjectTaskName.set(null);
        isSingleFileTask.set(false);
    }

    async syncSnapshot(state: PersistedTimerState = get(isRunning) ? 'running' : 'paused'): Promise<void> {
        const activeTimer = this.plugin.settings.activeTimer;
        if (!activeTimer) return;

        const now = Date.now();
        activeTimer.timerState = state;
        activeTimer.elapsedSeconds = this.getElapsedSeconds();
        activeTimer.remainingSeconds = get(timerMode) === 'pm' ? get(timerSeconds) : undefined;
        activeTimer.lastStartedAt = state === 'running' ? now : undefined;
        await this.plugin.saveSettings();

        const file = this.app.vault.getAbstractFileByPath(activeTimer.path);
        if (file instanceof TFile) await this.writeTimerFrontmatter(file, state, now);
        if (state === 'running') this.lastTickTime = now;
    }

    async saveTimerSettings(): Promise<void> {
        await this.syncSnapshot();
    }

    async recoverActiveTimer(skipFrontmatterValidation = false): Promise<void> {
        const settings = this.plugin.settings;
        const activeTimer = settings.activeTimer;
        if (!activeTimer) return;

        const file = this.app.vault.getAbstractFileByPath(activeTimer.path);
        if (!(file instanceof TFile)) {
            settings.activeTimer = undefined;
            await this.plugin.saveSettings();
            return;
        }

        const cachedFrontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        const hasTimerFlag = cachedFrontmatter
            ? Object.prototype.hasOwnProperty.call(cachedFrontmatter, 'timer_active')
            : false;
        if (!skipFrontmatterValidation && hasTimerFlag && !getBoolean(cachedFrontmatter!.timer_active)) {
            settings.activeTimer = undefined;
            await this.plugin.saveSettings();
            return;
        }
        const fm = cachedFrontmatter || {};

        const state = activeTimer.timerState || getString(fm.timer_state) as PersistedTimerState || 'running';
        const lastStartedAt = activeTimer.lastStartedAt || getNumber(fm.timer_start_ts);
        const baseElapsed = activeTimer.elapsedSeconds ?? getNumber(fm.timer_elapsed_seconds);
        const pomodoroSeconds = settings.pomodoroDuration * 60;
        const hasFmRemaining = Object.prototype.hasOwnProperty.call(fm, 'timer_remaining_seconds');
        const baseRemaining = activeTimer.remainingSeconds !== undefined
            ? activeTimer.remainingSeconds
            : hasFmRemaining ? getNumber(fm.timer_remaining_seconds) : pomodoroSeconds;

        selectedHabit.set(activeTimer.habitName);
        sessionStartTime.set(activeTimer.startTime);
        timerMode.set(activeTimer.mode);
        selectedSubTask.set(activeTimer.subTask || '');
        selectedBook.set(activeTimer.bookPath || '');

        const isDailyNote = settings.dailyNotesFolder
            ? file.path.startsWith(settings.dailyNotesFolder) && /^\d{4}-\d{2}-\d{2}$/.test(file.basename)
            : /^\d{4}-\d{2}-\d{2}$/.test(file.basename);
        if (!isDailyNote) {
            activeProjectTaskFile.set(file);
            activeProjectTaskName.set(activeTimer.taskName || null);
            isSingleFileTask.set(Boolean(activeTimer.isSingleFileTask));
        }

        timerSeconds.set(recoverTimerSeconds(
            activeTimer.mode, state, baseElapsed, baseRemaining, lastStartedAt, Date.now()
        ));

        if (activeTimer.mode === 'pm' && get(timerSeconds) === 0) {
            await this.syncSnapshot('paused');
            new Notice(t(settings.language, 'timer_finished'));
            return;
        }

        if (state === 'running') {
            this.view.musicPlayer.playIfReady();
            isRunning.set(true);
            this.lastTickTime = Date.now();
            if (this.timerInterval === null) {
                this.timerInterval = window.setInterval(() => this.tick(), 1000);
            }
        } else {
            isRunning.set(false);
            new Notice(t(settings.language, 'timer_restored'));
        }
    }

    private tick(): void {
        const now = Date.now();
        const diff = Math.floor((now - this.lastTickTime) / 1000);
        if (diff < 1) return;
        this.lastTickTime += diff * 1000;

        timerSeconds.update(seconds => {
            if (get(timerMode) !== 'pm') return seconds + diff;
            const next = Math.max(0, seconds - diff);
            if (seconds > 0 && next === 0) {
                window.setTimeout(() => {
                    void this.pause().then(() => this.view.save());
                }, 0);
            }
            return next;
        });
    }

    private clearInterval(): void {
        if (this.timerInterval !== null) {
            window.clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    private getElapsedSeconds(): number {
        if (get(timerMode) === 'pm') {
            return Math.max(0, this.plugin.settings.pomodoroDuration * 60 - get(timerSeconds));
        }
        return Math.max(0, get(timerSeconds));
    }

    private async writeTimerFrontmatter(file: TFile, state: PersistedTimerState, now: number): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, frontmatter => {
            const fm = frontmatter as Record<string, unknown>;
            fm.timer_active = true;
            fm.timer_state = state;
            fm.timer_start_time = get(sessionStartTime);
            fm.timer_habit = get(selectedHabit);
            fm.timer_elapsed_seconds = this.getElapsedSeconds();
            if (get(timerMode) === 'pm') fm.timer_remaining_seconds = get(timerSeconds);
            else delete fm.timer_remaining_seconds;
            if (state === 'running') fm.timer_start_ts = now;
            else delete fm.timer_start_ts;
            const taskName = get(activeProjectTaskName);
            if (taskName) fm.timer_task_name = taskName;
            else delete fm.timer_task_name;
        });
    }
}
