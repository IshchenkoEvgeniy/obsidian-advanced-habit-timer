import { clone, DesignError, uid, type DesignEntity, type DesignField, type DesignSettings, type DesignType } from './types';
import { validateSchema } from './schema';

export type WorldViewKind = 'table' | 'kanban';
export type WorldFilterOp = 'contains' | 'eq' | 'neq' | 'empty' | 'filled' | 'gt' | 'lt';
export interface WorldFilter { field: string; op: WorldFilterOp; value: string; }
export interface WorldSort { field: string; direction: 'asc' | 'desc'; }
export interface WorldView {
    id: string; name: string; kind: WorldViewKind; columns: string[]; filters: WorldFilter[];
    sorts: WorldSort[]; groupBy: string; cardFields: string[]; coverField: string; order: string[]; widths?: Record<string, number>;
}
export interface WorldDataset { id: string; favorite: boolean; views: WorldView[]; }
/** Types and view settings travel with the vault. Records remain ordinary Markdown notes. */
export interface WorldRegistry { format: 1; types: DesignType[]; datasets: WorldDataset[]; }
export const WORLD_CONFIG = 'world-tables.json';
export function newWorldView(type: DesignType, kind: WorldViewKind, name: string, id = uid()): WorldView {
    return { id, name, kind, columns: ['title', ...type.fields.map(field => field.id)], filters: [], sorts: [],
        groupBy: kind === 'kanban' ? (type.fields.find(field => field.id === 'design_state' && field.kind === 'select') || type.fields.find(field => field.kind === 'select'))?.id || '' : '',
        cardFields: type.fields.filter(field => field.card).map(field => field.id),
        coverField: type.fields.find(field => field.kind === 'image')?.id || '', order: [], widths: {} };
}
export function reconcileWorld(registry: WorldRegistry, types: DesignType[], names = ['Таблица', 'Канбан']): WorldRegistry {
    const result = clone(registry); result.types = clone(types);
    result.datasets = result.datasets.filter(dataset => types.some(type => type.id === dataset.id));
    for (const type of types) if (!result.datasets.some(dataset => dataset.id === type.id)) result.datasets.push({ id: type.id, favorite: false,
        views: (['table', 'kanban'] as const).map((kind, i) => newWorldView(type, kind, names[i]!, `${type.id}-${kind}`)) });
    return result;
}
export function bootstrapWorld(settings: DesignSettings, ru: boolean): WorldRegistry {
    const types = clone(settings.types);
    for (const type of types) if (!type.fields.some(field => field.id === 'design_state')) type.fields.push({ id: 'design_state', name: ru ? 'Подготовка записи' : 'Design readiness', kind: 'select', card: true,
        options: [{ value: ru ? 'Идея' : 'Idea', color: '#94a3b8' }, { value: ru ? 'В работе' : 'In progress', color: '#eab308' }, { value: ru ? 'Готово' : 'Ready', color: '#22c55e' }] });
    if (!types.some(type => type.id === 'weapon')) {
        let folder = ru ? 'Оружие' : 'Weapons'; while (types.some(type => type.folder === folder)) folder += '-new';
        types.push({ id: 'weapon', name: ru ? 'Оружие' : 'Weapons', icon: 'swords', color: '#f97316', folder, fields: [
            { id: 'damage', name: ru ? 'Урон' : 'Damage', kind: 'number', min: 0, card: true },
            { id: 'rarity', name: ru ? 'Редкость' : 'Rarity', kind: 'select', card: true, options: [{ value: ru ? 'Обычное' : 'Common', color: '#94a3b8' }, { value: ru ? 'Редкое' : 'Rare', color: '#3b82f6' }, { value: ru ? 'Легендарное' : 'Legendary', color: '#a855f7' }] },
            { id: 'weight', name: ru ? 'Вес' : 'Weight', kind: 'number', min: 0 },
            { id: 'portrait', name: ru ? 'Изображение' : 'Image', kind: 'image' },
            { id: 'owner', name: ru ? 'Владелец' : 'Owner', kind: 'entity', targetType: 'character', card: true },
            { id: 'task', name: ru ? 'Задача разработки' : 'Development task', kind: 'task' },
            { id: 'status', name: ru ? 'Статус реализации' : 'Implementation status', kind: 'status' },
            { id: 'design_state', name: ru ? 'Подготовка записи' : 'Design readiness', kind: 'select', card: true, options: [{ value: ru ? 'Идея' : 'Idea', color: '#94a3b8' }, { value: ru ? 'В работе' : 'In progress', color: '#eab308' }, { value: ru ? 'Готово' : 'Ready', color: '#22c55e' }] }
        ] });
    }
    return reconcileWorld({ format: 1, types: [], datasets: [] }, types, ru ? undefined : ['Table', 'Kanban']);
}
export function parseWorld(raw: string, settings: DesignSettings): WorldRegistry {
    let registry: WorldRegistry;
    try { registry = JSON.parse(raw); } catch { throw new DesignError('design_invalid', WORLD_CONFIG); }
    if (!registry || registry.format !== 1) throw new DesignError('design_future', WORLD_CONFIG);
    validateSchema({ ...settings, types: registry.types });
    if (!Array.isArray(registry.datasets)) throw new DesignError('design_invalid', WORLD_CONFIG);
    const datasets = new Set<string>(), views = new Set<string>();
    for (const dataset of registry.datasets) {
        if (!dataset || typeof dataset.id !== 'string' || datasets.has(dataset.id) || !registry.types.some(type => type.id === dataset.id) || typeof dataset.favorite !== 'boolean' || !Array.isArray(dataset.views) || !dataset.views.length) throw new DesignError('design_invalid', WORLD_CONFIG);
        datasets.add(dataset.id);
        for (const view of dataset.views) {
            if (!view || typeof view.id !== 'string' || !view.id || views.has(view.id) || typeof view.name !== 'string' || !view.name.trim() || !['table', 'kanban', 'gallery'].includes(view.kind) ||
                ![view.columns, view.cardFields, view.order].every(value => Array.isArray(value) && value.every(id => typeof id === 'string') && new Set(value).size === value.length) ||
                typeof view.groupBy !== 'string' || typeof view.coverField !== 'string' || !Array.isArray(view.filters) || !Array.isArray(view.sorts) ||
                view.filters.some(filter => !filter || typeof filter.field !== 'string' || !['contains', 'eq', 'neq', 'empty', 'filled', 'gt', 'lt'].includes(filter.op) || typeof filter.value !== 'string') ||
                view.sorts.some(sort => !sort || typeof sort.field !== 'string' || !['asc', 'desc'].includes(sort.direction))) throw new DesignError('design_invalid', WORLD_CONFIG);
            views.add(view.id);
            if (view.widths !== undefined && (!view.widths || typeof view.widths !== 'object' || Array.isArray(view.widths) || Object.values(view.widths).some(width => typeof width !== 'number' || !Number.isFinite(width) || width < 80 || width > 600))) throw new DesignError('design_invalid', WORLD_CONFIG);
            // Keep saved IDs and widget references usable when removing the old gallery layout.
            if ((view.kind as string) === 'gallery') {
                view.kind = 'table';
                if (view.name === 'Галерея') view.name = 'Таблица записей';
                if (view.name === 'Gallery') view.name = 'Records table';
            }
        }
    }
    if (registry.types.some(type => !datasets.has(type.id))) throw new DesignError('design_invalid', WORLD_CONFIG);
    return registry;
}
export function worldFields(type: DesignType): DesignField[] { return [{ id: 'title', name: 'Название', kind: 'text' }, ...type.fields]; }
/** Only unambiguous equality filters can seed a new record. Range/search filters are never guessed. */
export function worldCreationDefaults(type: DesignType, view: WorldView): { values: Record<string, unknown>; title: string } {
    const values: Record<string, unknown> = {}; let title = '';
    for (const filter of view.filters.filter(filter => filter.op === 'eq')) {
        if (view.filters.some(other => other.field === filter.field && other.op === 'eq' && other.value !== filter.value)) continue;
        if (filter.field === 'title') { title = filter.value; continue; }
        const field = type.fields.find(field => field.id === filter.field); if (!field || field.kind === 'status') continue;
        if (field.kind === 'number') { const number = Number(filter.value); if (filter.value && Number.isFinite(number)) values[field.id] = number; }
        else if (field.kind === 'checkbox') { if (['true', 'false'].includes(filter.value)) values[field.id] = filter.value === 'true'; }
        else if (field.kind === 'select' || field.kind === 'multiselect') { if (field.options?.some(option => option.value === filter.value)) values[field.id] = field.kind === 'multiselect' ? [filter.value] : filter.value; }
        else values[field.id] = filter.value;
    }
    return { values, title };
}
export function queryWorld(records: DesignEntity[], type: DesignType, view: WorldView, search = '', display?: (record: DesignEntity, field: string) => string): DesignEntity[] {
    const fields = new Map(worldFields(type).map(field => [field.id, field]));
    const rawValue = (record: DesignEntity, field: string) => field === 'title' ? record.title : fields.get(field)?.kind === 'status' && display ? display(record, field) : record.values[field];
    const value = (record: DesignEntity, field: string) => field === 'title' ? record.title : display ? display(record, field) : String(rawValue(record, field) ?? '');
    const lower = (input: unknown) => String(input ?? '').toLocaleLowerCase();
    const filtered = records.filter(record => record.type === type.id && (!search || lower(`${record.title} ${record.body} ${type.fields.map(field => value(record, field.id)).join(' ')}`).includes(lower(search))) && view.filters.every(filter => {
        if (!fields.has(filter.field)) return true; // Removed fields never hide all existing notes.
        const raw = rawValue(record, filter.field), text = lower(value(record, filter.field)), wanted = lower(filter.value), empty = raw == null || raw === '' || (Array.isArray(raw) && !raw.length);
        switch (filter.op) {
            case 'empty': return empty;
            case 'filled': return !empty;
            case 'contains': return text.includes(wanted);
            case 'eq': return Array.isArray(raw) ? raw.some(item => lower(item) === wanted) : lower(raw) === wanted || text === wanted;
            case 'neq': return Array.isArray(raw) ? raw.every(item => lower(item) !== wanted) : lower(raw) !== wanted && text !== wanted;
            case 'gt': case 'lt': { const a = fields.get(filter.field)?.kind === 'date' ? Date.parse(String(raw)) : Number(raw), b = fields.get(filter.field)?.kind === 'date' ? Date.parse(filter.value) : Number(filter.value); return !empty && Number.isFinite(a) && Number.isFinite(b) && (filter.op === 'gt' ? a > b : a < b); }
        }
    }));
    const positions = new Map(view.order.map((id, index) => [id, index]));
    return filtered.sort((a, b) => {
        if (view.kind === 'table' && view.groupBy && fields.has(view.groupBy)) { const group = value(a, view.groupBy).localeCompare(value(b, view.groupBy), undefined, { numeric: true }); if (group) return group; }
        for (const sort of view.sorts) {
            const field = fields.get(sort.field); if (!field) continue;
            const av = rawValue(a, sort.field), bv = rawValue(b, sort.field);
            const comparison = field.kind === 'number' && av != null && bv != null ? Number(av) - Number(bv) : value(a, sort.field).localeCompare(value(b, sort.field), undefined, { numeric: true });
            if (Number.isFinite(comparison) && comparison) return sort.direction === 'asc' ? comparison : -comparison;
        }
        return (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity) || a.title.localeCompare(b.title, undefined, { numeric: true }) || a.id.localeCompare(b.id);
    });
}
export interface WorldColumn { value: string; label: string; color: string; records: DesignEntity[]; }
export function kanbanColumns(records: DesignEntity[], field?: DesignField, label: (option: NonNullable<DesignField['options']>[number]) => string = option => option.value, unspecified = 'Не указано'): WorldColumn[] {
    if (!field || field.kind !== 'select') return [{ value: '', label: unspecified, color: '#94a3b8', records }];
    const columns = (field.options || []).map(option => ({ value: option.value, label: label(option), color: option.color, records: [] as DesignEntity[] }));
    const fallback: WorldColumn = { value: '', label: unspecified, color: '#94a3b8', records: [] };
    for (const record of records) (columns.find(column => column.value === record.values[field.id]) || fallback).records.push(record);
    return [...columns, fallback];
}
/** Explicit source capabilities: world views never expose project-task/GitHub mutations. */
export const WORLD_CAPABILITIES = Object.freeze({ source: 'world' as const, githubSync: false, hierarchy: false, recordEditing: true });

export function fieldIcon(kind: DesignField['kind']): string {
    return ({ text: 'type', longtext: 'align-left', number: 'hash', select: 'circle-dot', multiselect: 'tags', checkbox: 'check-square', date: 'calendar', image: 'image', entity: 'link', task: 'list-checks', status: 'activity' })[kind];
}
/** Aggregates use the filtered dataset, never only the currently mounted page of rows. */
export function worldNumberSummary(records: DesignEntity[], field: string): { count: number; sum: number; average: number | undefined } {
    const values = records.map(record => record.values[field]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const sum = values.reduce((total, value) => total + value, 0);
    return { count: values.length, sum, average: values.length ? sum / values.length : undefined };
}
