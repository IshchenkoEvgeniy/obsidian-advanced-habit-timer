/**
 * Safe frontmatter accessor utilities.
 *
 * Obsidian frontmatter values can be string | number | boolean | string[] | null | undefined.
 * Direct access like `fm['Status']` works most of the time, but breaks on edge cases:
 *   - A field can be a YAML list even if you expect a string
 *   - Numbers get parsed as numbers by YAML even if you expect "00:00:00"
 *   - undefined and null both represent "missing" but need different handling
 *
 * These helpers guarantee a safe return type and never throw.
 */

/** All possible frontmatter value types as parsed by Obsidian/js-yaml. */
export type FrontmatterValue = string | number | boolean | string[] | number[] | null | undefined;
export type Frontmatter = Record<string, FrontmatterValue>;

/**
 * Read a string field from frontmatter.
 * - If the value is already a string, returns it.
 * - If the value is an array, returns the first element as a string.
 * - Otherwise converts to string (numbers, booleans).
 * - Returns `fallback` (default '') for null/undefined.
 */
export function getString(fm: Frontmatter, key: string, fallback = ''): string {
    const val = fm[key];
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) {
        const first = val[0];
        return first !== null && first !== undefined ? String(first) : fallback;
    }
    return String(val);
}

/**
 * Read a string from any of a list of candidate keys (first non-empty wins).
 * Useful for fields that were renamed over time.
 */
export function getStringAny(fm: Frontmatter, keys: string[], fallback = ''): string {
    for (const key of keys) {
        const v = getString(fm, key, '');
        if (v) return v;
    }
    return fallback;
}

/**
 * Read a numeric field from frontmatter.
 * - Handles string "123", number 123, and boolean (true=1, false=0).
 * - Returns `fallback` (default 0) for null/undefined/NaN.
 */
export function getNumber(fm: Frontmatter, key: string, fallback = 0): number {
    const val = fm[key];
    if (val === null || val === undefined) return fallback;
    const n = Number(val);
    return isNaN(n) ? fallback : n;
}

/**
 * Read a numeric field, trying multiple keys (first non-zero wins).
 * Useful for progress fields that were renamed across file types.
 * Example: getNumberAny(fm, ['Progress', 'Read Pages', 'Listened'])
 */
export function getNumberAny(fm: Frontmatter, keys: string[], fallback = 0): number {
    for (const key of keys) {
        const n = getNumber(fm, key, NaN);
        if (!isNaN(n) && n !== 0) return n;
    }
    // Second pass: accept zero if explicitly set
    for (const key of keys) {
        const val = fm[key];
        if (val !== null && val !== undefined) {
            const n = Number(val);
            if (!isNaN(n)) return n;
        }
    }
    return fallback;
}

/**
 * Read a boolean field from frontmatter.
 * Handles `true`/`false` booleans, "true"/"false" strings, and 0/1 numbers.
 */
export function getBoolean(fm: Frontmatter, key: string, fallback = false): boolean {
    const val = fm[key];
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') return val.toLowerCase() === 'true';
    return fallback;
}

/**
 * Read a string array from frontmatter.
 * - If the value is already an array, returns it cast to string[].
 * - If it's a comma-separated string, splits it.
 * - If it's a single non-empty string, wraps it in an array.
 * - Returns [] for null/undefined.
 */
export function getStringArray(fm: Frontmatter, key: string): string[] {
    const val = fm[key];
    if (val === null || val === undefined) return [];
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === 'string') {
        if (!val.trim()) return [];
        return val.includes(',') ? val.split(',').map(s => s.trim()).filter(Boolean) : [val];
    }
    return [String(val)];
}

/** Read a string array from the first candidate key that contains values. */
export function getStringArrayAny(fm: Frontmatter, keys: string[]): string[] {
    for (const key of keys) {
        const values = getStringArray(fm, key)
            .map(value => value.trim())
            .filter(Boolean);
        if (values.length) return [...new Set(values)];
    }
    return [];
}

/**
 * Read a duration field stored as "HH:MM:SS" or "H:MM" string.
 * Returns seconds. Falls back to 0 on parse failure.
 * Keeps the import of parseDuration lazy to avoid circular deps.
 */
export function getDurationSec(fm: Frontmatter, key: string, parseDuration: (s: string) => number, fallback = 0): number {
    const raw = getString(fm, key, '');
    if (!raw) return fallback;
    const sec = parseDuration(raw);
    return isNaN(sec) ? fallback : sec;
}
