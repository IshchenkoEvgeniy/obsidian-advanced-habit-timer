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
    constructor(private plugin: HabitTimerPlugin) {}

    private calculate(): CalculatedTimerState | null {
        const active = this.plugin.settings.activeTimer;
        if (!active) return null;
        const delta = active.timerState === 'running' && active.lastStartedAt
            ? Math.max(0, Math.floor((Date.now() - active.lastStartedAt) / 1000))
            : 0;
        return {
            elapsedSeconds: Math.max(0, active.elapsedSeconds || 0) + delta,
            remainingSeconds: active.mode === 'pm'
                ? Math.max(0, (active.remainingSeconds ?? this.plugin.settings.pomodoroDuration * 60) - delta)
                : undefined
        };
    }

    private async ensureDailyNote(date: string): Promise<TFile | null> {
        const existing = this.plugin.getDailyNote(date);
        if (existing) return existing;
        const folder = this.plugin.settings.dailyNotesFolder;
        const path = folder ? `${folder}/${date}.md` : `${date}.md`;
        try {
            return await this.plugin.app.vault.create(path, '---\n---\n');
        } catch (error) {
            const retry = this.plugin.app.vault.getAbstractFileByPath(path);
            if (retry instanceof TFile) return retry;
            console.error('Could not create daily note for timer session:', error);
            return null;
        }
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

    async start(input: StartTimerSessionInput): Promise<boolean> {
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

        const mode = input.mode || 'timer';
        const now = Date.now();
        this.plugin.settings.activeTimer = {
            path: activeFile.path,
            habitName: input.habitName,
            subTask: taskFile instanceof TFile ? undefined : input.subTask,
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

    async pause(): Promise<boolean> {
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

    async resume(): Promise<boolean> {
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

    async cancel(): Promise<boolean> {
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

    async prepareFinish(): Promise<FinishTimerRequirements | null> {
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

    async finish(input: FinishTimerInput = {}): Promise<FinishTimerSessionResult | null> {
        if (!this.plugin.settings.activeTimer) return null;
        await this.pause();
        const active = this.plugin.settings.activeTimer;
        const calculated = this.calculate();
        if (!active || !calculated || calculated.elapsedSeconds <= 0) return null;

        const dailyNote = await this.ensureDailyNote(moment().format('YYYY-MM-DD'));
        if (!dailyNote) return null;
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
            isSingleFileTask: active.isSingleFileTask
        });

        await this.clearTimerFrontmatter(active.path);
        this.plugin.settings.activeTimer = undefined;
        await this.plugin.saveSettings();
        this.resetStores();
        return { durationSeconds: calculated.elapsedSeconds, savedProgress: result.savedProgress };
    }
}

