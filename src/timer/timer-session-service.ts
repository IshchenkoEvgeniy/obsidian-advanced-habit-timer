import { TFile, moment } from 'obsidian';
import { get } from 'svelte/store';
import type HabitTimerPlugin from '../main';
import { automaticTimerProgress, normalizeDailyGoalUnit } from '../library/daily-goals';
import type { FinishTimerInput, FinishTimerRequirements } from '../integration/dashboard-api-contract';
import {
    activeProjectTaskFile,
    activeProjectTaskName,
    isRunning,
    isSingleFileTask,
    selectedBook,
    selectedHabit,
    selectedSubTask,
    sessionNote,
    sessionStartTime,
    timerMode,
    timerSeconds
} from '../store/TimerStore';
import { commitTimerSession } from './timer-session-persistence';
import { ensureDailyNoteFile } from '../services/daily-note-file';

export interface StartTimerSessionInput {
    habitName: string;
    mode?: 'timer' | 'pm';
    subTask?: string;
    mediaPath?: string;
    taskPath?: string;
    taskName?: string;
    isSingleFileTask?: boolean;
    source?: 'obsidian' | 'telegram';
}

export interface FinishTimerSessionResult {
    durationSeconds: number;
    savedProgress: number | null;
}

interface CalculatedTimerState {
    elapsedSeconds: number;
    remainingSeconds?: number;
}

export class TimerSessionService {
    private operationChain: Promise<unknown> = Promise.resolve();

    constructor(private plugin: HabitTimerPlugin) {}

    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.operationChain.then(operation);
        this.operationChain = next.catch(() => undefined);
        return next;
    }

    start(input: StartTimerSessionInput): Promise<boolean> {
        return this.serialize(() => this.startSession(input));
    }

    pause(): Promise<boolean> {
        return this.serialize(() => this.pauseSession());
    }

    resume(): Promise<boolean> {
        return this.serialize(() => this.resumeSession());
    }

    cancel(): Promise<boolean> {
        return this.serialize(() => this.cancelSession());
    }

    prepareFinish(): Promise<FinishTimerRequirements | null> {
        return this.serialize(() => this.prepareSessionFinish());
    }

    finish(input: FinishTimerInput = {}): Promise<FinishTimerSessionResult | null> {
        return this.serialize(() => this.finishSession(input));
    }

    private calculate(): CalculatedTimerState | null {
        const active = this.plugin.settings.activeTimer;
        if (!active) return null;
        const delta = (active.timerState || 'running') === 'running' && active.lastStartedAt
            ? Math.max(0, Math.floor((Date.now() - active.lastStartedAt) / 1000))
            : 0;
        const remaining = active.mode === 'pm'
            ? Math.max(0, active.remainingSeconds ?? this.plugin.settings.pomodoroDuration * 60)
            : undefined;
        return {
            elapsedSeconds: Math.max(0, active.elapsedSeconds || 0) + (remaining === undefined ? delta : Math.min(delta, remaining)),
            remainingSeconds: remaining === undefined ? undefined : Math.max(0, remaining - delta)
        };
    }

    private async ensureDailyNote(date: string): Promise<TFile | null> {
        const existing = this.plugin.getDailyNote(date);
        if (existing) return existing;
        return ensureDailyNoteFile(this.plugin.app, this.plugin.settings.dailyNotesFolder, date);
    }

    private async writeTimerFrontmatter(file: TFile): Promise<void> {
        const active = this.plugin.settings.activeTimer;
        const calculated = this.calculate();
        if (!active || !calculated) return;
        await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
            const fm = frontmatter as Record<string, unknown>;
            fm.timer_active = true;
            fm.timer_state = active.timerState || 'running';
            fm.timer_start_time = active.startTime;
            fm.timer_habit = active.habitName;
            fm.timer_elapsed_seconds = calculated.elapsedSeconds;
            if (active.mode === 'pm') fm.timer_remaining_seconds = calculated.remainingSeconds;
            else delete fm.timer_remaining_seconds;
            if ((active.timerState || 'running') === 'running') fm.timer_start_ts = active.lastStartedAt;
            else delete fm.timer_start_ts;
            if (active.taskName) fm.timer_task_name = active.taskName;
            else delete fm.timer_task_name;
        });
    }

    private async clearTimerFrontmatter(path: string): Promise<void> {
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;
        await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
            const fm = frontmatter as Record<string, unknown>;
            for (const key of [
                'timer_active', 'timer_state', 'timer_start_ts', 'timer_start_time',
                'timer_habit', 'timer_task_name', 'timer_elapsed_seconds', 'timer_remaining_seconds'
            ]) delete fm[key];
        });
    }

    private syncStores(): void {
        const active = this.plugin.settings.activeTimer;
        const calculated = this.calculate();
        if (!active || !calculated) {
            this.resetStores();
            return;
        }

        const taskFile = active.taskName
            ? this.plugin.app.vault.getAbstractFileByPath(active.path)
            : null;
        selectedHabit.set(active.habitName);
        selectedBook.set(active.bookPath || '');
        selectedSubTask.set(active.subTask || '');
        sessionStartTime.set(active.startTime);
        timerMode.set(active.mode);
        timerSeconds.set(active.mode === 'pm'
            ? calculated.remainingSeconds || 0
            : calculated.elapsedSeconds);
        isRunning.set((active.timerState || 'running') === 'running');
        activeProjectTaskFile.set(taskFile instanceof TFile ? taskFile : null);
        activeProjectTaskName.set(active.taskName || null);
        isSingleFileTask.set(Boolean(active.isSingleFileTask));
    }

    private resetStores(): void {
        timerSeconds.set(get(timerMode) === 'pm' ? this.plugin.settings.pomodoroDuration * 60 : 0);
        isRunning.set(false);
        sessionStartTime.set(null);
        sessionNote.set('');
        selectedBook.set('');
        selectedSubTask.set('');
        activeProjectTaskFile.set(null);
        activeProjectTaskName.set(null);
        isSingleFileTask.set(false);
    }

    private async startSession(input: StartTimerSessionInput): Promise<boolean> {
        if (this.plugin.settings.activeTimer) return false;
        const property = this.plugin.settings.properties.find(item => item.name === input.habitName);
        if (!property || (property.type || 'timer') !== 'timer') return false;

        const date = moment().format('YYYY-MM-DD');
        const taskFile = input.taskPath
            ? this.plugin.app.vault.getAbstractFileByPath(input.taskPath)
            : null;
        if (input.taskPath && !(taskFile instanceof TFile)) return false;
        const dailyNote = taskFile instanceof TFile ? null : await this.ensureDailyNote(date);
        const activeFile = taskFile instanceof TFile ? taskFile : dailyNote;
        if (!(activeFile instanceof TFile)) return false;
        if (this.plugin.settings.activeTimer) return false;

        const mode = input.mode || 'timer';
        const now = Date.now();
        this.plugin.settings.activeTimer = {
            sessionId: crypto.randomUUID(),
            path: activeFile.path,
            habitName: input.habitName,
            subTask: input.subTask,
            mode,
            startTime: moment().format('HH:mm'),
            bookPath: input.mediaPath,
            taskName: input.taskName,
            isSingleFileTask: input.isSingleFileTask || undefined,
            timerState: 'running',
            elapsedSeconds: 0,
            remainingSeconds: mode === 'pm' ? this.plugin.settings.pomodoroDuration * 60 : undefined,
            lastStartedAt: now,
            source: input.source || 'obsidian'
        };
        await this.plugin.saveSettings();
        await this.writeTimerFrontmatter(activeFile);
        this.syncStores();

        if (this.plugin.settings.telegramLiveNotifications) {
            const context = input.taskName || input.subTask;
            void this.plugin.telegram.send(`▶️ Timer started: ${input.habitName}${context ? ` (${context})` : ''}`);
        }
        return true;
    }

    private async pauseSession(): Promise<boolean> {
        const active = this.plugin.settings.activeTimer;
        const calculated = this.calculate();
        if (!active || !calculated) return false;
        active.timerState = 'paused';
        active.elapsedSeconds = calculated.elapsedSeconds;
        active.remainingSeconds = calculated.remainingSeconds;
        active.lastStartedAt = undefined;
        await this.plugin.saveSettings();
        const file = this.plugin.app.vault.getAbstractFileByPath(active.path);
        if (file instanceof TFile) await this.writeTimerFrontmatter(file);
        this.syncStores();
        return true;
    }

    private async resumeSession(): Promise<boolean> {
        if (this.plugin.settings.activeTimer?.pendingCommit) return false;
        const active = this.plugin.settings.activeTimer;
        if (!active) return false;
        if ((active.timerState || 'running') === 'running') return true;
        active.timerState = 'running';
        active.lastStartedAt = Date.now();
        await this.plugin.saveSettings();
        const file = this.plugin.app.vault.getAbstractFileByPath(active.path);
        if (file instanceof TFile) await this.writeTimerFrontmatter(file);
        this.syncStores();
        return true;
    }

    private async cancelSession(): Promise<boolean> {
        const active = this.plugin.settings.activeTimer;
        if (!active) {
            this.resetStores();
            return false;
        }
        await this.clearTimerFrontmatter(active.path);
        this.plugin.settings.activeTimer = undefined;
        await this.plugin.saveSettings();
        this.resetStores();
        return true;
    }

    private async prepareSessionFinish(): Promise<FinishTimerRequirements | null> {
        const active = this.plugin.settings.activeTimer;
        const calculated = this.calculate();
        if (!active || !calculated) return null;
        const requirements: FinishTimerRequirements = {
            elapsedSeconds: calculated.elapsedSeconds,
            mediaPath: active.bookPath
        };
        if (active.bookPath) {
            const media = get(this.plugin.stateManager.mediaItems).find(item => item.file.path === active.bookPath);
            if (media) {
                const unit = normalizeDailyGoalUnit(media.unit || 'units');
                requirements.mediaTitle = media.title;
                requirements.currentProgress = media.progress;
                requirements.total = media.total;
                requirements.unit = unit;
                requirements.suggestedProgress = automaticTimerProgress(unit, calculated.elapsedSeconds) ?? undefined;
            }
        }
        return requirements;
    }

    private async finishSession(input: FinishTimerInput): Promise<FinishTimerSessionResult | null> {
        if (!this.plugin.settings.activeTimer) return null;
        await this.pauseSession();
        const active = this.plugin.settings.activeTimer;
        const calculated = this.calculate();
        if (!active || !calculated || calculated.elapsedSeconds <= 0) return null;

        const pendingPath = active.pendingCommit?.dailyNotePath;
        const dailyNote = pendingPath
            ? this.plugin.app.vault.getAbstractFileByPath(pendingPath)
            : await this.ensureDailyNote(moment().format('YYYY-MM-DD'));
        if (!(dailyNote instanceof TFile)) return null;
        const projectFile = active.taskName
            ? this.plugin.app.vault.getAbstractFileByPath(active.path)
            : null;
        const projectLink = projectFile instanceof TFile
            ? `[[${projectFile.basename}]]${active.taskName && active.taskName !== projectFile.basename ? ` (${active.taskName})` : ''}`
            : '';
        const context = projectLink || active.subTask || '';
        const displayProperty = context ? `${active.habitName}: ${context}` : active.habitName;
        const progressAdded = active.bookPath ? Math.max(0, input.progressAdded || 0) : null;

        const result = await commitTimerSession(this.plugin, {
            dailyNote,
            habitName: active.habitName,
            displayProperty,
            durationSeconds: calculated.elapsedSeconds,
            progressAdded,
            note: input.note || '',
            mediaPath: active.bookPath || null,
            mode: active.mode,
            sessionStartTime: active.startTime,
            projectTaskPath: projectFile instanceof TFile ? projectFile.path : undefined,
            projectTaskName: active.taskName,
            projectSubTask: active.subTask,
            isSingleFileTask: active.isSingleFileTask
        });

        await this.clearTimerFrontmatter(active.path);
        this.plugin.settings.activeTimer = undefined;
        await this.plugin.saveSettings();
        this.resetStores();
        return { durationSeconds: result.durationSeconds, savedProgress: result.savedProgress };
    }
}

