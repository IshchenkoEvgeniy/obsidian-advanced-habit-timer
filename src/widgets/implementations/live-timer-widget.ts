import { moment } from 'obsidian';
import { HabitWidget } from '../types';
import { parseDuration, formatDuration } from '../../utils';

/**
 * Widget 4 — Live Timer (default 2×1)
 * Shows active session countdown / elapsed time in real-time
 */
export class LiveTimerWidget extends HabitWidget {
    private _tickInterval: number | null = null;

    async render(): Promise<void> {
        this.container.empty();
        this.container.addClass('ht-widget-live-timer');

        const active = this.plugin.settings.activeTimer;

        if (!active) {
            this._renderIdle();
            return;
        }

        const prop = this.plugin.settings.properties.find(p => p.name === active.habitName);
        const isPomodoro = active.mode === 'pm';
        const startTime = moment(active.startTime);
        const elapsed = moment().diff(startTime, 'seconds');
        const totalGoalSec = isPomodoro
            ? this.plugin.settings.pomodoroDuration * 60
            : (prop?.goalMinutes || 60) * 60;

        const displaySec = isPomodoro
            ? Math.max(0, totalGoalSec - elapsed)
            : elapsed;

        // Header row
        const header = this.container.createDiv({ cls: 'ht-lt-header' });
        const dot = header.createDiv({ cls: 'ht-lt-live-dot' });
        const titleWrap = header.createDiv({ cls: 'ht-lt-title-wrap' });
        titleWrap.createDiv({
            cls: 'ht-lt-habit-name',
            text: active.habitName.replace(/^Habit-/i, ''),
        });
        if (active.subTask) {
            titleWrap.createDiv({ cls: 'ht-lt-subtask', text: active.subTask });
        }

        // Big countdown
        const countdown = this.container.createDiv({ cls: 'ht-lt-countdown' });
        countdown.setAttribute('id', 'ht-lt-countdown-' + active.habitName);
        countdown.setText(formatDuration(displaySec));

        // Progress bar
        const perc = Math.min(elapsed / Math.max(totalGoalSec, 1), 1);
        const pbWrap = this.container.createDiv({ cls: 'ht-lt-progress-wrap' });
        const pb = pbWrap.createDiv({ cls: 'ht-lt-progress' });
        pb.setCssStyles({ width: `${Math.round(perc * 100)}%` });
        if (perc >= 1) pb.addClass('ht-lt-progress-done');

        const label = pbWrap.createDiv({
            cls: 'ht-lt-progress-label',
            text: `${Math.floor(elapsed / 60)}м / ${Math.floor(totalGoalSec / 60)}м`,
        });

        // Buttons
        const btns = this.container.createDiv({ cls: 'ht-lt-btns' });
        const openBtn = btns.createEl('button', { cls: 'ht-lt-btn', text: '▶ Открыть' });
        openBtn.onclick = () => this.plugin.activateView('habit-timer-view');

        // Start real-time tick
        this._startTick();
    }

    private _renderIdle(): void {
        const idle = this.container.createDiv({ cls: 'ht-lt-idle' });
        idle.createDiv({ cls: 'ht-lt-idle-icon', text: '⏱️' });
        idle.createDiv({ cls: 'ht-lt-idle-text', text: 'Нет активной сессии' });
        const btn = idle.createEl('button', { cls: 'ht-lt-btn ht-lt-btn-start', text: '▶ Начать' });
        btn.onclick = () => void (this.plugin as any).activateView('habit-timer-view');
    }

    private _startTick(): void {
        if (this._tickInterval !== null) window.clearInterval(this._tickInterval);
        this._tickInterval = window.setInterval(() => {
            const active = this.plugin.settings.activeTimer;
            if (!active) {
                window.clearInterval(this._tickInterval!);
                this._tickInterval = null;
                void this.render();
                return;
            }
            const el = document.getElementById('ht-lt-countdown-' + active.habitName);
            if (!el) return;
            const elapsed = moment().diff(moment(active.startTime), 'seconds');
            const isPomodoro = active.mode === 'pm';
            const totalGoalSec = isPomodoro
                ? this.plugin.settings.pomodoroDuration * 60
                : (this.plugin.settings.properties.find(p => p.name === active.habitName)?.goalMinutes || 60) * 60;
            const displaySec = isPomodoro ? Math.max(0, totalGoalSec - elapsed) : elapsed;
            el.setText(formatDuration(displaySec));
        }, 1000);
    }

    destroy(): void {
        if (this._tickInterval !== null) {
            window.clearInterval(this._tickInterval);
            this._tickInterval = null;
        }
        super.destroy();
    }
}
