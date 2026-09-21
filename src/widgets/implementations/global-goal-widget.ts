import { moment } from 'obsidian';
import { HabitWidget } from '../types';
import { getDailyNotes } from '../../utils';
import { getHabitValueFromFrontmatter } from '../../services/habit-service';
import { getHabitGoals } from '../../habits/goals';

/**
 * Widget 6 — Global Goal (default 2×2)
 * Progress bar toward globalGoalHours + pace forecast
 */
export class GlobalGoalWidget extends HabitWidget {

    async render(): Promise<void> {
        this.container.empty();
        this.container.addClass('ht-widget-global-goal');

        const prop = this.plugin.settings.properties.find(p => p.name === this.habitName);
        if (!prop || prop.type !== 'timer') {
            this.container.createDiv({ cls: 'ht-widget-error', text: 'Только для timer-привычек' });
            return;
        }

        const goalSec = (prop.globalGoalHours || 1000) * 3600;

        // Sum all history
        let totalSec = 0;
        const last30Map = new Map<string, number>();
        const cutoff30 = moment().subtract(30, 'days').format('YYYY-MM-DD');
        const todayStr = moment().format('YYYY-MM-DD');

        const dailyNotes = getDailyNotes(this.plugin.app, this.plugin.settings.dailyNotesFolder);
        for (const file of dailyNotes) {
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            if (!cache?.frontmatter) continue;
            const val = getHabitValueFromFrontmatter(cache.frontmatter, prop);
            totalSec += val;
            if (file.basename >= cutoff30) last30Map.set(file.basename, val);
        }

        const perc = Math.min(totalSec / Math.max(goalSec, 1), 1);
        const percPct = Math.round(perc * 100);
        const totalHours = Math.floor(totalSec / 3600);
        const goalHours = prop.globalGoalHours || 1000;

        // Forecast: average daily rate over last 30 days
        let forecast = '—';
        if (last30Map.size > 0) {
            const avgDaySec = Array.from(last30Map.values()).reduce((a, b) => a + b, 0) / 30;
            if (avgDaySec > 0) {
                const remainSec = Math.max(goalSec - totalSec, 0);
                const daysLeft = Math.ceil(remainSec / avgDaySec);
                if (daysLeft < 365) {
                    forecast = `~${daysLeft} дн.`;
                } else {
                    const years = (daysLeft / 365).toFixed(1);
                    forecast = `~${years} лет`;
                }
            }
        }

        // Header
        const shortName = this.habitName.replace(/^Habit-/i, '');
        const header = this.container.createDiv({ cls: 'ht-widget-header' });
        header.createDiv({ cls: 'ht-widget-title', text: shortName });
        header.createDiv({ cls: 'ht-widget-subtitle', text: '🎯 Глобальная цель' });

        // Big percentage
        const percEl = this.container.createDiv({ cls: 'ht-goal-perc' });
        percEl.setText(`${percPct}%`);
        if (percPct >= 75) percEl.addClass('ht-goal-perc-high');
        else if (percPct >= 40) percEl.addClass('ht-goal-perc-mid');
        else percEl.addClass('ht-goal-perc-low');

        // Progress bar
        const pbWrap = this.container.createDiv({ cls: 'ht-goal-pb-wrap' });
        const pb = pbWrap.createDiv({ cls: 'ht-goal-pb' });
        pb.setCssStyles({ width: `${Math.round(perc * 100)}%` });
        if (percPct >= 75) pb.addClass('ht-goal-pb-high');
        else if (percPct >= 40) pb.addClass('ht-goal-pb-mid');
        else pb.addClass('ht-goal-pb-low');

        // Numbers row
        const nums = this.container.createDiv({ cls: 'ht-goal-nums' });
        nums.createDiv({ cls: 'ht-goal-done', text: `${totalHours}ч` });
        nums.createDiv({ cls: 'ht-goal-separator', text: '/' });
        nums.createDiv({ cls: 'ht-goal-total', text: `${goalHours}ч` });

        // Forecast
        this.container.createDiv({
            cls: 'ht-goal-forecast',
            text: forecast !== '—' ? `До цели: ${forecast}` : 'Нет данных за 30 дней',
        });

        // Mini 30-day sparkline
        this.renderSparkline();
    }

    private renderSparkline(): void {
        const prop = this.plugin.settings.properties.find(p => p.name === this.habitName);
        if (!prop) return;

        const spark = this.container.createDiv({ cls: 'ht-goal-sparkline' });
        const last30: number[] = [];
        const allNotes = getDailyNotes(this.plugin.app, this.plugin.settings.dailyNotesFolder);
        const noteMap = new Map(allNotes.map(f => [f.basename, f]));

        for (let i = 29; i >= 0; i--) {
            const d = moment().subtract(i, 'days').format('YYYY-MM-DD');
            const note = noteMap.get(d) ?? null;
            let val = 0;
            if (note) {
                const cache = this.plugin.app.metadataCache.getFileCache(note);
                if (cache?.frontmatter) val = getHabitValueFromFrontmatter(cache.frontmatter, prop);
            }
            last30.push(val);
        }

        const maxVal = Math.max(...last30, 1);
        last30.forEach((val, index) => {
            const date = moment().subtract(29 - index, 'days').format('YYYY-MM-DD');
            const goalSec = getHabitGoals(prop, date).desired;
            const bar = spark.createDiv({ cls: 'ht-goal-spark-bar' });
            bar.setCssStyles({ height: `${Math.max((val / maxVal) * 100, val > 0 ? 8 : 0)}%` });
            if (val >= goalSec) bar.addClass('ht-goal-spark-met');
            else if (val > 0) bar.addClass('ht-goal-spark-partial');
        });
    }
}
