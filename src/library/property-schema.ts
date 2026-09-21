import type { HabitTimerSettings, LibraryPropertyAliases, LibraryPropertyField } from '../types';
import { DEFAULT_LIBRARY_PROPERTY_ALIASES } from '../types';
import type { Frontmatter, FrontmatterValue } from '../utils/frontmatter';
import { getNumberAny, getStringAny, getStringArrayAny } from '../utils/frontmatter';

export function normalizeAliases(
    aliases: Partial<LibraryPropertyAliases> | undefined
): LibraryPropertyAliases {
    const normalized = {} as LibraryPropertyAliases;
    for (const field of Object.keys(DEFAULT_LIBRARY_PROPERTY_ALIASES) as LibraryPropertyField[]) {
        const configured = aliases?.[field];
        const source = Array.isArray(configured) && configured.length
            ? configured
            : DEFAULT_LIBRARY_PROPERTY_ALIASES[field];
        normalized[field] = [...new Set(source.map(value => value.trim()).filter(Boolean))];
    }
    return normalized;
}

export function aliasesFor(settings: HabitTimerSettings, field: LibraryPropertyField): string[] {
    return settings.libraryPropertyAliases[field];
}

export function primaryProperty(settings: HabitTimerSettings, field: LibraryPropertyField): string {
    return aliasesFor(settings, field)[0] || DEFAULT_LIBRARY_PROPERTY_ALIASES[field][0] || field;
}

export function readPropertyString(
    fm: Frontmatter,
    settings: HabitTimerSettings,
    field: LibraryPropertyField,
    fallback = ''
): string {
    return getStringAny(fm, aliasesFor(settings, field), fallback);
}

export function readPropertyStrings(
    fm: Frontmatter,
    settings: HabitTimerSettings,
    field: LibraryPropertyField
): string[] {
    return getStringArrayAny(fm, aliasesFor(settings, field));
}

export function readPropertyNumber(
    fm: Frontmatter,
    settings: HabitTimerSettings,
    field: LibraryPropertyField,
    fallback = 0
): number {
    return getNumberAny(fm, aliasesFor(settings, field), fallback);
}

export function findPresentProperty(
    fm: Frontmatter,
    settings: HabitTimerSettings,
    field: LibraryPropertyField
): string | null {
    return aliasesFor(settings, field).find(key => fm[key] !== null && fm[key] !== undefined) || null;
}

export function writeProperty(
    fm: Frontmatter,
    settings: HabitTimerSettings,
    field: LibraryPropertyField,
    value: FrontmatterValue,
    removeAliases = true
): void {
    const primary = primaryProperty(settings, field);
    fm[primary] = value;
    if (!removeAliases) return;
    aliasesFor(settings, field).forEach(alias => {
        if (alias !== primary && fm[alias] !== undefined) delete fm[alias];
    });
}
