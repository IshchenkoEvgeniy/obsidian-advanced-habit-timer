/** Paper tint shared by the live canvas and vector export. Stored user colors stay intact. */
export function paperColor(value = '#facc15'): string {
    const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value)?.[1];
    if (!hex) return value;
    const expanded = hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex;
    return '#' + [0, 2, 4].map(at => Math.round(parseInt(expanded.slice(at, at + 2), 16) * .35 + 255 * .65).toString(16).padStart(2, '0')).join('');
}
