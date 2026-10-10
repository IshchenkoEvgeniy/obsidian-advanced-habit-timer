import { t, type Language } from '../i18n';
import { DesignError, FIELD_KINDS, clone, type DesignField, type DesignSettings, type DesignType } from './types';

export function vaultPath(value: string): string {
    const path = value.trim().replace(/\\/g, '/').replace(/\/+$/g, '');
    if (!path || path.startsWith('/') || /[:\x00-\x1f]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new DesignError('design_invalid', value);
    return path;
}
export function fileName(value: string): string {
    const name = value.trim().replace(/[\\/:*?"<>|\x00-\x1f\[\]#^]/g, '-').replace(/[. ]+$/g, '').slice(0, 120);
    if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) throw new DesignError('design_invalid', value);
    return name;
}
const reserved = new Set(['design_id', 'design_type', '__proto__', 'constructor', 'prototype']);
export function validateSchema(value: unknown): DesignSettings {
    if (!value || typeof value !== 'object') throw new DesignError('design_invalid');
    const schema = value as DesignSettings;
    if (typeof schema.root !== 'string' || typeof schema.projectId !== 'string' || !Array.isArray(schema.types)) throw new DesignError('design_invalid');
    vaultPath(schema.root);
    const ids = new Set<string>();
    for (const type of schema.types) {
        if (!type || typeof type.id !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(type.id) || ids.has(type.id) || typeof type.name !== 'string' || !type.name.trim() ||
            !/^#[0-9a-f]{6}$/i.test(type.color) || typeof type.icon !== 'string' || !Array.isArray(type.fields)) throw new DesignError('design_invalid');
        ids.add(type.id); vaultPath(type.folder);
        const fields = new Set<string>();
        const headings = new Set<string>();
        for (const field of type.fields) {
            if (!field || typeof field.id !== 'string' || !field.id.trim() || /[\r\n<>]/.test(field.id) || reserved.has(field.id) || fields.has(field.id) ||
                typeof field.name !== 'string' || !field.name.trim() || /[\r\n]/.test(field.name) || !FIELD_KINDS.includes(field.kind) ||
                (field.required !== undefined && typeof field.required !== 'boolean') || (field.card !== undefined && typeof field.card !== 'boolean')) throw new DesignError('design_invalid');
            fields.add(field.id);
            if (field.kind === 'longtext') {
                if (headings.has(field.name) || field.name === 'Связи') throw new DesignError('design_invalid');
                headings.add(field.name);
            }
            if ([field.min, field.max, field.step].some(n => n !== undefined && (typeof n !== 'number' || !Number.isFinite(n))) ||
                (field.step !== undefined && field.step <= 0) || (field.min !== undefined && field.max !== undefined && field.min > field.max)) throw new DesignError('design_invalid');
            if (field.options !== undefined && (!Array.isArray(field.options) || field.options.some(o => !o || typeof o.value !== 'string' || !o.value.trim() || !/^#[0-9a-f]{6}$/i.test(o.color) || (o.labelKey !== undefined && !['design_low', 'design_medium', 'design_high'].includes(o.labelKey))) ||
                new Set(field.options.map(o => o.value)).size !== field.options.length)) throw new DesignError('design_invalid');
            if (field.targetType !== undefined && typeof field.targetType !== 'string') throw new DesignError('design_invalid');
        }
    }
    return clone(schema);
}
export function validateValues(type: DesignType | undefined, values: Record<string, unknown>): void {
    for (const field of type?.fields || []) {
        const value = values[field.id];
        const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
        if (field.required && empty) throw new DesignError('design_required', field.name);
        if (empty) continue;
        if (field.kind === 'number') {
            if (typeof value !== 'number' || !Number.isFinite(value) || (field.min !== undefined && value < field.min) ||
                (field.max !== undefined && value > field.max) || (field.step !== undefined && Math.abs((value - (field.min ?? 0)) / field.step - Math.round((value - (field.min ?? 0)) / field.step)) > 1e-7)) throw new DesignError('design_number', field.name);
        } else if (field.kind === 'checkbox') {
            if (typeof value !== 'boolean') throw new DesignError('design_invalid', field.name);
        } else if (field.kind === 'multiselect') {
            if (!Array.isArray(value) || value.some(v => !(field.options || []).some(o => o.value === v))) throw new DesignError('design_invalid', field.name);
        } else if (typeof value !== 'string' || (field.kind === 'select' && !(field.options || []).some(o => o.value === value))) throw new DesignError('design_invalid', field.name);
        if (field.kind === 'image') vaultPath(String(value));
        if (field.kind === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(String(value))) || new Date(String(value) + 'T00:00:00Z').toISOString().slice(0, 10) !== value)) throw new DesignError('design_invalid', field.name);
    }
}
export function defaultDesignSettings(lang: Language): DesignSettings {
    const name = (key: Parameters<typeof t>[1]) => t(lang, key);
    const field = (id: string, key: Parameters<typeof t>[1], kind: DesignField['kind'], extra: Partial<DesignField> = {}): DesignField => ({ id, name: name(key), kind, card: true, ...extra });
    const common = () => [field('tags', 'design_tags', 'text'), field('task', 'design_task', 'task'), field('status', 'design_status', 'status')];
    const definitions: [string, Parameters<typeof t>[1], string, string, DesignField[]][] = [
        ['character', 'design_type_character', '#8b5cf6', 'user-round', [field('role', 'design_role', 'text'), field('zone', 'design_zone', 'entity', { targetType: 'location' }), field('level', 'level', 'number', { min: 0, step: 1 }), field('personality', 'design_personality', 'longtext', { card: false }), field('portrait', 'design_portrait', 'image', { card: false }), field('faction', 'design_type_faction', 'entity', { targetType: 'faction' })]],
        ['location', 'design_type_location', '#14b8a6', 'map-pin', [field('biome', 'design_biome', 'text'), field('danger', 'design_danger', 'number', { min: 0, max: 10, step: 1 }), field('description', 'design_description', 'longtext', { card: false })]],
        ['mechanic', 'design_type_mechanic', '#3b82f6', 'cog', [field('trigger', 'design_trigger', 'text'), field('rules', 'design_rules', 'longtext', { card: false }), field('cost', 'design_cost', 'number', { min: 0 })]],
        ['item', 'design_type_item', '#f59e0b', 'package', [field('category', 'design_category', 'text'), field('value', 'design_value', 'number', { min: 0 }), field('stack', 'design_stack', 'number', { min: 1, step: 1 }), field('recipe', 'design_recipe', 'longtext', { card: false })]],
        ['enemy', 'design_type_enemy', '#ef4444', 'skull', [field('health', 'design_health', 'number', { min: 1 }), field('damage', 'design_damage', 'number', { min: 0 }), field('habitat', 'design_zone', 'entity', { targetType: 'location' }), field('behavior', 'design_behavior', 'longtext', { card: false })]],
        ['faction', 'design_type_faction', '#ec4899', 'flag', [field('goal', 'design_goal', 'text'), field('leader', 'design_leader', 'entity', { targetType: 'character' }), field('relations', 'design_relations', 'longtext', { card: false })]],
        ['story', 'design_type_story', '#6366f1', 'book-open', [field('chapter', 'design_chapter', 'text'), field('location', 'design_zone', 'entity', { targetType: 'location' }), field('outline', 'design_outline', 'longtext', { card: false })]],
        ['balance', 'design_type_balance', '#22c55e', 'scale', [field('metric', 'design_metric', 'text'), field('value', 'design_value', 'number'), field('target', 'design_target', 'number'), field('formula', 'design_formula', 'longtext', { card: false })]],
        ['idea', 'design_type_idea', '#eab308', 'lightbulb', [field('category', 'design_category', 'text'), field('priority', 'design_priority', 'select', { options: [{ value: 'low', color: '#22c55e', labelKey: 'design_low' }, { value: 'medium', color: '#eab308', labelKey: 'design_medium' }, { value: 'high', color: '#ef4444', labelKey: 'design_high' }] }), field('notes', 'design_description', 'longtext', { card: false })]],
    ];
    return { root: 'Projects/Factory Farm Dungeon Mining/Дизайн мира', projectId: '', types: definitions.map(([id, key, color, icon, fields]) => ({ id, name: name(key), folder: name(key), color, icon, fields: [...fields, ...common()] })) };
}
