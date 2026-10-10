import { TFile } from 'obsidian';
import { BoardHistory, duplicateItems } from './board';
import { clone, DesignError, type BoardDocument, type DesignBoard, type BoardItem, type BoardEdge } from './types';
import type { DesignService } from './service';

/** One document session keeps history across nested-board navigation. */
export class BoardSession {
    board: DesignBoard;
    path: string;
    raw: string;
    dirty = false;
    saving = false;
    conflict = false;
    readonly history = new BoardHistory();
    /** Pan/zoom saves the viewport without rebuilding card markup, column membership or thumbnails. */
    contentVersion = 0;
    private revision = 0;
    private timer?: ReturnType<typeof setTimeout>;
    private pending?: Promise<void>;
    private unsubscribe: () => void;
    constructor(readonly service: DesignService, doc: BoardDocument, readonly changed: () => void) {
        this.board = clone(doc.board); this.path = doc.path; this.raw = doc.raw;
        this.unsubscribe = service.subscribe(path => {
            const external = service.resolveBoard(this.board.id);
            if (path !== this.path && path !== external?.path) return;
            if (external) this.path = external.path;
            if (external?.raw === this.raw || this.saving) return;
            if (!external || this.dirty) this.conflict = true;
            else { this.board = clone(external.board); this.raw = external.raw; this.contentVersion++; }
            this.changed();
        });
    }
    checkpoint(): void { this.history.push(this.board); }
    touch(): void { this.markChanged(true); }
    touchViewport(): void { this.markChanged(false); }
    layoutChanged(): void { this.contentVersion++; this.changed(); }
    private markChanged(content: boolean): void { if (content) this.contentVersion++; this.revision++; this.dirty = true; clearTimeout(this.timer); if (!this.conflict) this.timer = setTimeout(() => void this.flush().catch(e => this.service.report(e)), 500); this.changed(); }
    undo(): void { if (!this.board.readOnly && this.history.canUndo) { this.board = this.history.undo(this.board); this.touch(); } }
    redo(): void { if (!this.board.readOnly && this.history.canRedo) { this.board = this.history.redo(this.board); this.touch(); } }
    async flush(): Promise<void> {
        clearTimeout(this.timer);
        if (this.pending) { await this.pending; if (this.dirty && !this.conflict) return this.flush(); return; }
        if (!this.dirty || this.conflict) return;
        const board = clone(this.board), revision = this.revision; this.saving = true; this.changed();
        this.pending = this.service.saveBoard(board, this.path, this.raw).then(raw => { this.raw = raw; this.dirty = revision !== this.revision; }).catch(error => { if (error instanceof DesignError && error.key === 'design_conflict') this.conflict = true; throw error; }).finally(() => {
            this.saving = false; this.pending = undefined;
            const latest = this.service.resolveBoard(this.board.id);
            if (latest && latest.raw !== this.raw) { if (this.dirty) this.conflict = true; else { this.board = clone(latest.board); this.raw = latest.raw; this.path = latest.path; this.contentVersion++; } }
            this.changed();
        });
        await this.pending;
        if (this.dirty && !this.conflict) return this.flush();
    }
    async reload(): Promise<void> {
        if (this.pending) await this.pending.catch(() => undefined);
        const file = this.service.plugin.app.vault.getAbstractFileByPath(this.path); if (!(file instanceof TFile)) throw new DesignError('design_conflict');
        await this.service.refreshFile(file); const doc = this.service.documents.get(this.path); if (!doc) throw new DesignError('design_invalid');
        this.checkpoint(); this.board = clone(doc.board); this.raw = doc.raw; this.dirty = false; this.conflict = false; this.contentVersion++; this.changed();
    }
    async keepLocal(): Promise<void> {
        const file = this.service.plugin.app.vault.getAbstractFileByPath(this.path); if (!(file instanceof TFile)) throw new DesignError('design_conflict');
        this.raw = await this.service.plugin.app.vault.read(file); this.conflict = false; this.touch(); await this.flush();
    }
    async close(): Promise<void> {
        clearTimeout(this.timer); this.unsubscribe();
        try { await this.flush(); } catch (error) { this.service.report(error); }
        if (this.dirty) {
            // Closing a conflicted view must not discard local work or overwrite the external file.
            const recovery = await this.service.createBoard(`${this.board.name} (${this.service.tr('design_unsaved')})`);
            await this.service.saveBoard({ ...clone(this.board), id: recovery.board.id, name: recovery.board.name }, recovery.path, recovery.raw);
        }
    }
    discard(): void { clearTimeout(this.timer); this.unsubscribe(); this.dirty = false; }
    /** Destination must be saved successfully before the source removes transferred objects. */
    async receive(items: BoardItem[], edges: BoardEdge[]): Promise<void> {
        await this.flush();
        if (this.conflict) throw new DesignError('design_conflict');
        if (this.board.readOnly) throw new DesignError('design_invalid', this.service.tr('design_read_only'));
        const before = clone(this.board), next = clone(before), revision = this.revision;
        const source = { ...clone(this.board), items, edges };
        duplicateItems(next, new Set([...items.map(item => item.id), ...edges.map(edge => edge.id)]), source, { x: 0, y: 0 });
        // Saving before publishing the change also leaves the destination untouched on failure.
        this.saving = true; this.changed();
        this.pending = this.service.saveBoard(next, this.path, this.raw).then(raw => {
            this.history.push(before); this.raw = raw;
            if (revision === this.revision) { this.board = next; this.dirty = false; this.contentVersion++; }
            else { const oldItems = new Set(before.items.map(item => item.id)), oldEdges = new Set(before.edges.map(edge => edge.id)); this.board.items.push(...next.items.filter(item => !oldItems.has(item.id))); this.board.edges.push(...next.edges.filter(edge => !oldEdges.has(edge.id))); this.touch(); }
        }).catch(error => { if (error instanceof DesignError && error.key === 'design_conflict') this.conflict = true; throw error; }).finally(() => { this.saving = false; this.pending = undefined; this.changed(); });
        await this.pending;
    }
}
