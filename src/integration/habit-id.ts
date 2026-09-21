import type { HabitProperty } from '../types';

export type HabitIdFactory = () => string;

function randomPart(): string {
    const cryptoObject = globalThis.crypto;
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
        return cryptoObject.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createHabitId(): string {
    return `habit-${randomPart()}`;
}

export function normalizeHabitId(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Adds missing IDs and repairs duplicates. Returns true when settings changed.
 * IDs intentionally do not contain the habit name, so renaming a habit keeps
 * dashboard bindings stable.
 */
export function ensureHabitPropertyIds(
    properties: HabitProperty[],
    idFactory: HabitIdFactory = createHabitId
): boolean {
    const used = new Set<string>();
    let changed = false;

    for (const property of properties) {
        let id = normalizeHabitId(property.id);
        if (!id || used.has(id)) {
            do {
                id = normalizeHabitId(idFactory());
            } while (!id || used.has(id));
            property.id = id;
            changed = true;
        } else if (property.id !== id) {
            property.id = id;
            changed = true;
        }
        used.add(id);
    }

    return changed;
}

export function habitId(property: HabitProperty): string {
    return normalizeHabitId(property.id) || `legacy:${property.name}`;
}

