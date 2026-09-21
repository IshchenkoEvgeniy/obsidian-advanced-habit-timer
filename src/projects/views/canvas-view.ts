import { App, Menu, Modal, Notice } from 'obsidian';
import HabitTimerPlugin from '../../main';
import { ProjectDataEngine } from '../project-data';
import type { ProjectScopeDefinition, ProjectTask } from '../types';
import { ProjectSubView, type ViewContext } from './base-view';
import type { CanvasData, CanvasNode, CanvasLayoutType } from '../canvas/canvas-types';
import { CanvasEngine } from '../canvas/canvas-engine';
import { CanvasRenderer } from '../canvas/canvas-renderer';
import { CanvasInteractions } from '../canvas/canvas-interactions';
import { applyLayout } from '../canvas/canvas-layout';
import { UndoStack, type UndoOperation } from '../canvas/canvas-undo';
import { CanvasMinimap } from '../canvas/canvas-minimap';
import { exportPNG, exportSVG, exportToObsidianCanvas } from '../canvas/canvas-export';
import { t } from '../../i18n';
import type { TimerView } from '../../timer/timer-view';

export class CanvasView extends ProjectSubView {
    private canvasEngine: CanvasEngine;
    private renderer!: CanvasRenderer;
    private interactions!: CanvasInteractions;
    private data!: CanvasData;
    private scope!: ProjectScopeDefinition;
    private selectedIds: Set<string> = new Set();
    private container!: HTMLElement;
    private canvasArea!: HTMLElement;
    private rafPending = false;
    private keyHandler?: (e: KeyboardEvent) => void;
    private resizeObserver?: ResizeObserver;
    private undoStack = new UndoStack();
    private minimap?: CanvasMinimap;
    private minimapTimer?: ReturnType<typeof setInterval>;
    private zoomLabelTimer?: ReturnType<typeof setInterval>;
    private clipboardNodes: Omit<CanvasNode, 'id'>[] = [];

    constructor(app: App, plugin: HabitTimerPlugin, dataEngine: ProjectDataEngine) {
        super(app, plugin, dataEngine);
        this.canvasEngine = new CanvasEngine(plugin, dataEngine);
    }

    async render(container: HTMLElement, scope: ProjectScopeDefinition, ctx: ViewContext): Promise<void> {
        this.destroy();
        this.scope = scope;
        this.container = container;
        container.empty();
        container.setCssStyles({ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' });

        // Update live task map on renderer (created after toolbar)
        const tasksById = new Map<string, ProjectTask>();
        for (const task of ctx.allTasks) tasksById.set(task.id, task);

        // ── Load canvas data ──────────────────────────────────────────────────
        this.data = await this.canvasEngine.load(scope);

        // ── Sync tasks → nodes ────────────────────────────────────────────────
        const changed = this.canvasEngine.syncTasks(this.data, ctx.allTasks, ctx.columns, true);

        // Attach live status info to nodes for layout
        for (const node of this.data.nodes) {
            if (node.type === 'task' && node.taskId) {
                const task = tasksById.get(node.taskId);
                if (task) {
                    Object.defineProperty(node, 'runtimeStatus', {
                        value: task.status,
                        writable: true,
                        configurable: true,
                        enumerable: false,
                    });
                }
            }
        }

        if (changed) this.canvasEngine.scheduleSave(scope, this.data);

        // ── Canvas area ───────────────────────────────────────────────────────
        const canvasArea = container.createDiv({ attr: { style: 'flex:1;position:relative;overflow:hidden;background:var(--background-primary);min-height:500px;width:100%;' } });
        this.canvasArea = canvasArea;

        this.renderer = new CanvasRenderer(canvasArea, this.plugin);
        this.renderer.taskMap = tasksById;
        this.renderer.onStartTimer = (node) => void this._onStartTimer(node);
        this.renderer.onOpenTask = (node) => this._onOpenTask(node);
        this.renderer.viewport = { ...this.data.viewport };
        this.renderer.applyViewport();

        // ── Toolbar ───────────────────────────────────────────────────────────
        const toolbar = container.createDiv({ cls: 'canvas-toolbar', attr: { style: 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--background-secondary);border-bottom:1px solid var(--background-modifier-border);flex-shrink:0;flex-wrap:wrap;' } });
        this._buildToolbar(toolbar, ctx);
        this.renderer.taskMap = tasksById;
        this.renderer.onStartTimer = (node) => void this._onStartTimer(node);
        this.renderer.onOpenTask = (node) => this._onOpenTask(node);
        this.renderer.viewport = { ...this.data.viewport };
        this.renderer.applyViewport();

        this.interactions = new CanvasInteractions(
            this.renderer.svg,
            this.renderer,
            this.canvasEngine,
            this.data,
            {
                onNodeMoved: (id, x, y) => {
                    const node = this.canvasEngine.getNode(this.data, id);
                    if (node) {
                        this.undoStack.push({ type: 'move', nodeId: id, before: { x: node.x, y: node.y }, after: { x, y } });
                    }
                    this.canvasEngine.updateNodePos(this.data, id, x, y);
                    this.canvasEngine.scheduleSave(scope, this.data);
                },
                onEdgeCreated: (fromId, toId, fromSide, toSide) => {
                    const edge = this.canvasEngine.addEdge(this.data, { fromNode: fromId, toNode: toId, fromSide, toSide, type: 'related' });
                    this.undoStack.push({ type: 'edge_add', edge });
                    this._scheduleRender();
                    this.canvasEngine.scheduleSave(scope, this.data);
                },
                onNodeSelected: (ids) => { this.selectedIds = ids; this._scheduleRender(); },
                onNodeDoubleClick: (node) => this._onNodeDoubleClick(node),
                onEdgeDoubleClick: (_id) => { /* future: edit edge label */ },
                onRightClick: (e, nodeId, edgeId) => this._showContextMenu(e, nodeId, edgeId),
                onViewportChange: (vp) => {
                    this.data.viewport = { ...vp };
                    this.canvasEngine.scheduleSave(scope, this.data);
                },
                onRequestRender: () => this._scheduleRender(),
            }
        );

        // Minimap
        this.minimap?.destroy();
        this.minimap = new CanvasMinimap(canvasArea, (cx, cy) => {
            const rect = canvasArea.getBoundingClientRect();
            this.renderer.viewport.x = rect.width  / 2 - cx * this.renderer.viewport.zoom;
            this.renderer.viewport.y = rect.height / 2 - cy * this.renderer.viewport.zoom;
            this.renderer.applyViewport();
            this.data.viewport = { ...this.renderer.viewport };
            this._scheduleRender();
        });
        if (this.minimapTimer) clearInterval(this.minimapTimer);
        this.minimapTimer = setInterval(() => {
            const rect = canvasArea.getBoundingClientRect();
            this.minimap?.render(this.data, this.renderer.viewport, rect.width, rect.height);
        }, 500);

        // Keyboard handler
        this.keyHandler = (e: KeyboardEvent) => {
            const active = document.activeElement;
            // Don't capture when user is typing in an input
            if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;

            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) this._redo(); else this._undo();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault(); this._redo(); return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault();
                this.selectedIds = new Set(this.data.nodes.map(n => n.id));
                this._scheduleRender(); return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                e.preventDefault(); this._copy(); return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                e.preventDefault(); this._paste(); return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                e.preventDefault(); this._copy(); this._paste(); return;
            }
            if (this.interactions.onKeyDown(e)) {
                void this._deleteSelected();
            }
        };
        document.addEventListener('keydown', this.keyHandler);

        // Fit on first open if viewport is default
        if (this.data.viewport.x === 0 && this.data.viewport.y === 0 && this.data.viewport.zoom === 1) {
            const rect = canvasArea.getBoundingClientRect();
            this.renderer.fitAll(this.data, rect.width || 800, rect.height || 600);
        }

        // ResizeObserver for fit-all recalc
        this.resizeObserver?.disconnect();
        this.resizeObserver = new ResizeObserver(() => this._scheduleRender());
        this.resizeObserver.observe(canvasArea);

        this._scheduleRender();
    }

    // ── Toolbar ───────────────────────────────────────────────────────────────

    private _buildToolbar(toolbar: HTMLElement, ctx: ViewContext): void {
        const lang = this.plugin.settings.language;
        const btn = (text: string, title: string, cb: () => void) => {
            const b = toolbar.createEl('button', { text, attr: { title } });
            b.setCssStyles({ padding: '3px 8px', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', background: 'var(--background-modifier-border)', border: 'none' });
            b.onclick = cb;
            return b;
        };

        btn('+ ' + t(lang, 'canvas_add_task'), t(lang, 'canvas_add_task'), () => this._addTaskPicker(ctx));
        btn('+ ' + t(lang, 'canvas_add_text'), t(lang, 'canvas_add_text'), () => this._addTextNode());
        btn('+ ' + t(lang, 'canvas_add_group'), t(lang, 'canvas_add_group'), () => this._addGroupNode());
        btn('+ ' + t(lang, 'canvas_add_milestone'), t(lang, 'canvas_add_milestone'), () => this._addMilestoneNode());
        btn('+ Timer', 'Add Timer Node', () => this._addTimerNode());

        toolbar.createDiv({ attr: { style: 'width:1px;height:20px;background:var(--background-modifier-border);margin:0 2px;' } });

        // Auto-layout dropdown
        const layoutBtn = toolbar.createEl('button', { text: t(lang, 'canvas_auto_layout') + ' ▾' });
        layoutBtn.setCssStyles({ padding: '3px 8px', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', background: 'var(--background-modifier-border)', border: 'none' });
        layoutBtn.onclick = (e) => {
            const menu = new Menu();
            const layouts: [CanvasLayoutType, string][] = [
                ['kanban', t(lang, 'canvas_layout_kanban')],
                ['dagre',  t(lang, 'canvas_layout_dagre')],
                ['force',  t(lang, 'canvas_layout_force')],
                ['grid',   t(lang, 'canvas_layout_grid')],
            ];
            for (const [type, label] of layouts) {
                menu.addItem(item => item.setTitle(label).onClick(() => {
                    const beforeState = new Map(this.data.nodes.map(n => [n.id, { x: n.x, y: n.y }]));
                    
                    applyLayout(this.data, type, ctx.columns);
                    
                    const ops: UndoOperation[] = [];
                    for (const n of this.data.nodes) {
                        const b = beforeState.get(n.id);
                        if (b && (b.x !== n.x || b.y !== n.y)) {
                            ops.push({ type: 'move', nodeId: n.id, before: b, after: { x: n.x, y: n.y } });
                        }
                    }
                    if (ops.length > 0) this.undoStack.push({ type: 'batch', ops });

                    this._scheduleRender();
                    this.canvasEngine.scheduleSave(this.scope, this.data);
                }));
            }
            menu.showAtMouseEvent(e);
        };

        btn(t(lang, 'canvas_fit_all'), t(lang, 'canvas_fit_all'), () => {
            const rect = this.canvasArea.getBoundingClientRect();
            this.renderer.fitAll(this.data, rect.width, rect.height);
            this.data.viewport = { ...this.renderer.viewport };
            this.canvasEngine.scheduleSave(this.scope, this.data);
        });

        // Undo / Redo
        toolbar.createDiv({ attr: { style: 'width:1px;height:20px;background:var(--background-modifier-border);margin:0 2px;' } });
        btn('↩', 'Undo (Ctrl+Z)', () => this._undo());
        btn('↪', 'Redo (Ctrl+Y)', () => this._redo());

        // Export dropdown
        toolbar.createDiv({ attr: { style: 'width:1px;height:20px;background:var(--background-modifier-border);margin:0 2px;' } });
        const expBtn = toolbar.createEl('button', { text: '↓ ' + 'Export ▾' });
        expBtn.setCssStyles({ padding: '3px 8px', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', background: 'var(--background-modifier-border)', border: 'none' });
        expBtn.onclick = (e) => {
            const menu = new Menu();
            menu.addItem(i => i.setTitle(t(lang, 'canvas_export_png')).setIcon('image').onClick(() =>
                exportPNG(this.canvasArea, this.data, this.plugin)));
            menu.addItem(i => i.setTitle('Export SVG').setIcon('code').onClick(() =>
                exportSVG(this.canvasArea, this.data)));
            menu.addItem(i => i.setTitle(t(lang, 'canvas_export_canvas')).setIcon('layout').onClick(() =>
                exportToObsidianCanvas(this.data, this.scope, this.plugin)));
            menu.showAtMouseEvent(e);
        };

        toolbar.createDiv({ attr: { style: 'width:1px;height:20px;background:var(--background-modifier-border);margin:0 2px;' } });

        // Zoom display
        const zoomLabel = toolbar.createSpan({ attr: { style: 'font-size:11px;color:var(--text-muted);min-width:38px;text-align:center;' } });
        const updateZoomLabel = () => {
            zoomLabel.textContent = Math.round(this.renderer.viewport.zoom * 100) + '%';
        };
        updateZoomLabel();
        if (this.zoomLabelTimer) clearInterval(this.zoomLabelTimer);
        this.zoomLabelTimer = setInterval(updateZoomLabel, 500);

        btn('−', 'Zoom out', () => { this.renderer.viewport.zoom = Math.max(0.1, this.renderer.viewport.zoom * 0.8); this.renderer.applyViewport(); });
        btn('+', 'Zoom in',  () => { this.renderer.viewport.zoom = Math.min(4, this.renderer.viewport.zoom * 1.25); this.renderer.applyViewport(); });

        toolbar.createDiv({ attr: { style: 'margin-left:auto;' } });

        // Snap to grid toggle
        const snapLabel = toolbar.createEl('label', { attr: { style: 'font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px;cursor:pointer;' } });
        const snapCb = snapLabel.createEl('input', { type: 'checkbox' });
        snapLabel.createSpan({ text: t(lang, 'canvas_snap_grid') });
        snapCb.onchange = () => this.interactions.setSnapToGrid(snapCb.checked);

        // Selected count badge
        toolbar.createSpan({ attr: { style: 'font-size:11px;color:var(--text-muted);' }, text: '' });
    }

    // ── Quick-add helpers ─────────────────────────────────────────────────────

    private _addTaskPicker(ctx: ViewContext): void {
        // Show a simple inline picker
        const existing = new Set(
            this.data.nodes.filter(n => n.type === 'task').map(n => n.taskId)
        );
        const available = ctx.allTasks.filter(task => !existing.has(task.id));
        if (available.length === 0) { new Notice(t(this.plugin.settings.language, 'canvas_no_tasks')); return; }

        const menu = new Menu();
        for (const task of available.slice(0, 30)) {
            menu.addItem(item => item.setTitle(task.name).onClick(() => {
                const cx = (-this.renderer.viewport.x + 200) / this.renderer.viewport.zoom;
                const cy = (-this.renderer.viewport.y + 100) / this.renderer.viewport.zoom;
                this.canvasEngine.addNode(this.data, {
                    type: 'task', x: cx, y: cy, width: 220, height: 130,
                    taskId: task.id, taskFile: task.file.path, taskName: task.name,
                });
                this._scheduleRender();
                this.canvasEngine.scheduleSave(this.scope, this.data);
            }));
        }
        menu.showAtPosition({ x: 200, y: 50 });
    }

    private _addTextNode(): void {
        const cx = (-this.renderer.viewport.x + 200) / this.renderer.viewport.zoom;
        const cy = (-this.renderer.viewport.y + 100) / this.renderer.viewport.zoom;
        this.canvasEngine.addNode(this.data, {
            type: 'text', x: cx, y: cy, width: 200, height: 120,
            content: '**Note**\n\nDouble-click to edit.',
        });
        this._scheduleRender();
        this.canvasEngine.scheduleSave(this.scope, this.data);
    }

    private _addGroupNode(): void {
        const cx = (-this.renderer.viewport.x + 100) / this.renderer.viewport.zoom;
        const cy = (-this.renderer.viewport.y + 100) / this.renderer.viewport.zoom;
        this.canvasEngine.addNode(this.data, {
            type: 'group', x: cx, y: cy, width: 400, height: 300,
            label: 'Group',
        });
        this._scheduleRender();
        this.canvasEngine.scheduleSave(this.scope, this.data);
    }

    private _addMilestoneNode(): void {
        const cx = (-this.renderer.viewport.x + 300) / this.renderer.viewport.zoom;
        const cy = (-this.renderer.viewport.y + 100) / this.renderer.viewport.zoom;
        this.canvasEngine.addNode(this.data, {
            type: 'milestone', x: cx, y: cy, width: 120, height: 120,
            label: 'Milestone',
        });
        this._scheduleRender();
        this.canvasEngine.scheduleSave(this.scope, this.data);
    }

    private _addTimerNode(): void {
        const cx = (-this.renderer.viewport.x + 400) / this.renderer.viewport.zoom;
        const cy = (-this.renderer.viewport.y + 100) / this.renderer.viewport.zoom;
        this.canvasEngine.addNode(this.data, {
            type: 'timer', x: cx, y: cy, width: 200, height: 120,
        });
        this._scheduleRender();
        this.canvasEngine.scheduleSave(this.scope, this.data);
    }

    // ── Timer integration ─────────────────────────────────────────────────────

    private async _onStartTimer(node: CanvasNode): Promise<void> {
        if (!node.taskId) return;
        const task = this.renderer.taskMap.get(node.taskId);
        if (!task) return;
        
        const active = this.plugin.settings.activeTimer;
        if (active && active.path === task.file.path) {
            // STOP
            const leaf = this.plugin.app.workspace.getLeavesOfType('habit-timer-view')[0];
            if (leaf?.view) {
                const timerView = leaf.view as TimerView;
                await timerView.engine.reset();
            } else {
                this.plugin.settings.activeTimer = undefined;
                await this.plugin.saveSettings();
            }
            new Notice(`⏹ Timer stopped: ${task.name}`);
        } else {
            // START
            const habitName = task.habitName || this.plugin.settings.properties[0]?.name || '';
            this.plugin.settings.activeTimer = {
                path: task.file.path,
                habitName,
                mode: 'timer',
                startTime: new Date().toISOString(),
                taskName: task.name,
            };
            await this.plugin.saveSettings();
            new Notice(`▶ Timer started: ${task.name}`);
            
            // Try to sync with active view if open
            const leaf = this.plugin.app.workspace.getLeavesOfType('habit-timer-view')[0];
            if (leaf?.view) {
                const timerView = leaf.view as TimerView;
                await timerView.engine.recoverActiveTimer();
            }
        }
        
        this._scheduleRender();
    }

    // ── Open task ─────────────────────────────────────────────────────────────

    private _onOpenTask(node: CanvasNode): void {
        if (node.taskFile) {
            void this.app.workspace.openLinkText(node.taskFile, '', false);
        }
    }

    private _onNodeDoubleClick(node: CanvasNode): void {
        if (node.type === 'text') {
            this._editTextNodeInline(node);
        } else {
            this._onOpenTask(node);
        }
    }

    private _editTextNodeInline(node: CanvasNode): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText('Edit note');
        const ta = modal.contentEl.createEl('textarea', {
            attr: { style: 'width:100%;min-height:180px;font-family:var(--font-monospace);font-size:13px;padding:8px;resize:vertical;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);' }
        });
        ta.value = node.content || '';
        const row = modal.contentEl.createDiv({ attr: { style: 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px;' } });
        const saveBtn = row.createEl('button', { text: 'Save' });
        saveBtn.setCssStyles({ padding: '4px 14px', borderRadius: '5px', background: 'var(--text-accent)', color: '#fff', border: 'none', cursor: 'pointer' });
        saveBtn.onclick = () => {
            const before = node.content || '';
            const after  = ta.value;
            if (before !== after) {
                this.undoStack.push({ type: 'content', nodeId: node.id, before, after });
                node.content = after;
                this._scheduleRender();
                this.canvasEngine.scheduleSave(this.scope, this.data);
            }
            modal.close();
        };
        row.createEl('button', { text: 'Cancel' }).onclick = () => modal.close();
        modal.open();
        setTimeout(() => ta.focus(), 50);
    }

    // ── Context menu ──────────────────────────────────────────────────────────

    private _showContextMenu(e: MouseEvent, nodeId?: string, edgeId?: string): void {
        const menu = new Menu();

        if (nodeId) {
            const node = this.canvasEngine.getNode(this.data, nodeId);
            if (node) {
                if (node.type === 'task') {
                    menu.addItem(i => i.setTitle('Open note').setIcon('file-text').onClick(() => this._onOpenTask(node)));
                    menu.addItem(i => i.setTitle('Start timer').setIcon('timer').onClick(() => this._onStartTimer(node)));
                    menu.addSeparator();
                }
                menu.addItem(i => i.setTitle(node.pinned ? '🔓 Unlock position' : '📌 Lock position').onClick(() => {
                    node.pinned = !node.pinned;
                    this.canvasEngine.scheduleSave(this.scope, this.data);
                }));
                menu.addItem(i => i.setTitle('Delete').setIcon('trash-2').onClick(() => {
                    const ops = [{ type: 'remove' as const, node, edges: this.data.edges.filter(e => e.fromNode === nodeId || e.toNode === nodeId) }];
                    this.undoStack.push({ type: 'batch', ops });
                    this.canvasEngine.removeNode(this.data, nodeId);
                    this.selectedIds.delete(nodeId);
                    this._scheduleRender();
                    this.canvasEngine.scheduleSave(this.scope, this.data);
                }));
                menu.addSeparator();
                menu.addItem(i => i.setTitle('Copy').onClick(() => {
                    this.selectedIds = new Set([node.id]);
                    this._copy();
                }));
                menu.addItem(i => i.setTitle('Duplicate').onClick(() => {
                    this.selectedIds = new Set([node.id]);
                    this._copy();
                    this._paste();
                }));
            }
        } else if (edgeId) {
            menu.addItem(i => i.setTitle('Delete connection').setIcon('unlink').onClick(() => {
                this.canvasEngine.removeEdge(this.data, edgeId);
                this._scheduleRender();
                this.canvasEngine.scheduleSave(this.scope, this.data);
            }));
        } else {
            menu.addItem(i => i.setTitle('Add task').setIcon('list-plus').onClick(() => this._addTaskPicker({ allTasks: [...this.renderer.taskMap.values()], filteredTasks: [], selectedTasks: new Set(), compactMode: false, columns: [], onRefresh: () => {} })));
            menu.addItem(i => i.setTitle('Add note').setIcon('sticky-note').onClick(() => this._addTextNode()));
            menu.addItem(i => i.setTitle('Add group').setIcon('layout-grid').onClick(() => this._addGroupNode()));
            menu.addItem(i => i.setTitle('Add milestone').setIcon('milestone').onClick(() => this._addMilestoneNode()));
            menu.addItem(i => i.setTitle('Add timer').setIcon('timer').onClick(() => this._addTimerNode()));
            menu.addSeparator();
            if (this.clipboardNodes.length > 0) {
                menu.addItem(i => i.setTitle('Paste').onClick(() => {
                    const { cx, cy } = this.renderer.screenToCanvas(e.clientX, e.clientY);
                    this._paste(cx, cy);
                }));
            }
            menu.addItem(i => i.setTitle('Select all').setIcon('check-check').onClick(() => {
                this.selectedIds = new Set(this.data.nodes.map(n => n.id));
                this._scheduleRender();
            }));
        }

        menu.showAtMouseEvent(e);
    }

    // ── Undo / Redo ───────────────────────────────────────────────────────────

    private _undo(): void {
        if (!this.undoStack.canUndo) return;
        this.undoStack.undo(this.data);
        this._scheduleRender();
        this.canvasEngine.scheduleSave(this.scope, this.data);
    }

    private _redo(): void {
        if (!this.undoStack.canRedo) return;
        this.undoStack.redo(this.data);
        this._scheduleRender();
        this.canvasEngine.scheduleSave(this.scope, this.data);
    }

    // ── Copy / Paste ──────────────────────────────────────────────────────────

    private _copy(): void {
        this.clipboardNodes = [];
        for (const id of this.selectedIds) {
            const node = this.canvasEngine.getNode(this.data, id);
            if (node) {
                const rest = { ...node };
                delete (rest as Partial<CanvasNode>).id;
                this.clipboardNodes.push(rest);
            }
        }
        if (this.clipboardNodes.length > 0) {
            new Notice(`Copied ${this.clipboardNodes.length} nodes`);
        }
    }

    private _paste(cx?: number, cy?: number): void {
        if (this.clipboardNodes.length === 0) return;
        
        let minX = Infinity, minY = Infinity;
        for (const n of this.clipboardNodes) {
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
        }

        const targetX = cx !== undefined ? cx : (-this.renderer.viewport.x + 200) / this.renderer.viewport.zoom;
        const targetY = cy !== undefined ? cy : (-this.renderer.viewport.y + 200) / this.renderer.viewport.zoom;

        const offsetX = targetX - minX + 20; // +20 so it doesn't overlap perfectly if pasted in place
        const offsetY = targetY - minY + 20;

        const newIds = new Set<string>();
        const ops: UndoOperation[] = [];

        for (const clip of this.clipboardNodes) {
            const newNodeInfo = { ...clip, x: clip.x + offsetX, y: clip.y + offsetY };
            const newNode = this.canvasEngine.addNode(this.data, newNodeInfo);
            newIds.add(newNode.id);
            ops.push({ type: 'add', node: newNode });
        }

        if (ops.length > 0) this.undoStack.push({ type: 'batch', ops });
        
        this.selectedIds = newIds;
        this._scheduleRender();
        this.canvasEngine.scheduleSave(this.scope, this.data);
    }

    // ── Delete selected ───────────────────────────────────────────────────────

    private async _deleteSelected(): Promise<void> {
        if (this.selectedIds.size === 0) return;
        const count = this.selectedIds.size;
        const confirmed = await this.confirmModal(`Delete ${count} node(s)?`);
        if (!confirmed) return;
        const batch: UndoOperation[] = [];
        for (const id of this.selectedIds) {
            const node = this.canvasEngine.getNode(this.data, id);
            if (!node) continue;
            const edges = this.data.edges.filter(e => e.fromNode === id || e.toNode === id);
            batch.push({ type: 'remove', node, edges });
        }
        if (batch.length > 0) this.undoStack.push({ type: 'batch', ops: batch });
        for (const id of this.selectedIds) {
            this.canvasEngine.removeNode(this.data, id);
        }
        this.selectedIds.clear();
        this._scheduleRender();
        this.canvasEngine.scheduleSave(this.scope, this.data);
    }

    // ── Render scheduling ─────────────────────────────────────────────────────

    private _scheduleRender(): void {
        if (this.rafPending) return;
        this.rafPending = true;
        requestAnimationFrame(() => {
            this.rafPending = false;
            try { 
                this.renderer.render(this.data, this.selectedIds); 
            } catch (err) { 
                console.error("Canvas Render Error:", err); 
            }
        });
    }

    /** Called by ProjectsView when vault files change. */
    updateTasks(tasks: ProjectTask[]): void {
        const tasksById = new Map<string, ProjectTask>();
        for (const task of tasks) tasksById.set(task.id, task);
        this.renderer.taskMap = tasksById;
        this.canvasEngine.syncTasks(this.data, tasks, [], false);
        this._scheduleRender();
    }

    destroy(): void {
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = undefined;
        }
        this.interactions?.destroy();
        this.renderer?.destroy();
        this.minimap?.destroy();
        if (this.minimapTimer) {
            clearInterval(this.minimapTimer);
            this.minimapTimer = undefined;
        }
        if (this.zoomLabelTimer) {
            clearInterval(this.zoomLabelTimer);
            this.zoomLabelTimer = undefined;
        }
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
    }
}
