export interface ParsedRating {
    label: string;
    value: number;
}

/**
 * Parse a 1-10 rating with an optional quality modifier.
 * Both `7+`/`7-` and `+7`/`-7` forms are supported.
 */
export function parseRating(rating: string): ParsedRating | null {
    const label = rating.trim().replace(',', '.');
    const match = label.match(/^([+-]?)(\d+(?:\.\d+)?)([+-]?)$/);
    if (!match || (match[1] && match[3])) return null;

    const base = Number(match[2]);
    if (!Number.isFinite(base) || base < 1 || base > 10) return null;

    const modifier = match[3] || match[1] || '';
    const offset = modifier === '+' ? 0.25 : modifier === '-' ? -0.25 : 0;
    return { label, value: base + offset };
}

export function getRatingValue(rating: string): number {
    return parseRating(rating)?.value ?? 0;
}
