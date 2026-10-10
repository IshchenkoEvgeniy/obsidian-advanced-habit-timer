/**
 * Lowercase Latin letter of the pressed physical key.
 * `event.key` depends on the keyboard layout (Ctrl+Z gives "я" on a Russian layout),
 * `event.code` does not, so letter shortcuts read the code first.
 */
export function shortcutLetter(event: Pick<KeyboardEvent, 'key' | 'code'>): string {
    const code = event.code ?? '';
    if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
    return (event.key ?? '').toLowerCase();
}
