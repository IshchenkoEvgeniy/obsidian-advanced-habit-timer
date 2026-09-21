import type { HabitDayState } from '../types';
import type { HabitSnapshot } from './habit-snapshot-service';
import { formatDurationShort } from '../utils';

const COLORS = {
    background: '#171821',
    surface: '#22242f',
    border: '#353847',
    text: '#f4f4f6',
    muted: '#a5a7b2',
    accent: '#9b6cff',
    completed: '#43c878',
    partial: '#e0ad4f',
    missed: '#4a4d59',
    skipped: '#d26464',
    neutral: '#657080'
} as const;

export class TelegramCardRenderer {
    constructor(private language: 'en' | 'ru') {}

    async renderHabit(snapshot: HabitSnapshot): Promise<ArrayBuffer> {
        const canvas = this.createCanvas(1200, 760);
        const ctx = this.context(canvas);
        this.background(ctx, canvas);
        const ru = this.language === 'ru';

        ctx.fillStyle = COLORS.muted;
        ctx.font = '600 24px sans-serif';
        ctx.fillText(ru ? 'КАРТА ПРИВЫЧКИ' : 'HABIT MAP', 64, 70);
        ctx.fillStyle = COLORS.text;
        ctx.font = '700 48px sans-serif';
        ctx.fillText(this.trim(ctx, snapshot.property.name, 1040), 64, 132);

        this.metric(ctx, 64, 180, ru ? 'Текущий стрик' : 'Current streak', String(snapshot.currentStreak));
        this.metric(ctx, 334, 180, ru ? 'Лучший стрик' : 'Best streak', String(snapshot.bestStreak));
        this.metric(ctx, 604, 180, ru ? 'Выполнение' : 'Completion', `${snapshot.completionRate}%`);
        this.metric(ctx, 874, 180, ru ? 'Среднее' : 'Average', this.value(snapshot, snapshot.average));

        ctx.fillStyle = COLORS.text;
        ctx.font = '600 26px sans-serif';
        ctx.fillText(ru ? 'Последние 12 недель' : 'Last 12 weeks', 64, 366);
        this.drawHeatmap(ctx, snapshot.days.slice(-84), 64, 405, 30, 10);

        const progress = Math.min(1, snapshot.today.value / Math.max(1, snapshot.today.desired));
        ctx.fillStyle = COLORS.muted;
        ctx.font = '500 22px sans-serif';
        ctx.fillText(ru ? 'Сегодня' : 'Today', 64, 690);
        ctx.fillStyle = COLORS.border;
        ctx.fillRect(170, 672, 790, 22);
        ctx.fillStyle = this.stateColor(snapshot.today.state);
        ctx.fillRect(170, 672, 790 * progress, 22);
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'right';
        ctx.fillText(`${this.value(snapshot, snapshot.today.value)} / ${this.value(snapshot, snapshot.today.desired)}`, 1136, 693);
        ctx.textAlign = 'left';
        return this.toArrayBuffer(canvas);
    }

    async renderDaily(snapshots: HabitSnapshot[], dateLabel: string): Promise<ArrayBuffer> {
        const visible = snapshots.slice(0, 14);
        const height = Math.max(660, 230 + visible.length * 82);
        const canvas = this.createCanvas(1200, height);
        const ctx = this.context(canvas);
        this.background(ctx, canvas);
        const ru = this.language === 'ru';
        const completed = snapshots.filter(value => value.today.state === 'completed').length;
        const partial = snapshots.filter(value => value.today.state === 'partial').length;
        const score = snapshots.length > 0 ? Math.round((completed + partial * 0.5) / snapshots.length * 100) : 0;

        ctx.fillStyle = COLORS.muted;
        ctx.font = '600 24px sans-serif';
        ctx.fillText(ru ? 'ИТОГИ ДНЯ' : 'DAILY SUMMARY', 64, 62);
        ctx.fillStyle = COLORS.text;
        ctx.font = '700 46px sans-serif';
        ctx.fillText(dateLabel, 64, 120);
        ctx.fillStyle = COLORS.accent;
        ctx.font = '700 64px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${score}%`, 1136, 118);
        ctx.textAlign = 'left';
        ctx.fillStyle = COLORS.muted;
        ctx.font = '500 21px sans-serif';
        ctx.fillText(`${ru ? 'Выполнено' : 'Completed'}: ${completed}   ${ru ? 'Частично' : 'Partial'}: ${partial}   ${ru ? 'Всего' : 'Total'}: ${snapshots.length}`, 64, 164);

        let y = 218;
        for (const snapshot of visible) {
            ctx.fillStyle = COLORS.surface;
            ctx.fillRect(48, y - 35, 1104, 68);
            ctx.fillStyle = this.stateColor(snapshot.today.state);
            ctx.fillRect(48, y - 35, 8, 68);
            ctx.fillStyle = COLORS.text;
            ctx.font = '600 21px sans-serif';
            ctx.fillText(this.trim(ctx, snapshot.property.name, 330), 76, y - 4);
            ctx.fillStyle = COLORS.muted;
            ctx.font = '500 17px sans-serif';
            ctx.fillText(`${this.value(snapshot, snapshot.today.value)} / ${this.value(snapshot, snapshot.today.desired)}`, 76, y + 20);
            this.drawStrip(ctx, snapshot.days.slice(-28), 470, y - 8, 14, 4);
            ctx.fillStyle = COLORS.text;
            ctx.font = '600 18px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(
                `${ru ? 'Стрик' : 'Streak'} ${snapshot.currentStreak}  |  ${ru ? 'Ср.' : 'Avg'} ${this.value(snapshot, snapshot.average)}  |  ${snapshot.completionRate}%`,
                1120, y + 24
            );
            ctx.textAlign = 'left';
            y += 82;
        }
        if (snapshots.length > visible.length) {
            ctx.fillStyle = COLORS.muted;
            ctx.font = '500 18px sans-serif';
            ctx.fillText(`${ru ? 'Ещё привычек' : 'More habits'}: ${snapshots.length - visible.length}`, 64, height - 32);
        }
        return this.toArrayBuffer(canvas);
    }

    private metric(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, value: string): void {
        ctx.fillStyle = COLORS.surface;
        ctx.fillRect(x, y, 238, 130);
        ctx.fillStyle = COLORS.accent;
        ctx.font = '700 40px sans-serif';
        ctx.fillText(value, x + 20, y + 56);
        ctx.fillStyle = COLORS.muted;
        ctx.font = '500 19px sans-serif';
        ctx.fillText(label, x + 20, y + 94);
    }

    private drawHeatmap(ctx: CanvasRenderingContext2D, days: HabitSnapshot['days'], x: number, y: number, size: number, gap: number): void {
        const firstDay = days[0] ? new Date(`${days[0].date}T12:00:00`).getDay() : 1;
        const mondayOffset = (firstDay + 6) % 7;
        days.forEach((day, index) => {
            const alignedIndex = index + mondayOffset;
            const col = Math.floor(alignedIndex / 7);
            const row = alignedIndex % 7;
            ctx.fillStyle = this.stateColor(day.state);
            ctx.fillRect(x + col * (size + gap), y + row * (size + gap), size, size);
        });
    }

    private drawStrip(ctx: CanvasRenderingContext2D, days: HabitSnapshot['days'], x: number, y: number, size: number, gap: number): void {
        days.forEach((day, index) => {
            ctx.fillStyle = this.stateColor(day.state);
            ctx.fillRect(x + index * (size + gap), y, size, size);
        });
    }

    private stateColor(state: HabitDayState): string {
        if (state === 'completed') return COLORS.completed;
        if (state === 'partial') return COLORS.partial;
        if (state === 'skipped') return COLORS.skipped;
        if (state === 'excused' || state === 'deferred') return COLORS.neutral;
        return COLORS.missed;
    }

    private value(snapshot: HabitSnapshot, value: number): string {
        return (snapshot.property.type || 'timer') === 'timer'
            ? formatDurationShort(Math.round(value), this.language)
            : String(Math.round(value * 10) / 10);
    }

    private createCanvas(width: number, height: number): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    private context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is not available');
        return ctx;
    }

    private background(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
        ctx.fillStyle = COLORS.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = COLORS.border;
        ctx.lineWidth = 2;
        ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);
    }

    private trim(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
        if (ctx.measureText(value).width <= maxWidth) return value;
        let result = value;
        while (result.length > 1 && ctx.measureText(`${result}...`).width > maxWidth) result = result.slice(0, -1);
        return `${result}...`;
    }

    private async toArrayBuffer(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Could not render Telegram card');
        return blob.arrayBuffer();
    }
}
