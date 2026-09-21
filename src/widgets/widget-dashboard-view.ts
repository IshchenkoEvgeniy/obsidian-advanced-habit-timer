import { ItemView, WorkspaceLeaf, moment } from 'obsidian';
import type HabitTimerPlugin from '../main';
import { HabitWidget } from './types';
import type { WidgetInstance, WidgetLayout } from './types';
import { WidgetRegistry } from './widget-registry';

export const VIEW_TYPE_WIDGETS = 'habit-timer-widget-dashboard';

/**
 * Widget Dashboard View — CSS Grid board with resizable, draggable widget cards.
 *
 * Layout storage: plugin.settings.widgetLayout
 * Refresh interval: plugin.settings.widgetLayout.refreshIntervalSec (default 30)
 * Default binding: one widget per habit (configurable per instance)
 */
export class WidgetDashboardView extends ItemView {
    plugin: HabitTimerPlugin;

    private mountedWidgets: Map<string, HabitWidget> = new Map();
    private refreshTimer: number | null = null;
    private editMode: boolean = false;
    private dragState: { instanceId: string; startCol: number; startRow: number } | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: HabitTimerPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType()    { return VIEW_TYPE_WIDGETS; }
    getDisplayText() { return '📱 Виджеты'; }
    getIcon()        { return 'layout-dashboard'; }

    async onOpen() {
        await this.render();
        this._startRefreshTimer();
    }

    async onClose() {
        this._stopRefreshTimer();
        this.mountedWidgets.forEach(w => w.destroy());
        this.mountedWidgets.clear();
    }

    // ─── Main Render ──────────────────────────────────────────────────────────

    async render() {
        const root = this.containerEl.children[1] as HTMLElement;
        root.empty();
        root.addClass('ht-dashboard-root');

        this.mountedWidgets.forEach(w => w.destroy());
        this.mountedWidgets.clear();

        this._renderToolbar(root);

        const layout = this._getLayout();

        if (layout.widgets.length === 0) {
            this._renderEmptyState(root);
            return;
        }

        const board = root.createDiv({ cls: 'ht-dashboard-board' });
        this._applyGridCSS(board, layout);

        for (const inst of layout.widgets) {
            await this._mountWidgetCard(board, inst);
        }
    }

    // ─── Toolbar ─────────────────────────────────────────────────────────────

    private _renderToolbar(root: HTMLElement) {
        const bar = root.createDiv({ cls: 'ht-dashboard-toolbar' });

        bar.createDiv({ cls: 'ht-dashboard-title', text: '📱 Виджеты' });

        const right = bar.createDiv({ cls: 'ht-dashboard-toolbar-right' });

        // Edit mode toggle
        const editBtn = right.createEl('button', {
            cls: `ht-dashboard-btn ${this.editMode ? 'ht-dashboard-btn-active' : ''}`,
            text: this.editMode ? '✓ Готово' : '✏️ Изменить',
        });
        editBtn.onclick = () => {
            this.editMode = !this.editMode;
            void this.render();
        };

        // Add widget button
        const addBtn = right.createEl('button', {
            cls: 'ht-dashboard-btn',
            text: '＋ Добавить',
        });
        addBtn.onclick = () => this._showAddWidgetPanel(root);
    }

    // ─── Empty State ─────────────────────────────────────────────────────────

    private _renderEmptyState(root: HTMLElement) {
        const empty = root.createDiv({ cls: 'ht-dashboard-empty' });
        empty.createDiv({ cls: 'ht-dashboard-empty-icon', text: '📱' });
        empty.createDiv({ cls: 'ht-dashboard-empty-title', text: 'Нет виджетов' });
        empty.createDiv({ cls: 'ht-dashboard-empty-sub', text: 'Нажмите «＋ Добавить», чтобы выбрать виджет' });

        const addBtn = empty.createEl('button', { cls: 'ht-dashboard-btn ht-dashboard-btn-primary', text: '＋ Добавить виджет' });
        addBtn.onclick = () => this._showAddWidgetPanel(root);
    }

    // ─── Grid Layout ─────────────────────────────────────────────────────────

    private _applyGridCSS(board: HTMLElement, layout: WidgetLayout) {
        // Figure out how many columns we actually need
        const maxCol = layout.widgets.reduce((m, w) => Math.max(m, w.col + w.colSpan), 3);
        board.setCssStyles({ gridTemplateColumns: `repeat(${maxCol}, 1fr)` });
    }

    // ─── Widget Card Mount ────────────────────────────────────────────────────

    private async _mountWidgetCard(board: HTMLElement, inst: WidgetInstance) {
        const card = board.createDiv({ cls: 'ht-widget-card' });

        // Grid placement
        card.setCssStyles({ gridColumn: `${inst.col + 1} / span ${inst.colSpan}` });
        card.setCssStyles({ gridRow: `${inst.row + 1} / span ${inst.rowSpan}` });
        card.setAttribute('data-instance-id', inst.instanceId);

        // Widget renders into a sub-div so the edit overlay (added below) isn't
        // destroyed when the widget calls this.container.empty() during render()
        const contentEl = card.createDiv({ cls: 'ht-widget-content' });

        const widget = WidgetRegistry.create(inst.widgetId, this.plugin, inst.habitName);
        if (!widget) {
            contentEl.createDiv({ cls: 'ht-widget-error', text: `Unknown widget: ${inst.widgetId}` });
        } else {
            await widget.mount(contentEl);
            this.mountedWidgets.set(inst.instanceId, widget);
        }

        // Edit overlay added AFTER widget content — z-index keeps it on top
        if (this.editMode) {
            this._attachEditOverlay(card, inst);
        }
    }

    // ─── Edit Overlay ─────────────────────────────────────────────────────────

    private _attachEditOverlay(card: HTMLElement, inst: WidgetInstance) {
        const overlay = card.createDiv({ cls: 'ht-widget-edit-overlay' });

        // Delete button
        const delBtn = overlay.createEl('button', { cls: 'ht-widget-edit-btn ht-widget-delete-btn', text: '✕' });
        delBtn.onclick = (e) => {
            e.stopPropagation();
            void this._removeWidget(inst.instanceId);
        };

        // Resize controls
        const resizeRow = overlay.createDiv({ cls: 'ht-widget-resize-row' });

        // Column span
        resizeRow.createDiv({ cls: 'ht-resize-label', text: '↔' });
        const colDec = resizeRow.createEl('button', { cls: 'ht-resize-btn', text: '−' });
        resizeRow.createDiv({ cls: 'ht-resize-val', text: String(inst.colSpan) });
        const colInc = resizeRow.createEl('button', { cls: 'ht-resize-btn', text: '+' });

        colDec.onclick = (e) => { e.stopPropagation(); void this._resizeWidget(inst.instanceId, 'colSpan', -1); };
        colInc.onclick = (e) => { e.stopPropagation(); void this._resizeWidget(inst.instanceId, 'colSpan', +1); };

        // Row span
        resizeRow.createDiv({ cls: 'ht-resize-label', text: '↕' });
        const rowDec = resizeRow.createEl('button', { cls: 'ht-resize-btn', text: '−' });
        resizeRow.createDiv({ cls: 'ht-resize-val', text: String(inst.rowSpan) });
        const rowInc = resizeRow.createEl('button', { cls: 'ht-resize-btn', text: '+' });

        rowDec.onclick = (e) => { e.stopPropagation(); void this._resizeWidget(inst.instanceId, 'rowSpan', -1); };
        rowInc.onclick = (e) => { e.stopPropagation(); void this._resizeWidget(inst.instanceId, 'rowSpan', +1); };

        // Habit selector
        const habitSelect = overlay.createEl('select', { cls: 'ht-resize-select' });
        this.plugin.settings.properties.forEach(p => {
            const opt = habitSelect.createEl('option', { text: p.name, value: p.name });
            if (p.name === inst.habitName) opt.selected = true;
        });
        habitSelect.onchange = async () => {
            const layout = this._getLayout();
            const w = layout.widgets.find(w => w.instanceId === inst.instanceId);
            if (w) { w.habitName = habitSelect.value; await this._saveLayout(layout); await this.render(); }
        };
    }

    // ─── Add Widget Panel ─────────────────────────────────────────────────────

    private _showAddWidgetPanel(root: HTMLElement) {
        // Remove previous panel if open
        root.querySelector('.ht-add-panel')?.remove();

        const panel = root.createDiv({ cls: 'ht-add-panel' });
        const closeBtn = panel.createEl('button', { cls: 'ht-add-panel-close', text: '✕' });
        closeBtn.onclick = () => panel.remove();

        panel.createDiv({ cls: 'ht-add-panel-title', text: 'Выберите виджет' });

        // Habit selection
        const habitRow = panel.createDiv({ cls: 'ht-add-panel-row' });
        habitRow.createDiv({ cls: 'ht-add-panel-label', text: 'Привычка:' });
        const habitSel = habitRow.createEl('select', { cls: 'ht-resize-select' });
        this.plugin.settings.properties.forEach(p => {
            habitSel.createEl('option', { text: p.name, value: p.name });
        });

        // Widget type grid
        const grid = panel.createDiv({ cls: 'ht-add-widget-grid' });
        WidgetRegistry.getAll().forEach(desc => {
            const tile = grid.createDiv({ cls: 'ht-add-widget-tile' });
            tile.createDiv({ cls: 'ht-add-tile-icon', text: desc.icon });
            tile.createDiv({ cls: 'ht-add-tile-label', text: desc.label });
            tile.createDiv({
                cls: 'ht-add-tile-size',
                text: `${desc.defaultColSpan}×${desc.defaultRowSpan}`,
            });
            tile.onclick = async () => {
                await this._addWidget(desc.id, habitSel.value, desc.defaultColSpan, desc.defaultRowSpan);
                panel.remove();
            };
        });
    }

    // ─── Layout Mutations ─────────────────────────────────────────────────────

    private async _addWidget(widgetId: string, habitName: string, cols: number, rows: number) {
        const layout = this._getLayout();
        const instanceId = `${widgetId}-${habitName}-${Date.now()}`;

        // Find a free position
        const occupiedCells = new Set<string>();
        layout.widgets.forEach(w => {
            for (let c = w.col; c < w.col + w.colSpan; c++)
                for (let r = w.row; r < w.row + w.rowSpan; r++)
                    occupiedCells.add(`${c},${r}`);
        });

        let col = 0, row = 0;
        outer: for (row = 0; row < 20; row++) {
            for (col = 0; col <= 3 - cols; col++) {
                let fits = true;
                for (let dc = 0; dc < cols && fits; dc++)
                    for (let dr = 0; dr < rows && fits; dr++)
                        if (occupiedCells.has(`${col + dc},${row + dr}`)) fits = false;
                if (fits) break outer;
            }
        }

        layout.widgets.push({
            instanceId,
            widgetId,
            habitName,
            col,
            row,
            colSpan: Math.min(cols, 3) as 1 | 2 | 3,
            rowSpan: Math.min(rows, 3) as 1 | 2 | 3,
        });

        await this._saveLayout(layout);
        await this.render();
    }

    private async _removeWidget(instanceId: string) {
        const layout = this._getLayout();
        layout.widgets = layout.widgets.filter(w => w.instanceId !== instanceId);
        await this._saveLayout(layout);
        await this.render();
    }

    private async _resizeWidget(instanceId: string, axis: 'colSpan' | 'rowSpan', delta: number) {
        const layout = this._getLayout();
        const w = layout.widgets.find(w => w.instanceId === instanceId);
        if (!w) return;
        const newVal = Math.min(Math.max((w[axis] as number) + delta, 1), 3) as 1 | 2 | 3;
        w[axis] = newVal;
        await this._saveLayout(layout);
        await this.render();
    }

    // ─── Refresh Timer ────────────────────────────────────────────────────────

    private _startRefreshTimer() {
        this._stopRefreshTimer();
        const interval = (this._getLayout().refreshIntervalSec || 30) * 1000;
        this.refreshTimer = window.setInterval(() => {
            void this._tickWidgets();
        }, interval);
    }

    private async _tickWidgets(): Promise<void> {
        for (const widget of this.mountedWidgets.values()) {
            await widget.tick();
        }
    }

    private _stopRefreshTimer() {
        if (this.refreshTimer !== null) {
            window.clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    // ─── Settings I/O ─────────────────────────────────────────────────────────

    private _getLayout(): WidgetLayout {
        if (!(this.plugin.settings as any).widgetLayout) {
            (this.plugin.settings as any).widgetLayout = {
                widgets: [],
                refreshIntervalSec: 30,
            };
        }
        return (this.plugin.settings as any).widgetLayout as WidgetLayout;
    }

    private async _saveLayout(layout: WidgetLayout) {
        (this.plugin.settings as any).widgetLayout = layout;
        await this.plugin.saveSettings();
    }
}
