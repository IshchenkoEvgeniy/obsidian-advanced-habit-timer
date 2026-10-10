import { safeLink } from './links';
import type { LinkPreview } from './types';

export function webLink(raw: string): string | undefined {
    const url = safeLink(raw); return url && /^https?:\/\//i.test(url) ? url : undefined;
}
function decode(value: string): string {
    return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_all, entity: string) => {
        if (entity[0] === '#') { const code = parseInt(entity.slice(entity[1]?.toLowerCase() === 'x' ? 2 : 1), entity[1]?.toLowerCase() === 'x' ? 16 : 10); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; }
        return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[entity.toLowerCase()] || '';
    }).replace(/\s+/g, ' ').trim();
}
/** Reads only plain metadata. No fetched page HTML is inserted into the board. */
export function parseLinkPreview(html: string, address: string): LinkPreview {
    const url = webLink(address); if (!url) return {};
    const meta = new Map<string, string>();
    for (const tag of html.slice(0, 2000000).match(/<meta\b[^>]*>/gi) || []) {
        const attrs = new Map<string, string>();
        for (const attr of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs.set(attr[1]!.toLowerCase(), decode(attr[2] ?? attr[3] ?? attr[4] ?? ''));
        const name = attrs.get('property') || attrs.get('name'), content = attrs.get('content'); if (name && content) meta.set(name.toLowerCase(), content);
    }
    const result: LinkPreview = { title: (meta.get('og:title') || meta.get('twitter:title') || decode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || new URL(url).hostname).slice(0, 300), site: (meta.get('og:site_name') || new URL(url).hostname).slice(0, 150) };
    const description = meta.get('og:description') || meta.get('twitter:description') || meta.get('description'); if (description) result.description = description.slice(0, 1500);
    const image = meta.get('og:image') || meta.get('twitter:image');
    if (image) { try { result.image = webLink(new URL(image, url).href); } catch { /* A broken preview image does not discard the text. */ } }
    return result;
}
/** A small allowlist of media providers, with no arbitrary iframe URLs. */
export function mediaEmbed(raw: string): string | undefined {
    const href = webLink(raw); if (!href) return;
    const url = new URL(href), host = url.hostname.toLowerCase().replace(/^www\./, '');
    let video: string | undefined;
    if (host === 'youtu.be') video = url.pathname.slice(1).split('/')[0];
    else if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) video = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1];
    if (video && /^[\w-]{11}$/.test(video)) return `https://www.youtube-nocookie.com/embed/${video}`;
    if (host === 'vimeo.com' || host === 'player.vimeo.com') { const id = url.pathname.match(/\/(\d+)(?:\/|$)/)?.[1]; if (id) return `https://player.vimeo.com/video/${id}`; }
    return undefined;
}
