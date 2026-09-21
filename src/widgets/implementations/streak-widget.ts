import { moment } from 'obsidian';
import { HabitWidget } from '../types';
import { getDailyNotes } from '../../utils';
import { getHabitValueFromFrontmatter, calculateHabitStreak } from '../../services/habit-service';
import { evaluateHabitState, getHabitGoals, readHabitExplicitState, statePreservesStreak } from '../../habits/goals';
import type { HabitDayState, HabitExplicitState } from '../../types';

/**
 * Widget 5 — Streak (default 1×2)
 * Current streak + best streak + 7-day mini histogram
 */
export class StreakWidget extends HabitWidget {

    async render(): Promise<void> {
        this.container.empty();
        this.container.addClass('ht-widget-streak');

        const prop = this.plugin.settings.properties.find(p => p.name === this.habitName);
        if (!prop) {
            this.container.createDiv({ cls: 'ht-widget-error', text: 'Привычка не найдена' });
            return;
        }

        const todayStr = moment().format('YYYY-MM-DD');

        // Load last 7 days data
        const allNotes = getDailyNotes(this.plugin.app, this.plugin.settings.dailyNotesFolder);
        const noteMap = new Map(allNotes.map(f => [f.basename, f]));

        const last7: { date: string; val: number; state: HabitDayState; explicit: HabitExplicitState | null }[] = [];
        for (let i = 6; i >= 0; i--) {
            const d = moment().subtract(i, 'days').format('YYYY-MM-DD');
            const note = noteMap.get(d) ?? null;
            let val = 0;
            let explicit: HabitExplicitState | null = null;
            if (note) {
                const cache = this.plugin.app.metadataCache.getFileCache(note);
                if (cache?.frontmatter) {
                    val = getHabitValueFromFrontmatter(cache.frontmatter, prop);
                    explicit = readHabitExplicitState(cache.frontmatter, prop.name);
                }
            }
            last7.push({ date: d, val, explicit, state: evaluateHabitState(prop, val, d, explicit) });
        }
        if ((prop.goalMode || 'daily') === 'weekly') {
            last7.forEach(entry => {
                const weeklyValue = allNotes.reduce((sum, file) => {
                    if (!moment(file.basename).isSame(moment(entry.date), 'isoWeek')) return sum;
                    const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
                    return fm ? sum + getHabitValueFromFrontmatter(fm, prop) : sum;
                }, 0);
                entry.state = evaluateHabitState(prop, entry.val, entry.date, entry.explicit, weeklyValue);
            });
        }

        // Compute current streak
        const currentStreak = await calculateHabitStreak(this.plugin.app, this.plugin.settings.dailyNotesFolder, prop);

        // Compute best streak from all history
        const bestStreak = await this._getBestStreak(prop);

        const isBroken = last7.some(d => d.date < todayStr && !statePreservesStreak(d.state));
        const isHot = currentStreak >= 7;

        // --- Flame icon + count ---
        const top = this.container.createDiv({ cls: 'ht-streak-top' });
        const flameEl = top.createDiv({
            cls: `ht-streak-flame ${isHot ? 'ht-streak-hot' : ''} ${isBroken && currentStreak === 0 ? 'ht-streak-cold' : ''}`,
            text: '🔥',
        });
        top.createDiv({ cls: 'ht-streak-count', text: String(currentStreak) });

        // Habit name
        const shortName = this.habitName.replace(/^Habit-/i, '');
        this.container.createDiv({ cls: 'ht-streak-habit-name', text: shortName });

        // 7-day mini bars
        const bars = this.container.createDiv({ cls: 'ht-streak-bars' });
        const goalSec = getHabitGoals(prop, todayStr).desired;
        const maxVal = Math.max(...last7.map(d => d.val), goalSec * 0.1, 1);

        last7.forEach(({ date, val, state }) => {
            const bar = bars.createDiv({ cls: 'ht-streak-bar-wrap' });
            const fill = bar.createDiv({ cls: 'ht-streak-bar-fill' });
            const h = Math.max((val / maxVal) * 100, val > 0 ? 10 : 0);
            fill.setCssStyles({ height: `${h}%` });
            if (statePreservesStreak(state)) fill.addClass('ht-streak-bar-met');
            fill.setAttribute('title', `${date}: ${Math.floor(val / 60)}м`);
            bar.createDiv({
                cls: 'ht-streak-bar-day',
                text: moment(date).format('dd').charAt(0).toUpperCase(),
            });
        });

        // Best streak note
        this.container.createDiv({
            cls: 'ht-streak-best',
            text: `Лучшая серия: ${bestStreak} дн.`,
        });
    }

    private async _getBestStreak(prop: any): Promise<number> {
        const dailyNotes = getDailyNotes(this.plugin.app, this.plugin.settings.dailyNotesFolder);
        if ((prop.goalMode || 'daily') === 'weekly') {
            const totals = new Map<string, number>();
            for (const file of dailyNotes) {
                const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
                if (!fm) continue;
                const week = moment(file.basename).startOf('isoWeek').format('YYYY-MM-DD');
                totals.set(week, (totals.get(week) || 0) + getHabitValueFromFrontmatter(fm, prop));
            }
            const successful = [...totals.entries()]
                .filter(([week, value]) => value >= getHabitGoals(prop, week).minimum)
                .map(([week]) => week)
                .sort();
            let best = 0, current = 0, previous = '';
            successful.forEach(week => {
                current = previous && moment(week).diff(moment(previous), 'weeks') === 1 ? current + 1 : 1;
                best = Math.max(best, current);
                previous = week;
            });
            return best;
        }
        const metDates: string[] = [];
        for (const file of dailyNotes) {
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            if (!cache?.frontmatter) continue;
            const val = getHabitValueFromFrontmatter(cache.frontmatter, prop);
            const state = evaluateHabitState(prop, val, file.basename, readHabitExplicitState(cache.frontmatter, prop.name));
            if (state === 'completed' || state === 'partial') metDates.push(file.basename);
        }
        metDates.sort();
        let best = 0, curr = 0;
        for (let i = 0; i < metDates.length; i++) {
            if (i === 0) { curr = 1; best = 1; continue; }
            const diff = moment(metDates[i]).diff(moment(metDates[i - 1]), 'days');
            if (diff === 1) { curr++; if (curr > best) best = curr; }
            else curr = 1;
        }
        return best;
    }
}
