import { moment } from 'obsidian';
import { HabitWidget } from '../types';
import { getDailyNotes } from '../../utils';
import { getHabitValueFromFrontmatter } from '../../services/habit-service';
import { evaluateHabitState, getHabitGoals, readHabitExplicitState, statePreservesStreak } from '../../habits/goals';
import type { HabitExplicitState } from '../../types';

/**
 * Widget 2 — Calendar Heatmap (default 2×2)
 * 5-week grid, day-of-week labels on right, month header
 * Mirrors the middle widget from the screenshot
 */
export class CalendarHeatmapWidget extends HabitWidget {

    async render(): Promise<void> {
        this.container.empty();
        this.container.addClass('ht-widget-calendar');

        const prop = this.plugin.settings.properties.find(p => p.name === this.habitName);
        if (!prop) {
            this.container.createDiv({ cls: 'ht-widget-error', text: 'Привычка не найдена' });
            return;
        }

        // --- Load last 5 weeks of data ---
        const WEEKS = 5;
        const DAYS = WEEKS * 7;
        const todayStr = moment().format('YYYY-MM-DD');

        // Build date → value map from daily notes
        const valueMap = new Map<string, number>();
        const stateMap = new Map<string, HabitExplicitState | null>();
        const dailyNotes = getDailyNotes(this.plugin.app, this.plugin.settings.dailyNotesFolder);
        for (const file of dailyNotes) {
            const d = file.basename;
            const startStr = moment().subtract(DAYS, 'days').format('YYYY-MM-DD');
            if (d < startStr || d > todayStr) continue;
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter) {
                valueMap.set(d, getHabitValueFromFrontmatter(cache.frontmatter, prop));
                stateMap.set(d, readHabitExplicitState(cache.frontmatter, prop.name));
            }
        }

        // --- Header ---
        const header = this.container.createDiv({ cls: 'ht-widget-header' });
        const shortName = this.habitName.replace(/^Habit-/i, '');
        header.createDiv({ cls: 'ht-widget-title', text: shortName });

        // Date range subtitle
        const startOfGrid = moment().startOf('week').subtract(WEEKS - 1, 'weeks');
        const subtitle = `${startOfGrid.format('MMM')}. ${moment().format('MMM')} ${moment().format('YYYY')}`;
        header.createDiv({ cls: 'ht-widget-subtitle', text: subtitle });

        // --- Calendar grid (like screenshot: columns = weeks, rows = days) ---
        // We draw: 7 rows × WEEKS cols, day-of-week labels on the RIGHT
        const gridWrap = this.container.createDiv({ cls: 'ht-cal-grid-wrap' });
        const grid = gridWrap.createDiv({ cls: 'ht-cal-grid' });

        // Build weeks array (Sunday first, but display Mon–Sun)
        const weeks: string[][] = [];
        let curr = moment(startOfGrid);
        for (let w = 0; w < WEEKS; w++) {
            const week: string[] = [];
            for (let d = 0; d < 7; d++) {
                week.push(curr.format('YYYY-MM-DD'));
                curr.add(1, 'days');
            }
            weeks.push(week);
        }

        // Render columns (one per week)
        weeks.forEach(weekDates => {
            const col = grid.createDiv({ cls: 'ht-cal-week-col' });

            // First cell: month label for first day of month
            const firstInMonth = weekDates.find(d => moment(d).date() === 1);
            const monthLabel = col.createDiv({ cls: 'ht-cal-month-label' });
            if (firstInMonth) {
                monthLabel.setText(moment(firstInMonth).format('D'));
            }

            weekDates.forEach((dateStr, dayIdx) => {
                const val = valueMap.get(dateStr) ?? 0;
                const isToday = dateStr === todayStr;
                const isFuture = dateStr > todayStr;
                const goals = getHabitGoals(prop, dateStr);
                const weeklyValue = goals.mode === 'weekly'
                    ? weekDates.reduce((sum, date) => sum + (valueMap.get(date) || 0), 0)
                    : undefined;
                const state = evaluateHabitState(prop, val, dateStr, stateMap.get(dateStr) || null, weeklyValue);
                const met = !isFuture && statePreservesStreak(state);
                const hasAny = val > 0;

                const cell = col.createDiv({ cls: 'ht-cal-cell' });
                if (isToday) cell.addClass('ht-cal-today');
                if (isFuture) {
                    cell.addClass('ht-cal-future');
                } else if (hasAny || valueMap.has(dateStr)) {
                    const ratio = Math.min((goals.mode === 'weekly' ? (weeklyValue || 0) : val) / Math.max(goals.desired, 1), 1);
                    if (met) {
                        cell.addClass(ratio >= 1.5 ? 'ht-cal-lvl4' : ratio >= 0.75 ? 'ht-cal-lvl3' : 'ht-cal-lvl2');
                    } else if (hasAny) {
                        cell.addClass('ht-cal-lvl1');
                    } else {
                        cell.addClass('ht-cal-miss');
                    }
                }

                const label = val > 0
                    ? (prop.type || 'timer') === 'timer'
                        ? `${Math.floor(val / 60)}м`
                        : String(val)
                    : '';
                cell.setAttribute('title', `${dateStr}${label ? ': ' + label : ''}`);

                cell.onclick = () => {
                    // Navigate to stats detail for this day
                    (this.plugin as any).activateView('habit-timer-stats-view');
                };
            });
        });

        // Day-of-week labels on the right
        const dayLabels = gridWrap.createDiv({ cls: 'ht-cal-day-labels' });
        const DAY_NAMES_RU = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
        // empty top spacer to align with month labels row
        dayLabels.createDiv({ cls: 'ht-cal-day-spacer' });
        DAY_NAMES_RU.forEach(name => {
            dayLabels.createDiv({ cls: 'ht-cal-day-name', text: name });
        });
    }
}
