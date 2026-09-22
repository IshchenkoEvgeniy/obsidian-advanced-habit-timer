import { moment } from 'obsidian';
import { HabitWidget } from '../types';
import { getDailyNotes } from '../../utils';
import { getHabitDeferredBonus, getHabitValueFromFrontmatter, getHabitWeeklyValue } from '../../services/habit-service';
import { evaluateHabitState, getHabitGoals, readHabitExplicitState } from '../../habits/goals';

/**
 * Widget 1 — Tiny Badge (1×1)
 * SVG ring progress + today's minutes + habit name
 */
export class TinyBadgeWidget extends HabitWidget {

    async render(): Promise<void> {
        this.container.empty();
        this.container.addClass('ht-widget-tiny-badge');

        const prop = this.plugin.settings.properties.find(p => p.name === this.habitName);
        if (!prop) {
            this.container.createDiv({ cls: 'ht-widget-error', text: 'Привычка не найдена' });
            return;
        }

        const todayStr = moment().format('YYYY-MM-DD');
        // Look up today's daily note via the vault (basename = YYYY-MM-DD)
        const dailyNotes = getDailyNotes(this.plugin.app, this.plugin.settings.dailyNotesFolder);
        const note = dailyNotes.find(f => f.basename === todayStr) ?? null;
        let valueSec = 0;
        let explicitState = null;
        if (note) {
            const cache = this.plugin.app.metadataCache.getFileCache(note);
            if (cache?.frontmatter) {
                valueSec = getHabitValueFromFrontmatter(cache.frontmatter, prop);
                explicitState = readHabitExplicitState(cache.frontmatter, prop.name);
            }
        }

        const type = prop.type || 'timer';
        const deferredBonus = getHabitDeferredBonus(this.plugin.app, this.plugin.settings.dailyNotesFolder, prop, todayStr);
        const goals = getHabitGoals(prop, todayStr, deferredBonus);
        const weeklyValue = goals.mode === 'weekly'
            ? getHabitWeeklyValue(this.plugin.app, this.plugin.settings.dailyNotesFolder, prop, todayStr)
            : undefined;
        const displayValue = goals.mode === 'weekly' ? (weeklyValue || 0) : valueSec;

        const perc = Math.min(displayValue / Math.max(goals.desired, 1), 1);
        const isActive = !!this.plugin.settings.activeTimer;
        const isDone = evaluateHabitState(prop, valueSec, todayStr, explicitState, weeklyValue, deferredBonus) === 'completed';

        // --- SVG ring ---
        const svgWrap = this.container.createDiv({ cls: 'ht-badge-ring-wrap' });
        const SIZE = 80, R = 32, STROKE = 7;
        const CIRCUM = 2 * Math.PI * R;
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', String(SIZE));
        svg.setAttribute('height', String(SIZE));
        svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
        svg.classList.add('ht-badge-svg');

        // track
        const track = document.createElementNS(svgNS, 'circle');
        track.setAttribute('cx', String(SIZE / 2));
        track.setAttribute('cy', String(SIZE / 2));
        track.setAttribute('r', String(R));
        track.setAttribute('fill', 'transparent');
        track.setAttribute('stroke', 'rgba(255,255,255,0.1)');
        track.setAttribute('stroke-width', String(STROKE));
        svg.appendChild(track);

        // fill
        const fill = document.createElementNS(svgNS, 'circle');
        fill.setAttribute('cx', String(SIZE / 2));
        fill.setAttribute('cy', String(SIZE / 2));
        fill.setAttribute('r', String(R));
        fill.setAttribute('fill', 'transparent');
        fill.setAttribute('stroke', isDone ? '#52b788' : isActive ? '#f9e2af' : '#89b4fa');
        fill.setAttribute('stroke-width', String(STROKE));
        fill.setAttribute('stroke-dasharray', String(CIRCUM));
        fill.setAttribute('stroke-dashoffset', String(CIRCUM * (1 - perc)));
        fill.setAttribute('transform', `rotate(-90 ${SIZE / 2} ${SIZE / 2})`);
        fill.setAttribute('stroke-linecap', 'round');
        if (isActive) fill.classList.add('ht-badge-pulse');
        svg.appendChild(fill);

        svgWrap.appendChild(svg);

        // center text
        const centerText = svgWrap.createDiv({ cls: 'ht-badge-center-text' });
        if (type === 'timer') {
            const mins = Math.floor(valueSec / 60);
            centerText.setText(mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}m`);
        } else if (type === 'count') {
            centerText.setText(String(valueSec));
        } else {
            centerText.setText(valueSec >= 1 ? '✓' : '—');
        }

        // habit name
        const nameEl = this.container.createDiv({ cls: 'ht-badge-name' });
        const shortName = this.habitName.replace(/^Habit-/i, '');
        nameEl.setText(shortName.length > 12 ? shortName.substring(0, 11) + '…' : shortName);

        // active dot
        if (isActive && this.plugin.settings.activeTimer?.habitName === this.habitName) {
            this.container.createDiv({ cls: 'ht-badge-active-dot' });
        }

        // tap → open timer view
        this.container.setCssStyles({ cursor: 'pointer' });
        this.container.onclick = () => {
            void this.plugin.activateView('habit-timer-view');
        };
    }
}
