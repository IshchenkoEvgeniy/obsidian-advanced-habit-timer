import { describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import type HabitTimerPlugin from '../src/main';
import { defaultDesignSettings } from '../src/design/schema';
import { DesignService } from '../src/design/service';
import { newWorldView, WORLD_CONFIG } from '../src/design/world-views';
import { clone } from '../src/design/types';
import { splitNote } from '../src/design/markdown';
import { ProjectParser } from '../src/projects/engine/parser';
import type { ProjectCache } from '../src/projects/engine/cache';

function fixture() {
    const files = new Map<string, { file: TFile; raw: string }>(), folders = new Set<string>();
    const vault = {
        on: vi.fn(), getFiles: () => [...files.values()].map(entry => entry.file), getMarkdownFiles: () => [...files.values()].map(entry => entry.file).filter(file => file.extension === 'md'),
        getAbstractFileByPath: (path: string) => files.get(path)?.file || (folders.has(path) ? { path } : undefined),
        read: vi.fn(async (file: TFile) => files.get(file.path)!.raw), cachedRead: vi.fn(async (file: TFile) => files.get(file.path)!.raw),
        createFolder: vi.fn(async (path: string) => { folders.add(path); }),
        create: vi.fn(async (path: string, raw: string) => { if (files.has(path)) throw new Error('exists'); const file = new TFile(path); files.set(path, { file, raw }); return file; }),
        process: vi.fn(async (file: TFile, change: (raw: string) => string) => { const entry = files.get(file.path)!; entry.raw = change(entry.raw); return entry.raw; }),
        rename: vi.fn(async (file: TFile, path: string) => { const previous = file.path, entry = files.get(previous)!; files.delete(previous); file.path = path; file.basename = path.split('/').pop()!.replace(/\.md$/, ''); files.set(path, entry); }),
        getResourcePath: (file: TFile) => file.path,
    };
    const plugin = { settings: { language: 'ru', design: defaultDesignSettings('ru'), projectScopes: [{ id: 'game', name: 'Factory Farm Dungeon Mining', sourceType: 'file', sourceValue: 'Checklist.md', statuses: 'Todo, Doing, Done' }] },
        registerEvent: vi.fn(), saveSettings: vi.fn(async () => {}),
        projectEngine: { loadTasks: vi.fn(async () => [{ id: 'task1', name: 'Implement', section: 'Stage', status: 'Doing' }]) },
        app: { vault, metadataCache: { on: vi.fn(), getFileCache: (file: TFile) => ({ frontmatter: splitNote(files.get(file.path)?.raw || '').frontmatter }) },
            fileManager: { renameFile: vault.rename, trashFile: vi.fn(async (file: TFile) => { files.delete(file.path); }) } }
    } as unknown as HabitTimerPlugin;
    const service = new DesignService(plugin), path = `${plugin.settings.design.root}/${WORLD_CONFIG}`;
    return { files, vault, plugin, service, path };
}
describe('world vault persistence', () => {
    it('persists legacy gallery conversion while preserving record files and view IDs', async () => {
        const f = fixture(); await f.service.initializeWorld();
        const entity = await f.service.createEntity('weapon', 'Sword', { damage: 3 }), note = f.files.get(entity.path)!.raw;
        const legacy = clone(f.service.world!); (legacy.datasets[0]!.views[0]! as { kind: string }).kind = 'gallery';
        const id = legacy.datasets[0]!.views[0]!.id; f.files.get(f.path)!.raw = JSON.stringify(legacy);
        const restarted = new DesignService(f.plugin); await restarted.initializeWorld();
        expect(restarted.world!.datasets[0]!.views[0]!.id).toBe(id);
        expect(JSON.parse(f.files.get(f.path)!.raw).datasets[0].views[0].kind).toBe('table');
        expect(f.files.get(entity.path)!.raw).toBe(note);
    });
    it('creates the registry once, keeps schema canonical in the vault and restores views after restart', async () => {
        const f = fixture(); await Promise.all([f.service.initializeWorld(), f.service.initializeWorld()]);
        expect(f.vault.create.mock.calls.filter(call => call[0] === f.path).length).toBe(1);
        const type = f.service.settings.types[0]!, view = newWorldView(type, 'table', 'Only traders'); view.filters = [{ field: 'role', op: 'eq', value: 'Trader' }];
        await f.service.saveWorldView(type.id, view);
        f.plugin.settings.design.types = [];
        const second = new DesignService(f.plugin); await second.initializeWorld();
        expect(second.settings.types.length).toBe(10);
        expect(second.world!.datasets[0]!.views.find(candidate => candidate.id === view.id)).toEqual(view);
    });
    it('serializes independent local view changes and preserves the other dataset', async () => {
        const f = fixture(); await f.service.initializeWorld();
        await Promise.all([f.service.updateWorld(registry => { registry.datasets[0]!.favorite = true; }), f.service.updateWorld(registry => { registry.datasets[1]!.favorite = true; })]);
        expect(f.service.world!.datasets.slice(0, 2).map(dataset => dataset.favorite)).toEqual([true, true]);
    });
    it('rejects external file conflicts, reloads the synced version, and permits a later retry', async () => {
        const f = fixture(); await f.service.initializeWorld();
        const external = clone(f.service.world!); external.datasets[1]!.favorite = true; f.files.get(f.path)!.raw = JSON.stringify(external);
        await expect(f.service.updateWorld(registry => { registry.datasets[0]!.favorite = true; })).rejects.toThrow('design_conflict');
        expect(f.service.world!.datasets[1]!.favorite).toBe(true);
        expect(f.service.world!.datasets[0]!.favorite).toBe(false);
        await f.service.updateWorld(registry => { registry.datasets[0]!.favorite = true; });
        expect(f.service.world!.datasets.slice(0, 2).every(dataset => dataset.favorite)).toBe(true);
    });
    it('does not overwrite a corrupt/future registry with default tables', async () => {
        const f = fixture(); await f.vault.createFolder(f.service.settings.root); await f.vault.create(f.path, '{"format":20}');
        await expect(f.service.initializeWorld()).rejects.toThrow('design_future');
        expect(f.files.get(f.path)!.raw).toBe('{"format":20}'); expect(f.vault.process).not.toHaveBeenCalled();
    });
    it('detects stale view drafts even when an external event has already refreshed the registry', async () => {
        const f = fixture(); await f.service.initializeWorld();
        const view = clone(f.service.world!.datasets[0]!.views[0]!), baseline = JSON.stringify(view);
        await f.service.saveWorldView('character', { ...view, name: 'Another window' });
        await expect(f.service.saveWorldView('character', { ...view, name: 'Stale' }, baseline)).rejects.toThrow('design_conflict');
        expect(f.service.world!.datasets[0]!.views[0]!.name).toBe('Another window');
    });
    it('updates one source record, preserves its UUID, body and unknown frontmatter, and derives task status separately', async () => {
        const f = fixture(); await f.service.initializeWorld();
        let entity = await f.service.createEntity('character', 'Trader', { task: 'task1', unknown: 'keep', role: 'Original' }, 'Unmanaged Markdown');
        entity = await f.service.updateWorldValue(entity.id, 'design_state', 'Готово', entity.raw);
        expect(entity.values.status).toBe('Doing'); expect(entity.values.design_state).toBe('Готово');
        const first = entity; entity = await f.service.updateWorldValue(entity.id, 'personality', 'Patient', entity.raw);
        expect(entity.id).toBe(first.id); expect(entity.body).toContain('Unmanaged Markdown'); expect(entity.body).toContain('Patient'); expect(entity.values.unknown).toBe('keep');
        await expect(f.service.updateWorldValue(entity.id, 'role', 'Stale', first.raw)).rejects.toThrow('design_conflict');
        await expect(f.service.updateWorldValue(entity.id, 'status', 'Done', entity.raw)).rejects.toThrow('design_invalid');
    });
    it('moves items to Weapons only explicitly and keeps existing board references and extra fields', async () => {
        const f = fixture(); await f.service.initializeWorld();
        const entity = await f.service.createEntity('item', 'Sword', { value: 7, custom: 'original' }, 'Body'), board = await f.service.createBoard('Map');
        board.board.items.push({ id: 'card', kind: 'entity', ref: entity.id, x: 0, y: 0, w: 100, h: 100, z: 1 }); await f.service.saveBoard(board.board, board.path, board.raw);
        const updated = await f.service.moveWorldRecord(entity.id, 'weapon');
        expect(updated.type).toBe('weapon'); expect(updated.id).toBe(entity.id); expect(updated.values).toMatchObject({ value: 7, custom: 'original' }); expect(updated.body).toContain('Body');
        expect(f.files.has(entity.path)).toBe(false); expect(updated.path).toContain('/Оружие/'); expect(f.service.resolveBoard(board.board.id)!.board.items[0]!.ref).toBe(updated.id);
    });
    it('deleting a view or a board block leaves the underlying records intact', async () => {
        const f = fixture(); await f.service.initializeWorld(); const entity = await f.service.createEntity('weapon', 'Sword', {});
        await f.service.updateWorld(registry => { registry.datasets.find(dataset => dataset.id === 'weapon')!.views.pop(); });
        expect(f.service.index.resolve(entity.id)).toBeDefined(); expect(f.files.has(entity.path)).toBe(true);
    });
    it('keeps unchanged legacy options editable and clears the snapshot when a task is unlinked', async () => {
        const f = fixture(); await f.service.initializeWorld(); let entity = await f.service.createEntity('weapon', 'Sword', { rarity: 'Редкое', task: 'task1' });
        const schema = clone(f.service.settings); schema.types.find(type => type.id === 'weapon')!.fields.find(field => field.id === 'rarity')!.options = [];
        await f.service.saveSchema(schema);
        entity = f.service.index.resolve(entity.id)!; entity = await f.service.updateWorldValue(entity.id, 'damage', 30, entity.raw);
        expect(entity.values.rarity).toBe('Редкое'); expect(entity.values.damage).toBe(30);
        entity = await f.service.updateWorldValue(entity.id, 'task', '', entity.raw); expect(entity.values.status).toBeUndefined();
    });
    it('creates a task in the plan stage, links its ID to the world note, and prevents duplicates', async () => {
        const f = fixture(); await f.service.initializeWorld(); const entity = await f.service.createEntity('weapon', 'Sword', {});
        const file = await f.vault.create('Checklist.md', '# Stage\n- [ ] Implement sword');
        const task = { id: 'created', name: 'Implement sword', section: 'Stage', status: 'Todo', file };
        f.plugin.projectEngine.createTask = vi.fn(async () => task) as any;
        vi.mocked(f.plugin.projectEngine.loadTasks).mockResolvedValue([task as any]);
        const result = await f.service.createLinkedTask(entity.id, 'Implement sword', 'Stage');
        expect(f.plugin.projectEngine.createTask).toHaveBeenCalledWith(f.service.project(), { name: 'Implement sword', description: `[[${entity.path.replace(/\.md$/, '')}|Sword]]` }, { kind: 'stage', section: 'Stage' });
        expect(result.values.task).toBe('created'); expect(result.values.status).toBe('Todo');
        await expect(f.service.createLinkedTask(entity.id, 'Duplicate')).rejects.toThrow('design_conflict');
        expect(f.plugin.projectEngine.createTask).toHaveBeenCalledTimes(1);
    });
    it('rejects stale schema drafts and root conflicts before changing either records or schema', async () => {
        const f = fixture(); await f.service.initializeWorld(); const schema = clone(f.service.settings), baseline = JSON.stringify(schema.types);
        await f.service.updateWorld(registry => { registry.types[0]!.name = 'Changed elsewhere'; });
        await expect(f.service.saveSchema(schema, baseline)).rejects.toThrow('design_conflict');
        expect(f.service.settings.types[0]!.name).toBe('Changed elsewhere');
        const next = clone(f.service.settings); next.root = 'Other'; await f.vault.createFolder('Other'); await f.vault.create('Other/' + WORLD_CONFIG, 'existing');
        await expect(f.service.saveSchema(next)).rejects.toThrow('design_conflict'); expect(f.service.settings.root).toBe(schema.root);
    });
    it('excludes world notes from folder and file development sources even with checkboxes in the body', async () => {
        const f = fixture(); await f.service.initializeWorld(); const entity = await f.service.createEntity('character', 'Trader', { task: 'task1' }, '- [ ] Buy ore');
        const plan = await f.vault.create(f.service.settings.root + '/Development.md', '---\nstatus: Todo\n---\n# Plan');
        const cache = { get: vi.fn(), set: vi.fn() } as unknown as ProjectCache;
        const parser = new ProjectParser(f.plugin.app as App, cache);
        const scope = { id: 'folder', name: 'Plan', sourceType: 'folder' as const, sourceValue: f.service.settings.root, statuses: 'Todo, Done' };
        expect((await parser.loadTasks(scope)).map(task => task.file.path)).toEqual([plan.path]);
        expect(await parser.loadTasks({ ...scope, sourceType: 'file', sourceValue: entity.path })).toEqual([]);
    });
});
