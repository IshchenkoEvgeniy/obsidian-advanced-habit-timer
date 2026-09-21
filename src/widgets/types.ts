import type HabitTimerPlugin from '../main';

/** Supported widget sizes in grid columns × rows */
export type WidgetColSpan = 1 | 2 | 3;
export type WidgetRowSpan = 1 | 2 | 3;

/** Persisted config for a single placed widget */
export interface WidgetInstance {
    instanceId: string;   // unique ID for this slot (e.g. 'cal-english-1')
    widgetId: string;     // widget type key (e.g. 'calendar-heatmap')
    habitName: string;    // which habit this widget is bound to
    col: number;          // 0-based column position
    row: number;          // 0-based row position
    colSpan: WidgetColSpan;
    rowSpan: WidgetRowSpan;
}

/** Full widget dashboard layout stored in plugin settings */
export interface WidgetLayout {
    widgets: WidgetInstance[];
    refreshIntervalSec: number;  // default 30
}

/** Registration descriptor for a widget type */
export interface WidgetDescriptor {
    id: string;
    label: string;
    icon: string;
    defaultColSpan: WidgetColSpan;
    defaultRowSpan: WidgetRowSpan;
    factory: (plugin: HabitTimerPlugin, habitName: string) => HabitWidget;
}

/** Base class every widget must extend */
export abstract class HabitWidget {
    protected plugin: HabitTimerPlugin;
    protected container: HTMLElement;
    protected habitName: string;
    private _refreshTimer: number | null = null;

    constructor(plugin: HabitTimerPlugin, habitName: string) {
        this.plugin = plugin;
        this.habitName = habitName;
    }

    /** Mount widget into given DOM container */
    async mount(container: HTMLElement): Promise<void> {
        this.container = container;
        await this.render();
    }

    /** Full re-render — clears container and rebuilds */
    abstract render(): Promise<void>;

    /** Light update called on interval tick — override for real-time data */
    async tick(): Promise<void> {
        await this.render();
    }

    destroy(): void {
        if (this._refreshTimer !== null) {
            window.clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
    }
}
