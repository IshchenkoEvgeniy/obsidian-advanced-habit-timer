import type HabitTimerPlugin from '../main';
import { HabitWidget } from './types';
import type { WidgetDescriptor } from './types';
import { TinyBadgeWidget } from './implementations/tiny-badge-widget';
import { CalendarHeatmapWidget } from './implementations/calendar-heatmap-widget';
import { StatsSummaryWidget } from './implementations/stats-summary-widget';
import { LiveTimerWidget } from './implementations/live-timer-widget';
import { StreakWidget } from './implementations/streak-widget';
import { GlobalGoalWidget } from './implementations/global-goal-widget';

/** Central registry of all available widget types */
export class WidgetRegistry {
    private static _descriptors: WidgetDescriptor[] = [
        {
            id: 'tiny-badge',
            label: 'Мини-значок',
            icon: '⭕',
            defaultColSpan: 1,
            defaultRowSpan: 1,
            factory: (plugin: HabitTimerPlugin, habitName: string) => new TinyBadgeWidget(plugin, habitName),
        },
        {
            id: 'calendar-heatmap',
            label: 'Календарь',
            icon: '📅',
            defaultColSpan: 2,
            defaultRowSpan: 2,
            factory: (plugin: HabitTimerPlugin, habitName: string) => new CalendarHeatmapWidget(plugin, habitName),
        },
        {
            id: 'stats-summary',
            label: 'Статистика',
            icon: '📊',
            defaultColSpan: 2,
            defaultRowSpan: 2,
            factory: (plugin: HabitTimerPlugin, habitName: string) => new StatsSummaryWidget(plugin, habitName),
        },
        {
            id: 'live-timer',
            label: 'Активный таймер',
            icon: '⏱️',
            defaultColSpan: 2,
            defaultRowSpan: 1,
            factory: (plugin: HabitTimerPlugin, habitName: string) => new LiveTimerWidget(plugin, habitName),
        },
        {
            id: 'streak',
            label: 'Серия дней',
            icon: '🔥',
            defaultColSpan: 1,
            defaultRowSpan: 2,
            factory: (plugin: HabitTimerPlugin, habitName: string) => new StreakWidget(plugin, habitName),
        },
        {
            id: 'global-goal',
            label: 'Глобальная цель',
            icon: '🎯',
            defaultColSpan: 2,
            defaultRowSpan: 2,
            factory: (plugin: HabitTimerPlugin, habitName: string) => new GlobalGoalWidget(plugin, habitName),
        },
    ];

    static get(id: string): WidgetDescriptor | undefined {
        return this._descriptors.find(d => d.id === id);
    }

    static getAll(): WidgetDescriptor[] {
        return this._descriptors;
    }

    static create(id: string, plugin: HabitTimerPlugin, habitName: string): HabitWidget | null {
        const desc = this.get(id);
        if (!desc) return null;
        return desc.factory(plugin, habitName);
    }
}
