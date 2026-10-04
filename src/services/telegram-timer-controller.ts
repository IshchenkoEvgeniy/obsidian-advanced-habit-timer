import { moment, TFile } from 'obsidian';
import type HabitTimerPlugin from '../main';
import { TimerView, VIEW_TYPE_TIMER } from '../timer/timer-view';
import { getTelegramTimerProgress } from './telegram-timer-state';
import { commitTimerSession } from '../timer/timer-session-persistence';

export interface TelegramTimerStatus {
    habitName: string;
    state: 'running' | 'paused';
    elapsedSeconds: number;
    targetSeconds?: number;
    remainingSeconds?: number;
}

export type TimerActionResult =
    | { ok: true; status?: TelegramTimerStatus; elapsedSeconds?: number }
    | { ok: false; reason: 'active' | 'not-found' | 'not-running' | 'daily-note' | 'empty' | 'obsidian-session' };

export class TelegramTimerController {
    private operationChain: Promise<unknown> = Promise.resolve();
    constructor(private plugin: HabitTimerPlugin) {}

    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.operationChain.then(operation);
        this.operationChain = next.catch(() => undefined);
        return next;
    }

    start(habitName: string, targetMinutes?: number): Promise<TimerActionResult> {
        return this.serialize(() => this.startSession(habitName, targetMinutes));
    }
    pause(): Promise<TimerActionResult> { return this.serialize(() => this.pauseSession()); }
    resume(): Promise<TimerActionResult> { return this.serialize(() => this.resumeSession()); }
    finish(): Promise<TimerActionResult> { return this.serialize(() => this.finishSession()); }
    cancel(): Promise<TimerActionResult> { return this.serialize(() => this.cancelSession()); }

    getStatus(now = Date.now()): TelegramTimerStatus | null {
        const active = this.plugin.settings.activeTimer;
        if (!active) return null;
        const elapsedSeconds = this.elapsedSeconds(now);
        const targetSeconds = active.targetSeconds;
        return {
            habitName: active.habitName,
            state: active.timerState || 'running',
            elapsedSeconds,
            targetSeconds,
            remainingSeconds: targetSeconds === undefined ? undefined : Math.max(0, targetSeconds - elapsedSeconds)
        };
    }

    private async startSession(habitName: string, targetMinutes?: number): Promise<TimerActionResult> {
        if (this.plugin.settings.activeTimer) return { ok: false, reason: 'active' };
        const prop = this.plugin.settings.properties.find(value => value.name === habitName);
        if (!prop || (prop.type || 'timer') !== 'timer') return { ok: false, reason: 'not-found' };
        const file = await this.plugin.dailyNotes.ensureNote(moment().format('YYYY-MM-DD'));
        if (!file) return { ok: false, reason: 'daily-note' };
        if (this.plugin.settings.activeTimer) return { ok: false, reason: 'active' };

        const now = Date.now();
        this.plugin.settings.activeTimer = {
            sessionId: crypto.randomUUID(),
            path: file.path,
            habitName,
            mode: 'timer',
            startTime: moment().format('HH:mm'),
            timerState: 'running',
            elapsedSeconds: 0,
            lastStartedAt: now,
            targetSeconds: targetMinutes && targetMinutes > 0 ? Math.round(targetMinutes * 60) : undefined,
            source: 'telegram'
        };
        await this.plugin.saveSettings();
        await this.writeTimerMetadata(file, 'running', now);
        await this.syncOpenView();
        return { ok: true, status: this.getStatus() || undefined };
    }

    private async pauseSession(): Promise<TimerActionResult> {
        const active = this.plugin.settings.activeTimer;
        if (!active) return { ok: false, reason: 'not-running' };
        active.elapsedSeconds = this.elapsedSeconds();
        active.timerState = 'paused';
        active.lastStartedAt = undefined;
        await this.plugin.saveSettings();
        const file = this.plugin.app.vault.getAbstractFileByPath(active.path);
        if (file instanceof TFile) await this.writeTimerMetadata(file, 'paused', Date.now());
        await this.syncOpenView();
        return { ok: true, status: this.getStatus() || undefined };
    }

    private async resumeSession(): Promise<TimerActionResult> {
        const active = this.plugin.settings.activeTimer;
        if (!active) return { ok: false, reason: 'not-running' };
        if (active.pendingCommit) return { ok: false, reason: 'not-running' };
        if ((active.timerState || 'running') === 'running') return { ok: true, status: this.getStatus() || undefined };
        active.timerState = 'running';
        active.lastStartedAt = Date.now();
        await this.plugin.saveSettings();
        const file = this.plugin.app.vault.getAbstractFileByPath(active.path);
        if (file instanceof TFile) await this.writeTimerMetadata(file, 'running', active.lastStartedAt);
        await this.syncOpenView();
        return { ok: true, status: this.getStatus() || undefined };
    }

    private async finishSession(): Promise<TimerActionResult> {
        const active = this.plugin.settings.activeTimer;
        if (!active) return { ok: false, reason: 'not-running' };
        if (active.source !== 'telegram') return { ok: false, reason: 'obsidian-session' };
        const elapsedSeconds = this.elapsedSeconds();
        if (elapsedSeconds <= 0) return { ok: false, reason: 'empty' };

        const file = this.plugin.app.vault.getAbstractFileByPath(active.path);
        if (!(file instanceof TFile)) return { ok: false, reason: 'daily-note' };
        await this.suspendOpenView();
        active.elapsedSeconds = elapsedSeconds;
        active.timerState = 'paused';
        active.lastStartedAt = undefined;
        await this.plugin.saveSettings();
        await this.writeTimerMetadata(file, 'paused', Date.now());
        await commitTimerSession(this.plugin, {
            dailyNote: file, habitName: active.habitName, displayProperty: active.habitName,
            durationSeconds: elapsedSeconds, progressAdded: null, note: '', mediaPath: null,
            mode: 'timer', logMode: 'Telegram', sessionStartTime: active.startTime
        });
        await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
            const fm = frontmatter as Record<string, unknown>;
            this.clearTimerMetadata(fm);
        });

        this.plugin.settings.activeTimer = undefined;
        await this.plugin.saveSettings();
        await this.resetOpenView();
        return { ok: true, elapsedSeconds };
    }

    private async cancelSession(): Promise<TimerActionResult> {
        const active = this.plugin.settings.activeTimer;
        if (!active) return { ok: false, reason: 'not-running' };
        await this.suspendOpenView();
        const file = this.plugin.app.vault.getAbstractFileByPath(active.path);
        if (file instanceof TFile) {
            await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
                this.clearTimerMetadata(frontmatter as Record<string, unknown>);
            });
        }
        this.plugin.settings.activeTimer = undefined;
        await this.plugin.saveSettings();
        await this.resetOpenView();
        return { ok: true };
    }

    async finishWhenTargetReached(): Promise<TimerActionResult | null> {
        const status = this.getStatus();
        if (!status || status.state !== 'running' || !status.targetSeconds || status.elapsedSeconds < status.targetSeconds) return null;
        return this.finish();
    }

    private elapsedSeconds(now = Date.now()): number {
        const active = this.plugin.settings.activeTimer;
        if (!active) return 0;
        return getTelegramTimerProgress(active, now).elapsedSeconds;
    }

    private async writeTimerMetadata(file: TFile, state: 'running' | 'paused', now: number): Promise<void> {
        const active = this.plugin.settings.activeTimer;
        if (!active) return;
        await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
            const fm = frontmatter as Record<string, unknown>;
            fm.timer_active = true;
            fm.timer_state = state;
            fm.timer_start_time = active.startTime;
            fm.timer_habit = active.habitName;
            fm.timer_elapsed_seconds = this.elapsedSeconds(now);
            if (state === 'running') fm.timer_start_ts = now;
            else delete fm.timer_start_ts;
        });
    }

    private clearTimerMetadata(fm: Record<string, unknown>): void {
        for (const key of [
            'timer_active', 'timer_state', 'timer_start_ts', 'timer_start_time',
            'timer_habit', 'timer_task_name', 'timer_elapsed_seconds', 'timer_remaining_seconds'
        ]) delete fm[key];
    }

    private getOpenView(): TimerView | null {
        const view = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TIMER)[0]?.view;
        return view instanceof TimerView ? view : null;
    }

    private async suspendOpenView(): Promise<void> {
        (this.getOpenView()?.engine || this.plugin.persistentTimerEngine)?.suspend();
    }

    private async syncOpenView(): Promise<void> {
        const view = this.getOpenView();
        const engine = view?.engine || this.plugin.persistentTimerEngine;
        if (!engine) return;
        engine.suspend();
        await engine.recoverActiveTimer(true);
        if (view) await view.refresh();
    }

    private async resetOpenView(): Promise<void> {
        const view = this.getOpenView();
        const engine = view?.engine || this.plugin.persistentTimerEngine;
        if (!engine) return;
        await engine.reset();
        if (view) await view.refresh();
    }

}
