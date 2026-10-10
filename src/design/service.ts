import { Notice, TFile, requestUrl, type RequestUrlResponse, type TAbstractFile } from 'obsidian';
import type HabitTimerPlugin from '../main';
import { t, type TranslationKey } from '../i18n';
import { statusNames } from '../projects/status-options';
import { isDone } from '../utils/status';
import type { ProjectTask } from '../projects/types';
import { parseBoard, newBoard, serializeBoard } from './board';
import { DesignIndex } from './entity-index';
import { boardRelations, longValue, parseEntity, replaceLongValue, replaceManagedLinks, serializeEntity, splitNote } from './markdown';
import { fileName, validateSchema, validateValues, vaultPath } from './schema';
import { clone, DesignError, uid, type BoardDocument, type DesignBoard, type DesignEntity, type DesignSettings } from './types';
import { parseLinkPreview, webLink } from './link-preview';
import { bootstrapWorld, parseWorld, reconcileWorld, WORLD_CONFIG, type WorldRegistry, type WorldView } from './world-views';

async function previewRequest(url: string): Promise<RequestUrlResponse> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([requestUrl({ url, throw: false }), new Promise<RequestUrlResponse>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Preview request timed out')), 15000); })]); }
    finally { clearTimeout(timer); }
}

export class DesignService {
    readonly index = new DesignIndex();
    readonly documents = new Map<string, BoardDocument>();
    tasks: ProjectTask[] = [];
    warnings = new Map<string, string>();
    dataVersion = 0;
    world?: WorldRegistry;
    private worldRaw?: string;
    private worldPath = '';
    private worldLoading?: Promise<WorldRegistry>;
    private worldQueue: Promise<unknown> = Promise.resolve();
    private creatingTasks = new Set<string>();
    private listeners = new Set<(path: string) => void>();
    private writing = new Set<string>();
    private initialized?: Promise<void>;
    private queue: Promise<unknown> = Promise.resolve();
    private relationsQueue: Promise<void> = Promise.resolve();
    private relationsState = new Map<string, { raw: string; signature: string }>();
    private deletingBoards = new Set<string>();
    private disposed = false;
    private taskTimer?: ReturnType<typeof setTimeout>;
    constructor(readonly plugin: HabitTimerPlugin) {
        const changed = (file: TAbstractFile) => { if (this.initialized && file instanceof TFile && !this.writing.has(file.path)) {
            this.scheduleTasks(file.path);
            void this.refreshFile(file).then(() => { if (file.path.endsWith('.board.json')) void this.syncRelations(); }).catch(e => this.report(e));
        } };
        plugin.registerEvent(plugin.app.vault.on('create', changed));
        plugin.registerEvent(plugin.app.vault.on('modify', changed));
        plugin.registerEvent(plugin.app.metadataCache.on('changed', changed));
        plugin.registerEvent(plugin.app.vault.on('delete', file => { this.index.remove(file.path); this.documents.delete(file.path); this.warnings.delete(file.path); this.refreshDuplicateWarnings(); this.emit(file.path); if (this.initialized) { this.scheduleTasks(file.path); void this.syncRelations(); } }));
        plugin.registerEvent(plugin.app.vault.on('rename', (file, old) => {
            if (this.worldPath.startsWith(old + '/') && !(file instanceof TFile)) {
                this.worldPath = file.path + this.worldPath.slice(old.length);
                if (this.settings.root === old || this.settings.root.startsWith(old + '/')) this.plugin.settings.design.root = file.path + this.settings.root.slice(old.length);
                void plugin.saveSettings().catch(error => this.report(error));
            }
            this.index.remove(old); this.documents.delete(old); this.warnings.delete(old);
            if (this.initialized && file instanceof TFile) void this.refreshFile(file, false).then(() => { this.emit(old); this.emit(file.path); return this.syncRelations(); }).catch(e => this.report(e));
            else if (this.initialized) void (async () => {
                for (const entity of this.index.all().filter(entity => entity.path.startsWith(old + '/'))) this.index.remove(entity.path);
                for (const path of this.documents.keys()) if (path.startsWith(old + '/')) this.documents.delete(path);
                for (const child of plugin.app.vault.getFiles().filter(child => child.path.startsWith(file.path + '/'))) await this.refreshFile(child);
                await this.syncRelations(); this.emit(file.path);
            })().catch(e => this.report(e));
        }));
    }
    get settings(): DesignSettings { return this.plugin.settings.design; }
    tr(key: TranslationKey, ...args: unknown[]): string { return t(this.plugin.settings.language, key, ...args); }
    report(error: unknown): void { new Notice(error instanceof DesignError ? `${this.tr(error.key)}${error.detail ? ': ' + error.detail : ''}` : `${this.tr('design_error')}: ${String(error)}`, 8000); }
    subscribe(listener: (path: string) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    private emit(path: string): void { if (!this.disposed) { if (!path.endsWith('.board.json')) this.dataVersion++; this.listeners.forEach(listener => listener(path)); } }
    initialize(): Promise<void> {
        return this.initialized ??= (async () => {
            this.worldPath = `${this.settings.root}/${WORLD_CONFIG}`;
            const config = this.plugin.app.vault.getAbstractFileByPath(this.worldPath);
            if (config instanceof TFile) await this.refreshFile(config, false);
            for (const file of this.plugin.app.vault.getFiles()) {
                const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
                if (file.path.endsWith('.board.json') || (file.extension === 'md' && (fm?.design_id || file.path.startsWith(this.settings.root + '/')))) await this.refreshFile(file, false);
            }
            await this.refreshTasks();
            await this.migratePriority();
            if (this.world && JSON.stringify(this.world.types) !== JSON.stringify(this.settings.types)) {
                const registry = { ...this.world, types: clone(this.settings.types) }, raw = JSON.stringify(registry, null, 2) + '\n';
                const file = this.plugin.app.vault.getAbstractFileByPath(this.worldPath);
                if (file instanceof TFile) { this.writing.add(this.worldPath); try { await this.plugin.app.vault.process(file, current => { if (current !== this.worldRaw) throw new DesignError('design_conflict'); return raw; }); this.world = registry; this.worldRaw = raw; } finally { this.writing.delete(this.worldPath); } }
            }
            this.refreshDuplicateWarnings();
            this.emit('');
        })();
    }
    async refreshFile(file: TFile, notify = true): Promise<void> {
        if (this.writing.has(file.path)) return;
        if (file.path === (this.worldPath || `${this.settings.root}/${WORLD_CONFIG}`)) {
            try {
                const raw = await this.plugin.app.vault.read(file), registry = parseWorld(raw, this.settings);
                this.world = registry; this.worldRaw = raw; this.worldPath = file.path;
                this.plugin.settings.design.types = clone(registry.types);
                this.warnings.delete(file.path);
                for (const entity of this.index.all()) { const note = this.plugin.app.vault.getAbstractFileByPath(entity.path); if (note instanceof TFile) await this.refreshFile(note, false); }
            } catch (error) { this.warnings.set(file.path, error instanceof DesignError ? this.tr(error.key) : String(error)); }
        } else if (file.path.endsWith('.board.json')) {
            try { const raw = await this.plugin.app.vault.read(file); const board = parseBoard(raw); this.documents.set(file.path, { board, path: file.path, raw }); this.warnings.delete(file.path); }
            catch (e) { this.documents.delete(file.path); this.warnings.set(file.path, e instanceof DesignError ? this.tr(e.key) : String(e)); }
        } else if (file.extension === 'md') {
            const cached = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
            if (!cached?.design_id && !file.path.startsWith(this.settings.root + '/') && !this.index.all().some(entity => entity.path === file.path)) return;
            try {
                const raw = await this.plugin.app.vault.read(file); const fm = splitNote(raw).frontmatter;
                const entity = parseEntity(file.path, raw, this.settings.types.find(type => type.id === fm.design_type)?.fields);
                this.index.remove(file.path); if (entity) this.index.upsert(entity); this.warnings.delete(file.path);
            } catch (e) { this.warnings.set(file.path, String(e)); }
        } else return;
        this.refreshDuplicateWarnings();
        if (notify) this.emit(file.path);
    }
    private refreshDuplicateWarnings(): void {
        for (const key of this.warnings.keys()) if (key.startsWith('duplicate:')) this.warnings.delete(key);
        for (const id of this.index.duplicates()) this.warnings.set('duplicate:' + id, this.tr('design_duplicate'));
        const seen = new Set<string>(); for (const doc of this.documents.values()) { if (seen.has(doc.board.id)) this.warnings.set('duplicate:board:' + doc.board.id, this.tr('design_duplicate_board')); seen.add(doc.board.id); }
    }
    boards(): BoardDocument[] { return [...this.documents.values()].sort((a, b) => a.board.name.localeCompare(b.board.name)); }
    /** Records that are not placed on any board: the "Inbox" (Milanote's Unsorted notes). */
    unplacedEntities(): DesignEntity[] { const placed = new Set(this.boards().flatMap(doc => doc.board.items.flatMap(item => item.kind === 'entity' && item.ref ? [item.ref] : []))); return this.index.all().filter(entity => !placed.has(entity.id)); }
    resolveBoard(id: string): BoardDocument | undefined { const matches = this.boards().filter(doc => doc.board.id === id); return matches.length === 1 ? matches[0] : undefined; }
    async ensureFolder(path: string): Promise<void> {
        const pieces = vaultPath(path).split('/'); let current = '';
        for (const piece of pieces) { current = current ? `${current}/${piece}` : piece; if (!this.plugin.app.vault.getAbstractFileByPath(current)) await this.plugin.app.vault.createFolder(current); }
    }
    private uniquePath(folder: string, name: string, extension: string): string {
        const base = `${vaultPath(folder)}/${fileName(name)}`; let path = base + extension, suffix = 2;
        while (this.plugin.app.vault.getAbstractFileByPath(path)) path = `${base} ${suffix++}${extension}`;
        return path;
    }
    async createEntity(typeId: string, title: string, values: Record<string, unknown>, body = ''): Promise<DesignEntity> {
        const type = this.settings.types.find(type => type.id === typeId); if (!type) throw new DesignError('design_invalid');
        values = this.statusSnapshot(typeId, values);
        validateValues(type, values); const folder = `${this.settings.root}/${type.folder}`; await this.ensureFolder(folder);
        const path = this.uniquePath(folder, title, '.md');
        const entity: DesignEntity = { id: uid(), type: typeId, path, title: fileName(title), values, body, raw: '' };
        const raw = serializeEntity(entity, type.fields); await this.plugin.app.vault.create(path, raw);
        const result = parseEntity(path, raw, type.fields)!; this.index.upsert(result); this.emit(path); return result;
    }
    async saveEntity(entity: DesignEntity, title: string): Promise<DesignEntity> {
        entity = { ...entity, values: this.statusSnapshot(entity.type, entity.values) };
        const type = this.settings.types.find(type => type.id === entity.type);
        const previous = parseEntity(entity.path, entity.raw, type?.fields);
        // A removed option stays visible and can be repaired later; editing another field must still work.
        const validationType = type && previous?.type === entity.type ? { ...type, fields: type.fields.filter(field => {
            if (!['select', 'multiselect'].includes(field.kind) || JSON.stringify(entity.values[field.id]) !== JSON.stringify(previous.values[field.id])) return true;
            const value = entity.values[field.id];
            return !(field.kind === 'select' ? typeof value === 'string' && value !== '' && !field.options?.some(option => option.value === value) : Array.isArray(value) && value.some(item => !field.options?.some(option => option.value === item)));
        }) } : type;
        validateValues(validationType, entity.values);
        const file = this.plugin.app.vault.getAbstractFileByPath(entity.path); if (!(file instanceof TFile)) throw new DesignError('design_conflict');
        const name = fileName(title); const folder = file.path.slice(0, file.path.lastIndexOf('/')); const next = `${folder}/${name}.md`;
        if (file.basename !== name && this.plugin.app.vault.getAbstractFileByPath(next)) throw new DesignError('design_duplicate', name);
        const relations = boardRelations(this.boards().map(doc => doc.board));
        const links = [...(relations.get(entity.id) || [])].flatMap(id => { const target = this.index.resolve(id); return target ? [{ id, path: target.path, title: target.title }] : []; });
        const serialized = serializeEntity(entity, type?.fields);
        const raw = [...this.warnings.keys()].some(key => key.endsWith('.board.json') || key.startsWith('duplicate:')) ? serialized : replaceManagedLinks(serialized, links);
        this.writing.add(file.path);
        try { await this.plugin.app.vault.process(file, current => { if (current !== entity.raw) throw new DesignError('design_conflict'); return raw; }); }
        finally { this.writing.delete(file.path); }
        if (file.basename !== name) await this.plugin.app.fileManager.renameFile(file, next);
        this.index.remove(entity.path); const result = parseEntity(file.path, await this.plugin.app.vault.read(file), type?.fields)!; this.index.upsert(result); this.emit(file.path); void this.syncRelations(); return result;
    }
    async createBoard(name: string): Promise<BoardDocument> {
        const folder = `${this.settings.root}/Доски`; await this.ensureFolder(folder); const board = newBoard(name.trim()); const path = this.uniquePath(folder, name, '.board.json'); const raw = serializeBoard(board);
        await this.plugin.app.vault.create(path, raw); const doc = { board, path, raw }; this.documents.set(path, doc); this.emit(path); return doc;
    }
    async copyBoard(doc: BoardDocument): Promise<BoardDocument> { const original = clone(doc.board); const copy = await this.createBoard(`${original.name} (${this.tr('design_copy')})`); const board = { ...original, id: copy.board.id, name: copy.board.name, format: 2 } as DesignBoard; await this.saveBoard(board, copy.path, copy.raw); return this.documents.get(copy.path)!; }
    async writeExport(name: string, extension: string, content: string | ArrayBuffer): Promise<string> { const folder = `${this.settings.root}/Exports`; await this.ensureFolder(folder); const path = this.uniquePath(folder, name, '.' + extension); if (typeof content === 'string') await this.plugin.app.vault.create(path, content); else await this.plugin.app.vault.createBinary(path, content); new Notice(`${this.tr('design_exported')}: ${path}`); return path; }
    async importAsset(file: File): Promise<string> { const folder = `${this.settings.root}/Assets`; await this.ensureFolder(folder); const path = this.uniquePath(folder, `${uid()}-${file.name || 'clipboard.png'}`, ''); await this.plugin.app.vault.createBinary(path, await file.arrayBuffer()); return path; }
    saveBoard(board: DesignBoard, path: string, expected: string): Promise<string> {
        const task = this.queue.catch(() => undefined).then(async () => {
            const raw = serializeBoard(board); const file = this.plugin.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) throw new DesignError('design_conflict');
            this.writing.add(path);
            try { await this.plugin.app.vault.process(file, current => { if (current !== expected) throw new DesignError('design_conflict'); return raw; }); }
            finally { this.writing.delete(path); }
            this.documents.set(path, { board: parseBoard(raw), path, raw }); this.emit(path);
            await this.syncRelations(); return raw;
        }); this.queue = task; return task;
    }
    async renameBoard(doc: BoardDocument, name: string): Promise<void> {
        const board = { ...doc.board, name: name.trim() }; const raw = await this.saveBoard(board, doc.path, doc.raw);
        const file = this.plugin.app.vault.getAbstractFileByPath(doc.path);
        if (!(file instanceof TFile)) throw new DesignError('design_conflict');
        const folder = doc.path.slice(0, doc.path.lastIndexOf('/')); const desired = `${folder}/${fileName(name)}.board.json`;
        const path = desired === doc.path ? doc.path : this.uniquePath(folder, name, '.board.json');
        if (path === doc.path) return;
        await this.plugin.app.vault.rename(file, path); this.documents.delete(doc.path); this.documents.set(path, { board, path, raw }); this.emit(path);
    }
    isDeletingBoard(id: string): boolean { return this.deletingBoards.has(id); }
    async deleteBoard(doc: BoardDocument): Promise<void> {
        this.deletingBoards.add(doc.board.id);
        try { await this.queue.catch(() => undefined); const file = this.plugin.app.vault.getAbstractFileByPath(doc.path); if (file instanceof TFile) await this.plugin.app.fileManager.trashFile(file); this.documents.delete(doc.path); this.emit(doc.path); await this.syncRelations(); }
        finally { this.deletingBoards.delete(doc.board.id); }
    }
    async deleteEntity(entity: DesignEntity): Promise<void> { const file = this.plugin.app.vault.getAbstractFileByPath(entity.path); if (file instanceof TFile) await this.plugin.app.fileManager.trashFile(file); this.index.remove(entity.path); this.emit(entity.path); }
    syncRelations(): Promise<void> {
        this.relationsQueue = this.relationsQueue.catch(() => undefined).then(async () => {
            // Incomplete indexes must not cause deletion of otherwise valid generated links.
            if ([...this.warnings.keys()].some(key => key.endsWith('.board.json') || key.startsWith('duplicate:'))) return;
            const desired = boardRelations(this.boards().map(doc => doc.board));
            const paths = new Set(this.index.all().map(entity => entity.path));
            for (const path of this.relationsState.keys()) if (!paths.has(path)) this.relationsState.delete(path);
            for (const entity of this.index.all()) {
                if (!this.index.resolve(entity.id)) continue;
                const links = [...(desired.get(entity.id) || [])].sort().flatMap(id => { const target = this.index.resolve(id); return target ? [{ id, path: target.path, title: target.title }] : []; });
                const signature = JSON.stringify(links), previous = this.relationsState.get(entity.path);
                if (previous?.raw === entity.raw && previous.signature === signature) continue;
                // The index already contains the note text. Layout-only saves require no vault reads.
                if (replaceManagedLinks(entity.raw, links) === entity.raw) { this.relationsState.set(entity.path, { raw: entity.raw, signature }); continue; }
                const file = this.plugin.app.vault.getAbstractFileByPath(entity.path); if (!(file instanceof TFile)) continue;
                this.writing.add(file.path);
                let raw: string;
                try { raw = await this.plugin.app.vault.process(file, current => replaceManagedLinks(current, links)); }
                finally { this.writing.delete(file.path); }
                const fields = this.settings.types.find(type => type.id === entity.type)?.fields;
                const updated = parseEntity(file.path, raw, fields);
                this.index.remove(file.path); if (updated) this.index.upsert(updated);
                this.relationsState.set(file.path, { raw, signature }); this.emit(file.path);
            }
            this.warnings.delete('relations');
        }).catch(error => { this.warnings.set('relations', error instanceof DesignError ? this.tr(error.key) : String(error)); this.emit(''); this.report(error); }); return this.relationsQueue;
    }
    async saveSchema(value: unknown, expectedTypes?: string): Promise<void> {
        const schema = validateSchema(value);
        const previousSettings = clone(this.settings);
        if (expectedTypes !== undefined && JSON.stringify(previousSettings.types) !== expectedTypes) throw new DesignError('design_conflict');
        for (const type of schema.types) for (const field of type.fields) {
            const previous = this.settings.types.find(candidate => candidate.id === type.id)?.fields.find(candidate => candidate.id === field.id);
            if (previous && previous.kind !== field.kind && this.fieldHasData(type.id, field.id)) throw new DesignError('design_kind_locked', `${type.name}: ${field.name}`);
        }
        const nextPath = `${schema.root}/${WORLD_CONFIG}`;
        if (schema.root !== previousSettings.root && this.plugin.app.vault.getAbstractFileByPath(nextPath)) throw new DesignError('design_conflict', nextPath);
        await this.initializeWorld();
        await this.updateWorld(registry => {
            if (expectedTypes !== undefined && JSON.stringify(registry.types) !== expectedTypes) throw new DesignError('design_conflict');
            Object.assign(registry, reconcileWorld(registry, schema.types, this.plugin.settings.language === 'ru' ? undefined : ['Table', 'Kanban']));
        });
        for (const entity of this.index.all()) {
            const previous = previousSettings.types.find(type => type.id === entity.type), next = schema.types.find(type => type.id === entity.type);
            const renamed = previous?.fields.filter(field => field.kind === 'longtext' && next?.fields.some(candidate => candidate.id === field.id && candidate.kind === 'longtext' && candidate.name !== field.name)) || [];
            if (!renamed.length) continue;
            const file = this.plugin.app.vault.getAbstractFileByPath(entity.path); if (!(file instanceof TFile)) continue;
            this.writing.add(file.path);
            try { await this.plugin.app.vault.process(file, raw => { const { body } = splitNote(raw); let updated = body; for (const field of renamed) { const target = next!.fields.find(candidate => candidate.id === field.id)!; updated = replaceLongValue(updated, target.name, longValue(updated, field.name, field.id), field.id); } return raw.slice(0, raw.length - body.length) + updated; }); }
            finally { this.writing.delete(file.path); }
        }
        if (schema.root !== previousSettings.root) {
            await this.ensureFolder(schema.root);
            const config = this.plugin.app.vault.getAbstractFileByPath(this.worldPath);
            if (config instanceof TFile) { this.writing.add(nextPath); try { await this.plugin.app.vault.rename(config, nextPath); this.worldPath = nextPath; } finally { this.writing.delete(nextPath); } }
        }
        this.plugin.settings.design = schema; await this.plugin.saveSettings();
        for (const entity of this.index.all()) { const file = this.plugin.app.vault.getAbstractFileByPath(entity.path); if (file instanceof TFile) await this.refreshFile(file, false); }
        await this.refreshTasks(); this.emit('');
    }
    fieldHasData(typeId: string, fieldId: string): boolean { return this.index.all().some(entity => entity.type === typeId && entity.values[fieldId] !== undefined && entity.values[fieldId] !== null && entity.values[fieldId] !== '' && (!Array.isArray(entity.values[fieldId]) || (entity.values[fieldId] as unknown[]).length > 0)); }
    initializeWorld(): Promise<WorldRegistry> {
        return this.worldLoading ??= (async () => {
            await this.initialize();
            this.worldPath ||= `${this.settings.root}/${WORLD_CONFIG}`;
            const file = this.plugin.app.vault.getAbstractFileByPath(this.worldPath);
            if (file instanceof TFile) {
                const raw = await this.plugin.app.vault.read(file);
                this.world = parseWorld(raw, this.settings); this.worldRaw = raw;
                if (/"kind"\s*:\s*"gallery"/.test(raw)) {
                    const migrated = JSON.stringify(this.world, null, 2) + '\n'; this.writing.add(this.worldPath);
                    try { await this.plugin.app.vault.process(file, current => { if (current !== raw) throw new DesignError('design_conflict', WORLD_CONFIG); return migrated; }); this.worldRaw = migrated; }
                    finally { this.writing.delete(this.worldPath); }
                }
            } else {
                const registry = bootstrapWorld(this.settings, this.plugin.settings.language === 'ru');
                const raw = JSON.stringify(registry, null, 2) + '\n';
                await this.ensureFolder(this.settings.root); this.writing.add(this.worldPath);
                try { await this.plugin.app.vault.create(this.worldPath, raw); }
                finally { this.writing.delete(this.worldPath); }
                this.world = registry; this.worldRaw = raw;
            }
            this.plugin.settings.design.types = clone(this.world.types); await this.plugin.saveSettings(); this.emit(this.worldPath);
            return this.world;
        })().catch(error => { this.worldLoading = undefined; throw error; });
    }
    /** Serialized, optimistic updates prevent two panels or a synced vault from silently losing views. */
    updateWorld(change: (registry: WorldRegistry) => void): Promise<void> {
        const task = this.worldQueue.catch(() => undefined).then(async () => {
            await this.initializeWorld();
            let registry = clone(this.world!); change(registry);
            registry = parseWorld(JSON.stringify(registry), this.settings);
            const raw = JSON.stringify(registry, null, 2) + '\n';
            const file = this.plugin.app.vault.getAbstractFileByPath(this.worldPath);
            if (!(file instanceof TFile)) throw new DesignError('design_conflict', WORLD_CONFIG);
            this.writing.add(this.worldPath);
            try { await this.plugin.app.vault.process(file, current => { if (current !== this.worldRaw) throw new DesignError('design_conflict', WORLD_CONFIG); return raw; }); }
            catch (error) { this.writing.delete(this.worldPath); await this.refreshFile(file); throw error; }
            finally { this.writing.delete(this.worldPath); }
            this.world = registry; this.worldRaw = raw; this.plugin.settings.design.types = clone(registry.types);
            await this.plugin.saveSettings(); this.emit(this.worldPath);
        }); this.worldQueue = task; return task;
    }
    async saveWorldView(typeId: string, view: WorldView, expectedView?: string): Promise<void> {
        const snapshot = clone(view);
        await this.updateWorld(registry => { const dataset = registry.datasets.find(dataset => dataset.id === typeId); if (!dataset) throw new DesignError('design_conflict'); const index = dataset.views.findIndex(candidate => candidate.id === snapshot.id); if (expectedView !== undefined && (index < 0 || JSON.stringify(dataset.views[index]) !== expectedView)) throw new DesignError('design_conflict'); if (index < 0) dataset.views.push(snapshot); else dataset.views[index] = snapshot; });
    }
    async updateWorldValue(id: string, fieldId: string, value: unknown, expected: string): Promise<DesignEntity> {
        const entity = this.index.resolve(id); if (!entity || entity.raw !== expected) throw new DesignError('design_conflict');
        const field = this.settings.types.find(type => type.id === entity.type)?.fields.find(field => field.id === fieldId);
        if (fieldId !== 'title' && (!field || field.kind === 'status')) throw new DesignError('design_invalid');
        const next = clone(entity);
        if (fieldId === 'title') return this.saveEntity(next, String(value));
        next.values[fieldId] = value;
        if (field?.kind === 'longtext') next.body = replaceLongValue(next.body, field.name, String(value ?? ''), field.id);
        return this.saveEntity(next, next.title);
    }
    /** Changing a table is explicit and keeps the UUID, body and unrecognized fields. */
    async moveWorldRecord(id: string, typeId: string): Promise<DesignEntity> {
        const entity = this.index.resolve(id), type = this.settings.types.find(type => type.id === typeId);
        if (!entity || !type) throw new DesignError('design_invalid');
        if (entity.type === typeId) return entity;
        const updated = await this.saveEntity({ ...clone(entity), type: typeId }, entity.title);
        const folder = `${this.settings.root}/${type.folder}`; await this.ensureFolder(folder);
        const file = this.plugin.app.vault.getAbstractFileByPath(updated.path);
        if (!(file instanceof TFile)) throw new DesignError('design_conflict');
        const path = this.uniquePath(folder, updated.title, '.md');
        await this.plugin.app.fileManager.renameFile(file, path); this.index.remove(updated.path);
        await this.refreshFile(file); this.emit(updated.path); void this.syncRelations();
        return this.index.resolve(id)!;
    }
    optionLabel(option: NonNullable<DesignSettings['types'][number]['fields'][number]['options']>[number]): string { return option.labelKey ? this.tr(option.labelKey) : option.value; }
    private async migratePriority(): Promise<void> {
        const field = this.settings.types.find(type => type.id === 'idea')?.fields.find(field => field.id === 'priority');
        if (field?.kind !== 'select' || field.options?.length !== 3) return;
        const keys = ['low', 'medium', 'high'] as const;
        const aliases = new Map<string, typeof keys[number]>();
        for (const key of keys) { aliases.set(key, key); aliases.set(t('ru', `design_${key}`), key); aliases.set(t('en', `design_${key}`), key); }
        const resolved = field.options.map(option => aliases.get(option.value));
        if (resolved.some(value => !value) || new Set(resolved).size !== 3 || field.options.every(option => option.labelKey)) return;
        for (const entity of this.index.all().filter(entity => entity.type === 'idea')) {
            const value = aliases.get(String(entity.values.priority)); if (!value || entity.values.priority === value) continue;
            const file = this.plugin.app.vault.getAbstractFileByPath(entity.path); if (!(file instanceof TFile)) continue;
            this.writing.add(file.path);
            let raw: string;
            try { raw = await this.plugin.app.vault.process(file, current => { const latest = parseEntity(file.path, current, this.settings.types.find(type => type.id === 'idea')!.fields); const priority = aliases.get(String(latest?.values.priority)); return latest && priority ? serializeEntity({ ...latest, values: { ...latest.values, priority } }, this.settings.types.find(type => type.id === 'idea')!.fields) : current; }); }
            finally { this.writing.delete(file.path); }
            const updated = parseEntity(file.path, raw, this.settings.types.find(type => type.id === 'idea')!.fields); if (updated) this.index.upsert(updated);
        }
        field.options = field.options.map((option, index) => ({ ...option, value: resolved[index]!, labelKey: `design_${resolved[index]!}` }));
        await this.plugin.saveSettings();
    }
    async exportSchema(): Promise<void> { await this.ensureFolder(this.settings.root); const path = this.uniquePath(this.settings.root, 'design-schema', '.json'); await this.plugin.app.vault.create(path, JSON.stringify(this.settings, null, 2) + '\n'); new Notice(`${this.tr('design_exported')}: ${path}`); }
    project() { return this.plugin.settings.projectScopes.find(scope => scope.id === this.settings.projectId) || this.plugin.settings.projectScopes.find(scope => `${scope.name} ${scope.sourceValue}`.toLowerCase().includes('factory farm dungeon mining')); }
    async refreshTasks(): Promise<void> { const project = this.project(); this.tasks = project ? await this.plugin.projectEngine.loadTasks(project) : []; }
    private scheduleTasks(path: string): void {
        const project = this.project(); if (!project) return;
        const source = project.sourceValue.replace(/\.md$/i, '');
        if (project.sourceType === 'file' && path !== project.sourceValue && !path.startsWith(source + '.')) return;
        if (project.sourceType === 'folder' && !path.startsWith(project.sourceValue + '/')) return;
        clearTimeout(this.taskTimer); this.taskTimer = setTimeout(() => { void this.refreshTasks().then(() => this.emit('')).catch(error => this.report(error)); }, 500);
    }
    statuses(): string[] { const project = this.project(); return project ? statusNames(project) : []; }
    private statusSnapshot(typeId: string, values: Record<string, unknown>): Record<string, unknown> {
        const fields = this.settings.types.find(type => type.id === typeId)?.fields || [];
        const taskField = fields.find(field => field.kind === 'task');
        const task = this.tasks.find(task => task.id === values[taskField?.id || '']);
        if (taskField && Object.prototype.hasOwnProperty.call(values, taskField.id) && !values[taskField.id]) return { ...values, ...Object.fromEntries(fields.filter(field => field.kind === 'status').map(field => [field.id, undefined])) };
        return task ? { ...values, ...Object.fromEntries(fields.filter(field => field.kind === 'status').map(field => [field.id, task.status])) } : values;
    }
    taskText(id: string): string { const task = this.tasks.find(task => task.id === id); return task ? `${isDone(task.status) || task.status === this.statuses().at(-1) ? '☑' : '☐'} ${task.section || ''} · ${task.name}` : this.tr('design_not_found'); }
    async openTask(id: string): Promise<void> {
        const task = this.tasks.find(task => task.id === id);
        if (!task) throw new DesignError('design_invalid');
        const file = task.file || this.plugin.app.vault.getAbstractFileByPath(this.project()?.sourceValue || '');
        if (!(file instanceof TFile)) throw new DesignError('design_invalid');
        await this.plugin.app.workspace.getLeaf('tab').openFile(file, { eState: { line: task.sourceLine || 0 } });
    }
    async createLinkedTask(id: string, name: string, section = ''): Promise<DesignEntity> {
        const entity = this.index.resolve(id), project = this.project();
        const field = this.settings.types.find(type => type.id === entity?.type)?.fields.find(field => field.kind === 'task');
        if (!entity || !project || !field || entity.values[field.id] || this.creatingTasks.has(id)) throw new DesignError('design_conflict');
        this.creatingTasks.add(id);
        try {
            if (section && this.plugin.projectEngine.loadStages && !(await this.plugin.projectEngine.loadStages(project)).some(stage => stage.title === section)) throw new DesignError('design_conflict', section);
            const task = await this.plugin.projectEngine.createTask(project, { name, description: `[[${entity.path.replace(/\.md$/, '')}|${entity.title}]]` }, section ? { kind: 'stage', section } : { kind: 'root' });
            await this.refreshTasks();
            const latest = this.index.resolve(id);
            if (!latest || latest.values[field.id]) { await this.openTask(task.id); throw new Error(this.plugin.settings.language === 'ru' ? 'Задача создана и открыта. Запись изменилась; привяжи задачу вручную.' : 'Task created and opened. The record changed; link the task manually.'); }
            try { return await this.updateWorldValue(id, field.id, task.id, latest.raw); }
            catch (error) { await this.openTask(task.id); throw new Error(`${this.plugin.settings.language === 'ru' ? 'Задача создана и открыта. Ссылка не сохранена; выбери эту задачу в записи.' : 'Task created and opened. Link was not saved; select this task in the record.'} ${String(error)}`); }
        } finally { this.creatingTasks.delete(id); }
    }
    displayValue(entity: DesignEntity, fieldId: string): string {
        const field = this.settings.types.find(type => type.id === entity.type)?.fields.find(field => field.id === fieldId); const value = entity.values[fieldId];
        if (field?.kind === 'entity') return this.index.resolve(String(value))?.title || (value ? this.tr('design_not_found') : '');
        if (field?.kind === 'task') return value ? this.taskText(String(value)) : '';
        if (field?.kind === 'status') { const taskField = this.settings.types.find(type => type.id === entity.type)?.fields.find(field => field.kind === 'task'); const task = this.tasks.find(task => task.id === entity.values[taskField?.id || '']); return task?.status || String(value || ''); }
        if (field?.kind === 'select' || field?.kind === 'multiselect') { const label = (value: unknown) => { const option = field.options?.find(option => option.value === value); return option ? this.optionLabel(option) : String(value ?? ''); }; return Array.isArray(value) ? value.map(label).join(', ') : label(value); }
        if (typeof value === 'boolean') return value ? '☑' : '☐'; return Array.isArray(value) ? value.join(', ') : String(value ?? '');
    }
    async linkPreview(address: string) {
        const url = webLink(address); if (!url) throw new DesignError('design_invalid');
        const response = await previewRequest(url);
        if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
        const preview = parseLinkPreview(response.text, url), image = preview.image; preview.image = undefined;
        if (image) {
            try {
                const source = await previewRequest(image);
                const mime = Object.entries(source.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.split(';')[0]?.trim();
                const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' } as Record<string, string>)[mime || ''];
                if (source.status === 200 && extension && source.arrayBuffer.byteLength <= 8000000) preview.image = await this.importAsset(new File([source.arrayBuffer], `link-preview.${extension}`, { type: mime }));
            } catch { /* The link remains usable when its image is unavailable. */ }
        }
        return preview;
    }
    async setBoardAppearance(id: string, values: Pick<DesignBoard, 'cover' | 'icon'>): Promise<void> {
        const doc = this.resolveBoard(id); if (!doc || doc.board.readOnly) throw new DesignError('design_invalid');
        await this.saveBoard({ ...clone(doc.board), ...values }, doc.path, doc.raw);
    }
    image(path: string): string { try { const safe = vaultPath(path); const file = this.plugin.app.vault.getAbstractFileByPath(safe); return file instanceof TFile ? this.plugin.app.vault.getResourcePath(file) : ''; } catch { return ''; } }
    dispose(): void { this.disposed = true; clearTimeout(this.taskTimer); this.listeners.clear(); }
}
