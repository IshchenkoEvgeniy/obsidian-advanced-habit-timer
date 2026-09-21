import { moment } from 'obsidian';
import { HabitWidget } from '../types';
import { getDailyNotes, parseDuration } from '../../utils';
import { getHabitValueFromFrontmatter } from '../../services/habit-service';

/**
 * Widget 3 — Stats Summary (default 2×2)
 * Shows: Сегодня / Неделя / Месяц / Квартал / Год
 * Mirrors the right widget from the screenshot
 */
export class StatsSummaryWidget extends HabitWidget {

    async render(): Promise<void> {
        this.container.empty();
        this.container.addClass('ht-widget-stats');

        const prop = this.plugin.settings.properties.find(p => p.name === this.habitName);
        if (!prop) {
            this.container.createDiv({ cls: 'ht-widget-error', text: 'Привычка не найдена' });
            return;
        }

        // --- Header ---
        const shortName = this.habitName.replace(/^Habit-/i, '');
        this.container.createDiv({ cls: 'ht-widget-header ht-widget-stats-header' })
            .createDiv({ cls: 'ht-widget-title', text: shortName });

        // --- Aggregate data from daily notes ---
        const todayStr = moment().format('YYYY-MM-DD');
        const weekStart = moment().startOf('isoWeek').format('YYYY-MM-DD');
        const monthStart = moment().startOf('month').format('YYYY-MM-DD');
        const quarterStart = moment().startOf('quarter').format('YYYY-MM-DD');
        const yearStart = moment().startOf('year').format('YYYY-MM-DD');

        let todaySec = 0, weekSec = 0, monthSec = 0, quarterSec = 0, yearSec = 0;

        const dailyNotes = getDailyNotes(this.plugin.app, this.plugin.settings.dailyNotesFolder);

        for (const file of dailyNotes) {
            const d = file.basename;
            if (d > todayStr || d < yearStart) continue;

            const cache = this.plugin.app.metadataCache.getFileCache(file);
            if (!cache?.frontmatter) continue;

            const val = getHabitValueFromFrontmatter(cache.frontmatter, prop);
            if (val <= 0) continue;

            if (d === todayStr) todaySec += val;
            if (d >= weekStart) weekSec += val;
            if (d >= monthStart) monthSec += val;
            if (d >= quarterStart) quarterSec += val;
            yearSec += val;
        }

        // --- Rows ---
        const type = prop.type || 'timer';

        const rows: { label: string; value: number }[] = [
            { label: 'Сегодня', value: todaySec },
            { label: 'Неделя',  value: weekSec  },
            { label: 'Месяц',   value: monthSec  },
            { label: 'Квартал', value: quarterSec },
            { label: 'Год',     value: yearSec   },
        ];

        const table = this.container.createDiv({ cls: 'ht-stats-table' });

        rows.forEach(row => {
            const rowEl = table.createDiv({ cls: 'ht-stats-row' });
            rowEl.createDiv({ cls: 'ht-stats-label', text: row.label });
            const valEl = rowEl.createDiv({ cls: 'ht-stats-value' });
            valEl.createDiv({
                cls: 'ht-stats-pill',
                text: this.formatValue(row.value, type),
            });
        });

        // tap → stats view
        this.container.setCssStyles({ cursor: 'pointer' });
        this.container.onclick = () => {
            (this.plugin as any).activateView('habit-timer-stats-view');
        };
    }

    private formatValue(sec: number, type: string): string {
        if (type !== 'timer') return String(sec);
        const mins = Math.floor(sec / 60);
        if (mins === 0) return '0';
        if (mins < 1000) return String(mins);
        // e.g. 2700 → "2,7k"
        return `${(mins / 1000).toFixed(1).replace('.', ',')}k`;
    }
}
