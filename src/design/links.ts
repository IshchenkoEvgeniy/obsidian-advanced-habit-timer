/**
 * Link cards (L12): only web and mail addresses are opened. Anything else (javascript:, file:, obsidian:, custom schemes)
 * is refused. A bare domain such as "example.com" is treated as https.
 */
export function safeLink(raw: string): string | undefined {
    const value = (raw || '').trim();
    if (!value) return undefined;
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
    try {
        const url = new URL(candidate);
        return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : undefined;
    } catch {
        return undefined;
    }
}
