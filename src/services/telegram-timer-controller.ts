import { moment, TFile } from 'obsidian';
import type HabitTimerPlugin from '../main';
import { formatDuration, getString, parseDuration } from '../utils';
import {
    getHabitDeferredAmountKey, getHabitDeferredToKey, getHabitStateKey
} from '../habits/goals';
import { TimerView, VIEW_TYPE_TIMER } from '../timer/timer-view';
import { getTelegramTimerProgress } from './telegram-timer-state';

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
    constructor(private plugin: HabitTimerPlugin) {}

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

    async start(habitName: string, targetMinutes?: number): Promise<TimerActionResult> {
        if (this.plugin.settings.activeTimer) return { ok: false, reason: 'active' };
        const prop = this.plugin.settings.properties.find(value => value.name === habitName);
        if (!prop || (prop.type || 'timer') !== 'timer') return { ok: false, reason: 'not-found' };
        const file = await this.plugin.dailyNotes.ensureNote(moment().format('YYYY-MM-DD'));
        if (!file) return { ok: false, reason: 'daily-note' };

        const now = Date.now();
        this.plugin.settings.activeTimer = {
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

    async pause(): Promise<TimerActionResult> {
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

    async resume(): Promise<TimerActionResult> {
        const active = this.plugin.settings.activeTimer;
        if (!active) return { ok: false, reason: 'not-running' };
        active.timerState = 'running';
        active.lastStartedAt = Date.now();
        await this.plugin.saveSettings();
        const file = this.plugin.app.vault.getAbstractFileByPath(active.path);
        if (file instanceof TFile) await this.writeTimerMetadata(file, 'running', active.lastStartedAt);
        await this.syncOpenView();
        return { ok: true, status: this.getStatus() || undefined };
    }

    async finish(): Promise<TimerActionResult> {
        const active = this.plugin.settings.activeTimer;
        if (!active) return { ok: false, reason: 'not-running' };
        if (active.source !== 'telegram') return { ok: false, reason: 'obsidian-session' };
        const elapsedSeconds = this.elapsedSeconds();
        if (elapsedSeconds <= 0) return { ok: false, reason: 'empty' };

        const file = this.plugin.app.vault.getAbstractFileByPath(active.path);
        if (!(file instanceof TFile)) return { ok: false, reason: 'daily-note' };
        await this.suspendOpenView();
        await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
            const fm = frontmatter as Record<string, unknown>;
            const current = parseDuration(fm[active.habitName]);
            fm[active.habitName] = formatDuration(current + elapsedSeconds);
            delete fm[getHabitStateKey(active.habitName)];
            delete fm[getHabitDeferredToKey(active.habitName)];
            delete fm[getHabitDeferredAmountKey(active.habitName)];
            this.clearTimerMetadata(fm);
        });

        const start = active.startTime || moment().format('HH:mm');
        const end = moment().format('HH:mm');
        await this.plugin.app.vault.process(file, content => {
            let next = content;
            if (!next.includes('| Time | Mode | Property | Duration | Pages | Task |')) {
                next = `${next.trimEnd()}\n\n### Session Log\n| Time | Mode | Property | Duration | Pages | Task |\n|---|---|---|---|---|---|\n`;
            }
            return `${next.trimEnd()}\n| ${start} - ${end} | Telegram | ${this.escapeCell(active.habitName)} | ${formatDuration(elapsedSeconds)} | - | - |\n`;
        });

        this.plugin.settings.activeTimer = undefined;
        await this.plugin.saveSettings();
        await this.resetOpenView();
        await this.plugin.updateDailyNoteProjectLog(moment().format('YYYY-MM-DD'));
        return { ok: true, elapsedSeconds };
    }

    async cancel(): Promise<TimerActionResult> {
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
        this.getOpenView()?.engine.suspend();
    }

    private async syncOpenView(): Promise<void> {
        const view = this.getOpenView();
        if (!view) return;
        view.engine.suspend();
        await view.engine.recoverActiveTimer(true);
        await view.refresh();
    }

    private async resetOpenView(): Promise<void> {
        const view = this.getOpenView();
        if (!view) return;
        await view.engine.reset();
        await view.refresh();
    }

    private escapeCell(value: string): string {
        return getString(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
    }
}
