import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type HabitTimerPlugin from '../src/main';
import { defaultDesignSettings } from '../src/design/schema';
import { DesignService } from '../src/design/service';
import { BoardSession } from '../src/design/session';
import { parseBoard, serializeBoard } from '../src/design/board';
import { clone } from '../src/design/types';
import { splitNote } from '../src/design/markdown';

function fixture() {
    const files = new Map<string, { file: TFile; raw: string }>(), folders = new Set<string>();
    const listeners = new Map<string, ((...args: any[]) => void)[]>();
    const emit = (key: string, ...args: any[]) => listeners.get(key)?.forEach(listener => listener(...args));
    const on = (key: string, callback: (...args: any[]) => void) => { const values = listeners.get(key) || []; values.push(callback); listeners.set(key, values); return {}; };
    const vault = {
        on, getFiles: () => [...files.values()].map(value => value.file), getAbstractFileByPath: (path: string) => files.get(path)?.file || (folders.has(path) ? { path } : undefined),
        read: vi.fn(async (file: TFile) => { if (!files.has(file.path)) throw new Error('missing'); return files.get(file.path)!.raw; }),
        createFolder: vi.fn(async (path: string) => { folders.add(path); }),
        create: vi.fn(async (path: string, raw: string) => { if (files.has(path)) throw new Error('exists'); const file = new TFile(path); files.set(path, { file, raw }); emit('create', file); return file; }),
        process: vi.fn(async (file: TFile, change: (value: string) => string) => { const entry = files.get(file.path)!; const result = change(entry.raw); entry.raw = result; emit('modify', file); return result; }),
        rename: vi.fn(async (file: TFile, path: string) => { const old = file.path, entry = files.get(old)!; files.delete(old); file.path = path; file.basename = path.split('/').pop()!.replace(/\.md$/, ''); files.set(path, entry); emit('rename', file, old); }),
        getResourcePath: (file: TFile) => 'vault:' + file.path,
    };
    const plugin = {
        settings: { language: 'ru', design: defaultDesignSettings('ru'), projectScopes: [{ id: 'game', name: 'Factory Farm Dungeon Mining', statuses: 'Todo, Doing, Done', sourceType: 'file', sourceValue: 'Checklist.md' }] },
        registerEvent: vi.fn(), saveSettings: vi.fn(async () => undefined),
        projectEngine: { loadTasks: vi.fn(async () => [{ id: 'task1', name: '25.3 Build', section: '25 Mining', status: 'Done' }]) },
        app: { vault, metadataCache: { on, getFileCache: (file: TFile) => ({ frontmatter: file.extension === 'md' ? splitNote(files.get(file.path)?.raw || '').frontmatter : undefined }) }, fileManager: { renameFile: vault.rename, trashFile: vi.fn(async (file: TFile) => { files.delete(file.path); emit('delete', file); }) } },
    } as unknown as HabitTimerPlugin;
    const service = new DesignService(plugin);
    return { files, vault, service, plugin, emit };
}
describe('design vault integration', () => {
    it('clears warnings for deleted corrupt boards so relation sync can resume', async () => {
        const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('Broken');
        f.files.get(doc.path)!.raw = '{bad'; await f.service.refreshFile(f.files.get(doc.path)!.file); expect(f.service.warnings.has(doc.path)).toBe(true);
        await f.plugin.app.fileManager.trashFile(f.files.get(doc.path)!.file); await f.service.syncRelations(); expect(f.service.warnings.has(doc.path)).toBe(false);
    });
    it('copies a snapshot captured before asynchronous file creation', async () => {
        const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('Original');
        doc.board.items = [{ id: 'a', kind: 'sticky', text: 'At copy time', x: 20, y: 20, w: 100, h: 80, z: 1 }];
        const copying = f.service.copyBoard(doc); doc.board.items[0]!.text = 'Later edit'; const copy = await copying;
        expect(copy.board.items[0]!.text).toBe('At copy time'); expect(doc.board.items[0]!.text).toBe('Later edit');
    });
    it('saves layout with 500 records without reading notes and only processes affected links', async () => {
        const f = fixture(); await f.service.initialize();
        for (let i = 0; i < 500; i++) await f.service.createEntity('idea', 'Record ' + i, {});
        const [a, b] = f.service.index.all(), doc = await f.service.createBoard('World');
        doc.board.items = [a!, b!].map((entity, i) => ({ id: String(i), ref: entity.id, kind: 'entity', x: i * 250, y: 0, w: 200, h: 100, z: 1 }));
        await f.service.syncRelations(); f.vault.read.mockClear(); f.vault.process.mockClear();
        let raw = await f.service.saveBoard(doc.board, doc.path, doc.raw);
        expect(f.vault.read).not.toHaveBeenCalled(); expect(f.vault.process).toHaveBeenCalledTimes(1);
        f.vault.process.mockClear(); doc.board.edges = [{ id: 'e', from: '0', to: '1', style: 'straight', label: '', arrow: 'both' }];
        raw = await f.service.saveBoard(doc.board, doc.path, raw);
        expect(f.vault.read).not.toHaveBeenCalled(); expect(f.vault.process.mock.calls.map(call => call[0].path)).toEqual([doc.path, a!.path]);
        expect(f.service.index.resolve(a!.id)?.raw).toContain(b!.title + ']]');
        f.vault.process.mockClear(); doc.board.viewport.x = 123; raw = await f.service.saveBoard(doc.board, doc.path, raw);
        expect(f.vault.process).toHaveBeenCalledTimes(1); expect(f.vault.read).not.toHaveBeenCalled();
        const renamed = await f.service.saveEntity(f.service.index.resolve(b!.id)!, 'Target renamed'); await f.service.syncRelations();
        expect(f.files.get(a!.path)!.raw).toContain(renamed.title + ']]');
        f.vault.read.mockClear(); f.vault.process.mockClear(); doc.board.edges = []; await f.service.saveBoard(doc.board, doc.path, raw);
        expect(f.vault.read).not.toHaveBeenCalled(); expect(f.vault.process.mock.calls.map(call => call[0].path)).toEqual([doc.path, a!.path]);
        expect(f.files.get(a!.path)!.raw).not.toContain(renamed.title + ']]');
    });
    it('blocks changing populated field kinds through schema import, including zero and false', async () => {
        const f = fixture(); await f.service.initialize(); await f.service.createEntity('character', 'A', { role: 'Trader', level: 0 });
        const schema = clone(f.service.settings); schema.types[0]!.fields[0]!.kind = 'number';
        await expect(f.service.saveSchema(schema)).rejects.toMatchObject({ key: 'design_kind_locked', detail: 'Персонажи: Роль' });
        expect(f.service.settings.types[0]!.fields[0]!.kind).toBe('text'); expect(f.service.fieldHasData('character', 'level')).toBe(true);
        schema.types[0]!.fields[0]!.kind = 'text'; schema.types[0]!.fields.find(field => field.id === 'portrait')!.kind = 'text';
        await f.service.saveSchema(schema); expect(f.service.settings.types[0]!.fields.find(field => field.id === 'portrait')!.kind).toBe('text');
        f.service.index.upsert({ ...f.service.index.all()[0]!, values: { flag: false } }); expect(f.service.fieldHasData('character', 'flag')).toBe(true);
    });
    it('migrates localized default priorities and translates labels without changing stored values', async () => {
        const f = fixture(), field = f.service.settings.types.find(type => type.id === 'idea')!.fields.find(field => field.id === 'priority')!;
        field.options = [{ value: 'Низкий', color: '#22c55e' }, { value: 'Средний', color: '#eab308' }, { value: 'Высокий', color: '#ef4444' }];
        const entity = await f.service.createEntity('idea', 'A', { priority: 'Высокий', custom: 'keep' }); await f.service.initialize();
        const updated = f.service.index.resolve(entity.id)!; expect(updated.values).toMatchObject({ priority: 'high', custom: 'keep' });
        expect(splitNote(f.files.get(entity.path)!.raw).frontmatter.priority).toBe('high'); expect(f.service.displayValue(updated, 'priority')).toBe('Высокий');
        f.plugin.settings.language = 'en'; expect(f.service.displayValue(updated, 'priority')).toBe('High');
        expect(field.options!.map(option => option.value)).toEqual(['low', 'medium', 'high']);
    });
    it('preserves custom priority options', async () => {
        const f = fixture(), field = f.service.settings.types.find(type => type.id === 'idea')!.fields.find(field => field.id === 'priority')!;
        field.options = [{ value: 'Later', color: '#123456' }]; const entity = await f.service.createEntity('idea', 'A', { priority: 'Later' }); await f.service.initialize();
        expect(f.service.index.resolve(entity.id)?.values.priority).toBe('Later'); expect(field.options[0]!.value).toBe('Later');
    });
    it('retains board display names while sanitizing file names', async () => {
        const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('World | #1');
        expect(doc.board.name).toBe('World | #1'); expect(doc.path).toContain('World - -1.board.json');
        await f.service.renameBoard(doc, 'Mine | #2'); expect(f.service.resolveBoard(doc.board.id)?.board.name).toBe('Mine | #2');
    });
    it('writes only inside the configured vault root and preserves unknown metadata', async () => { const f = fixture(); await f.service.initialize(); const e = await f.service.createEntity('character', 'Лиза', { role: 'Торговец', level: 3 }); expect(e.path.startsWith(f.service.settings.root + '/')).toBe(true); expect(splitNote(f.files.get(e.path)!.raw).frontmatter).toMatchObject({ design_id: e.id, design_type: 'character', role: 'Торговец', level: 3 }); const changed = await f.service.saveEntity({ ...e, values: { ...e.values, level: 4, custom: 'keep' } }, 'Лиза'); expect(changed.values.custom).toBe('keep'); expect(f.vault.process).toHaveBeenCalled(); });
    it('keeps a shared ref across rename and marks it missing on deletion', async () => { const f = fixture(); await f.service.initialize(); const e = await f.service.createEntity('idea', 'Old', {}); const a = await f.service.createBoard('A'), b = await f.service.createBoard('B'); for (const doc of [a, b]) { doc.board.items.push({ id: 'card', kind: 'entity', ref: e.id, x: 0, y: 0, w: 200, h: 100, z: 1 }); await f.service.saveBoard(doc.board, doc.path, doc.raw); } const renamed = await f.service.saveEntity(e, 'New'); expect(f.service.index.resolve(e.id)?.path).toBe(renamed.path); expect(f.service.boards().every(doc => doc.board.items[0]!.ref === e.id)).toBe(true); await f.service.deleteEntity(renamed); expect(f.service.index.resolve(e.id)).toBeUndefined(); });
    it('retains a generated wikilink until the last board edge is removed', async () => { const f = fixture(); await f.service.initialize(); const a = await f.service.createEntity('idea', 'Source', {}), b = await f.service.createEntity('idea', 'Target', {}); const first = await f.service.createBoard('One'), second = await f.service.createBoard('Two'); const board = clone(first.board); board.items = [a, b].map((e, index) => ({ id: String(index), kind: 'entity', ref: e.id, x: index * 300, y: 0, w: 200, h: 100, z: 1 })); board.edges = [{ id: 'edge', from: '0', to: '1', style: 'straight', label: '', arrow: 'end' }]; await f.service.saveBoard(board, first.path, first.raw); await f.service.saveBoard({ ...board, id: second.board.id }, second.path, second.raw); expect(f.files.get(a.path)!.raw).toContain('Target]]'); await f.service.deleteBoard(f.service.documents.get(first.path)!); expect(f.files.get(a.path)!.raw).toContain('Target]]'); await f.service.deleteBoard(f.service.documents.get(second.path)!); expect(f.files.get(a.path)!.raw).not.toContain('Target]]'); });
    it('rejects stale entity and board writes without replacing external changes', async () => { const f = fixture(); await f.service.initialize(); const e = await f.service.createEntity('idea', 'A', {}); f.files.get(e.path)!.raw += '\nExternal edit'; await expect(f.service.saveEntity(e, 'A')).rejects.toThrow('design_conflict'); expect(f.files.get(e.path)!.raw).toContain('External edit'); const doc = await f.service.createBoard('A'); const external = { ...doc.board, name: 'External' }; f.files.get(doc.path)!.raw = serializeBoard(external); await expect(f.service.saveBoard(doc.board, doc.path, doc.raw)).rejects.toThrow('design_conflict'); expect(parseBoard(f.files.get(doc.path)!.raw).name).toBe('External'); });
    it('exports and imports schema without deleting notes of removed types', async () => { const f = fixture(); await f.service.initialize(); const e = await f.service.createEntity('idea', 'Keep', {}); const settings = clone(f.service.settings); settings.types = settings.types.filter(type => type.id !== 'idea'); await f.service.saveSchema(settings); await f.service.exportSchema(); expect(f.files.has(e.path)).toBe(true); expect(f.service.index.resolve(e.id)?.type).toBe('idea'); const exported = [...f.files.keys()].find(path => path.endsWith('design-schema.json'))!; expect(JSON.parse(f.files.get(exported)!.raw).types).toHaveLength(8); });
    it('reads checklist completion and stores a status snapshot without invoking mutators', async () => { const f = fixture(); await f.service.initialize(); const e = await f.service.createEntity('idea', 'Linked', { task: 'task1' }); expect(f.service.taskText('task1')).toContain('☑'); expect(f.service.displayValue(e, 'status')).toBe('Done'); expect(splitNote(f.files.get(e.path)!.raw).frontmatter.status).toBe('Done'); expect(f.plugin.projectEngine.loadTasks).toHaveBeenCalledOnce(); });
    it('preserves legacy long field values while renaming their headings', async () => { const f = fixture(); await f.service.initialize(); const e = await f.service.createEntity('character', 'A', { personality: 'Keep personality' }); f.files.get(e.path)!.raw = f.files.get(e.path)!.raw.replace('<!-- design-field:personality -->\n', ''); const schema = clone(f.service.settings); schema.types[0]!.fields.find(field => field.id === 'personality')!.name = 'Новое имя'; await f.service.saveSchema(schema); expect(f.files.get(e.path)!.raw).toContain('## Новое имя'); expect(f.service.index.resolve(e.id)?.values.personality).toBe('Keep personality'); });
    it('does not delete links when a board has an unsupported format', async () => { const f = fixture(); await f.service.initialize(); const a = await f.service.createEntity('idea', 'A', {}), b = await f.service.createEntity('idea', 'B', {}); const doc = await f.service.createBoard('World'); doc.board.items = [a, b].map((entity, i) => ({ id: String(i), ref: entity.id, kind: 'entity', x: i * 250, y: 0, w: 200, h: 100, z: 1 })); doc.board.edges = [{ id: 'e', from: '0', to: '1', style: 'straight', label: '', arrow: 'end' }]; await f.service.saveBoard(doc.board, doc.path, doc.raw); const original = f.files.get(a.path)!.raw; f.files.get(doc.path)!.raw = JSON.stringify({ ...doc.board, format: 99 }); await f.service.refreshFile(f.files.get(doc.path)!.file); await f.service.syncRelations(); expect(f.files.get(a.path)!.raw).toBe(original); expect(f.service.warnings.has(doc.path)).toBe(true); });
});
describe('board saving sessions', () => {
    it('saves viewport changes without invalidating card content and refreshes it on reload', async () => {
        const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('Viewport'), session = new BoardSession(f.service, doc, () => {});
        const version = session.contentVersion;
        session.board.viewport = { x: 120, y: -80, zoom: .5 }; session.touchViewport(); await session.flush();
        expect(session.contentVersion).toBe(version); expect(parseBoard(f.files.get(doc.path)!.raw).viewport).toEqual(session.board.viewport);
        session.board.items.push({ id: 'new', kind: 'sticky', text: 'new', x: 0, y: 0, w: 100, h: 80, z: 1 }); session.touch();
        expect(session.contentVersion).toBeGreaterThan(version); await session.flush(); const changed = session.contentVersion; await session.reload();
        expect(session.contentVersion).toBeGreaterThan(changed); expect(session.board.items[0]?.text).toBe('new'); await session.close();
    });
    it('does not save measured layout until a user edit is made', async () => {
        const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('Measured'), session = new BoardSession(f.service, doc, () => {});
        f.vault.process.mockClear(); session.layoutChanged(); await session.flush();
        expect(session.dirty).toBe(false); expect(f.vault.process).not.toHaveBeenCalled(); await session.close();
    });
    const incoming = [{ id: 'card', kind: 'sticky' as const, text: 'Transferred', x: 50, y: 80, w: 200, h: 100, z: 1 }];
    it('saves transferred objects before accepting them and remaps IDs on repeat transfers', async () => {
        const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('Destination'), session = new BoardSession(f.service, doc, () => {});
        await session.receive(incoming, []); await session.receive(incoming, []);
        expect(session.board.items).toHaveLength(2); expect(new Set(session.board.items.map(item => item.id)).size).toBe(2);
        expect(parseBoard(f.files.get(doc.path)!.raw).items).toEqual(session.board.items);
        session.undo(); expect(session.board.items).toHaveLength(1); await session.close();
    });
    it('leaves the destination unchanged when a transfer fails to save', async () => {
        const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('Destination'), session = new BoardSession(f.service, doc, () => {});
        f.vault.process.mockRejectedValueOnce(new Error('disk full'));
        await expect(session.receive(incoming, [])).rejects.toThrow('disk full'); expect(session.board.items).toHaveLength(0); expect(session.history.canUndo).toBe(false);
        expect(f.files.get(doc.path)!.raw).toBe(doc.raw); await session.close();
    });
    it('rejects transfers into read-only or conflicting destinations and blocks history edits', async () => {
        const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('Destination'), session = new BoardSession(f.service, doc, () => {});
        session.checkpoint(); session.board.readOnly = true; session.undo(); expect(session.board.readOnly).toBe(true);
        await expect(session.receive(incoming, [])).rejects.toThrow('design_invalid');
        session.board.readOnly = false; session.conflict = true; await expect(session.receive(incoming, [])).rejects.toThrow('design_conflict'); session.discard();
    });
    it('preserves edits made while an incoming transfer is saving', async () => {
        const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('Destination'), session = new BoardSession(f.service, doc, () => {});
        let release!: () => void; const gate = new Promise<void>(resolve => release = resolve), original = f.service.saveBoard.bind(f.service);
        vi.spyOn(f.service, 'saveBoard').mockImplementationOnce(async (...args) => { await gate; return original(...args); });
        const received = session.receive(incoming, []); await Promise.resolve(); await Promise.resolve(); session.board.name = 'Edited while saving'; session.touch(); release(); await received; await session.flush();
        expect(parseBoard(f.files.get(doc.path)!.raw)).toMatchObject({ name: 'Edited while saving', items: [expect.objectContaining({ text: 'Transferred' })] }); await session.close();
    });
    it('discards a deleted session without saving or creating a recovery board', async () => {
        vi.useFakeTimers(); try { const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('A'), session = new BoardSession(f.service, doc, () => {}); session.board.name = 'Unsaved'; session.touch(); session.discard(); await f.service.deleteBoard(doc); await vi.advanceTimersByTimeAsync(1000); expect(f.service.boards()).toHaveLength(0); expect(session.dirty).toBe(false); } finally { vi.useRealTimers(); }
    });
    it('autosaves, detects external conflicts and offers explicit reload', async () => { vi.useFakeTimers(); try { const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('Local'); const session = new BoardSession(f.service, doc, () => {}); session.checkpoint(); session.board.name = 'Edited'; session.touch(); await vi.advanceTimersByTimeAsync(510); expect(parseBoard(f.files.get(doc.path)!.raw).name).toBe('Edited'); session.board.name = 'Unsaved'; session.touch(); f.files.get(doc.path)!.raw = serializeBoard({ ...session.board, name: 'External' }); await f.service.refreshFile(f.files.get(doc.path)!.file); expect(session.conflict).toBe(true); await session.flush(); expect(parseBoard(f.files.get(doc.path)!.raw).name).toBe('External'); await session.reload(); expect(session.board.name).toBe('External'); expect(session.dirty).toBe(false); await session.close(); } finally { vi.useRealTimers(); } });
    it('keeps local edits only after explicit conflict resolution', async () => { const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('A'); const session = new BoardSession(f.service, doc, () => {}); session.board.name = 'Local'; session.touch(); f.files.get(doc.path)!.raw = serializeBoard({ ...doc.board, name: 'External' }); await f.service.refreshFile(f.files.get(doc.path)!.file); expect(session.conflict).toBe(true); await session.keepLocal(); expect(parseBoard(f.files.get(doc.path)!.raw).name).toBe('Local'); await session.close(); });
    it('follows a renamed board file by stable board ID', async () => { const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('A'); const session = new BoardSession(f.service, doc, () => {}); await f.service.renameBoard(doc, 'Renamed'); expect(session.path).toContain('Renamed.board.json'); expect(session.board.name).toBe('Renamed'); expect(session.conflict).toBe(false); session.board.grid = false; session.touch(); await session.flush(); expect(parseBoard(f.files.get(session.path)!.raw).grid).toBe(false); await session.close(); });
    it('writes a recovery board when closing a conflicted view', async () => { const f = fixture(); await f.service.initialize(); const doc = await f.service.createBoard('A'); const session = new BoardSession(f.service, doc, () => {}); session.board.name = 'Local'; session.touch(); f.files.get(doc.path)!.raw = serializeBoard({ ...doc.board, name: 'External' }); await f.service.refreshFile(f.files.get(doc.path)!.file); await session.close(); const boards = [...f.files.values()].filter(entry => entry.file.path.endsWith('.board.json')).map(entry => parseBoard(entry.raw)); expect(boards).toHaveLength(2); expect(boards.find(board => board.id === doc.board.id)?.name).toBe('External'); expect(boards.find(board => board.id !== doc.board.id)?.name).toContain('Local'); });
});
