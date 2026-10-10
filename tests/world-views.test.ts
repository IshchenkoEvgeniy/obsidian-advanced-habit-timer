import { describe, expect, it } from 'vitest';
import { defaultDesignSettings } from '../src/design/schema';
import { bootstrapWorld, parseWorld, queryWorld, kanbanColumns, newWorldView, reconcileWorld, worldCreationDefaults, worldNumberSummary, WORLD_CAPABILITIES } from '../src/design/world-views';
import { newBoard, parseBoard, serializeBoard } from '../src/design/board';
import { clone, type DesignEntity } from '../src/design/types';

const settings = defaultDesignSettings('ru'), registry = bootstrapWorld(settings, true);
const weapon = registry.types.find(type => type.id === 'weapon')!;
const record = (id: string, values: Record<string, unknown> = {}, title = id): DesignEntity => ({ id, values, title, type: weapon.id, body: '', raw: '', path: id + '.md' });
describe('world dataset views', () => {
    it('converts legacy galleries without losing saved IDs, filters, columns or board references', () => {
        const legacy = clone(registry), view = legacy.datasets[0]!.views[0]!;
        (view as { kind: string }).kind = 'gallery'; view.name = 'Галерея'; view.filters = [{ field: 'title', op: 'contains', value: 'Hero' }];
        const migrated = parseWorld(JSON.stringify(legacy), settings).datasets[0]!.views[0]!;
        expect(migrated).toEqual({ ...view, kind: 'table', name: 'Таблица записей' });
        expect(parseWorld(JSON.stringify({ ...legacy, datasets: legacy.datasets.map(dataset => ({ ...dataset, views: dataset.views.map(view => ({ ...view, kind: view.kind === 'table' ? 'gallery' : view.kind, name: 'Custom view' })) })) }), settings).datasets[0]!.views[0]!.name).toBe('Custom view');
    });
    it('summarizes filtered numeric records including zero, excluding empty and legacy text values', () => {
        expect(worldNumberSummary([record('a', { damage: 0 }), record('b', { damage: 20 }), record('c'), record('d', { damage: 'bad' })], 'damage')).toEqual({ count: 2, sum: 20, average: 10 });
        expect(worldNumberSummary([], 'damage')).toEqual({ count: 0, sum: 0, average: undefined });
    });
    it('migrates additively and separates readiness from linked implementation status', () => {
        expect(registry.types.length).toBe(settings.types.length + 1);
        expect(settings.types.some(type => type.id === 'weapon')).toBe(false);
        expect(registry.types[0]!.fields.filter(field => field.kind === 'status')).toEqual(settings.types[0]!.fields.filter(field => field.kind === 'status'));
        expect(registry.types[0]!.fields.find(field => field.id === 'design_state')?.kind).toBe('select');
        expect(registry.datasets[0]!.views.map(view => view.kind)).toEqual(['table', 'kanban']);
        expect(WORLD_CAPABILITIES.githubSync).toBe(false);
    });
    it('round trips shared schema and views and rejects future/duplicate/invalid definitions', () => {
        expect(parseWorld(JSON.stringify(registry), settings)).toEqual(registry);
        expect(() => parseWorld('{"format":2}', settings)).toThrow('design_future');
        const duplicate = clone(registry); duplicate.datasets[1]!.views[0]!.id = duplicate.datasets[0]!.views[0]!.id;
        expect(() => parseWorld(JSON.stringify(duplicate), settings)).toThrow('design_invalid');
        const invalid = clone(registry); invalid.datasets[0]!.views[0]!.filters = [{ field: 'title', op: 'injected' as any, value: '' }];
        expect(() => parseWorld(JSON.stringify(invalid), settings)).toThrow('design_invalid');
    });
    it('filters numbers, arrays, dates and related display values without including another type', () => {
        const type = { ...weapon, fields: [...weapon.fields, { id: 'date', name: 'date', kind: 'date' as const }, { id: 'tags', name: 'tags', kind: 'multiselect' as const }] };
        const view = newWorldView(type, 'table', 'Rare damage');
        view.filters = [{ field: 'damage', op: 'gt', value: '10' }, { field: 'rarity', op: 'eq', value: 'Редкое' }];
        const records = [record('a', { damage: 20, rarity: 'Редкое', date: '2026-10-10', tags: ['ore', 'metal'] }), record('b', { damage: 5, rarity: 'Редкое' }), record('c', { damage: 30, rarity: 'Обычное' }), { ...record('other', { damage: 100, rarity: 'Редкое' }), type: 'character' }];
        expect(queryWorld(records, type, view).map(record => record.id)).toEqual(['a']);
        view.filters = [{ field: 'tags', op: 'eq', value: 'metal' }, { field: 'date', op: 'gt', value: '2026-10-09' }];
        expect(queryWorld(records, type, view).map(record => record.id)).toEqual(['a']);
        view.filters = []; expect(queryWorld(records, type, view, 'Торговля', (_record, field) => field === 'task' ? 'Торговля' : '').length).toBe(3);
    });
    it('does not treat empty numbers as zero and keeps records when a filtered field is deleted', () => {
        const view = newWorldView(weapon, 'table', 'Numbers'); view.filters = [{ field: 'damage', op: 'lt', value: '10' }];
        expect(queryWorld([record('a'), record('b', { damage: 0 })], weapon, view).map(record => record.id)).toEqual(['b']);
        view.filters = [{ field: 'removed', op: 'eq', value: 'anything' }];
        expect(queryWorld([record('a')], weapon, view).length).toBe(1);
    });
    it('keeps empty and unknown kanban values visible, and never uses a derived task status as writable grouping', () => {
        const records = [record('a', { rarity: 'Редкое' }), record('b'), record('c', { rarity: 'Legacy option' })];
        const columns = kanbanColumns(records, weapon.fields.find(field => field.id === 'rarity'));
        expect(columns.find(column => column.value === 'Редкое')?.records.map(record => record.id)).toEqual(['a']);
        expect(columns.at(-1)?.records.map(record => record.id)).toEqual(['b', 'c']);
        expect(columns.flatMap(column => column.records).length).toBe(records.length);
        expect(kanbanColumns(records, weapon.fields.find(field => field.kind === 'status')).length).toBe(1);
    });
    it('sorts numeric values naturally, groups table rows and preserves per-view manual order', () => {
        const view = newWorldView(weapon, 'table', 'Sorted'); const records = [record('a', { damage: 10, rarity: 'Редкое' }), record('b', { damage: 2, rarity: 'Редкое' }), record('c', { damage: 40, rarity: 'Обычное' })];
        view.order = ['b', 'c', 'a']; expect(queryWorld(records, weapon, view).map(record => record.id)).toEqual(['b', 'c', 'a']);
        view.sorts = [{ field: 'damage', direction: 'desc' }]; expect(queryWorld(records, weapon, view).map(record => record.id)).toEqual(['c', 'a', 'b']);
        view.groupBy = 'rarity'; expect(queryWorld(records, weapon, view).map(record => record.id)).toEqual(['c', 'a', 'b']);
    });
    it('preserves view identities when a schema changes and removes only views of removed types', () => {
        const previous = clone(registry); previous.datasets[0]!.favorite = true; previous.datasets[0]!.views[0]!.filters.push({ field: 'title', op: 'contains', value: 'Лиза' });
        const next = reconcileWorld(previous, registry.types.slice(0, 2));
        expect(next.datasets.length).toBe(2); expect(next.datasets[0]).toEqual(previous.datasets[0]);
    });
    it('prefills only unambiguous equality filters when creating a record', () => {
        const view = newWorldView(weapon, 'table', 'Rare'); view.filters = [{ field: 'rarity', op: 'eq', value: 'Редкое' }, { field: 'damage', op: 'gt', value: '10' }, { field: 'title', op: 'eq', value: 'Sword' }];
        expect(worldCreationDefaults(weapon, view)).toEqual({ title: 'Sword', values: { rarity: 'Редкое' } });
        view.filters.push({ field: 'rarity', op: 'eq', value: 'Обычное' }); expect(worldCreationDefaults(weapon, view).values).toEqual({});
    });
    it('validates persisted column widths', () => {
        const bad = clone(registry); bad.datasets[0]!.views[0]!.widths = { title: -5 };
        expect(() => parseWorld(JSON.stringify(bad), settings)).toThrow('design_invalid');
    });
    it('board serialization and copying retain a reference rather than duplicating records', () => {
        const board = newBoard('World'); board.items.push({ id: 'view', kind: 'world-view', worldView: { typeId: 'weapon', viewId: 'weapon-table' }, x: 0, y: 0, w: 300, h: 200, z: 1 });
        expect(parseBoard(serializeBoard(board)).items[0]!.worldView).toEqual(board.items[0]!.worldView);
        delete board.items[0]!.worldView; expect(() => serializeBoard(board)).toThrow('design_invalid');
    });
});
