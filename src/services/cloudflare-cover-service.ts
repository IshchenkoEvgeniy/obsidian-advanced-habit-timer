import { requestUrl, TFile } from 'obsidian';
import type HabitTimerPlugin from '../main';

export class CloudflareCoverService {
    private cache = new Map<string, { revision: string; url: string }>();
    constructor(private plugin: HabitTimerPlugin) {}

    async available(): Promise<boolean> {
        try {
            const response = await requestUrl({ url: `${this.baseUrl}/api/covers/status`, headers: this.headers });
            return response.json?.enabled === true;
        } catch { return false; }
    }

    async resolve(cover: string, sourcePath: string, enabled: boolean): Promise<string> {
        if (/^https?:\/\//i.test(cover)) return cover;
        if (!cover) return '';
        const link = (cover.replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0] || '').split('#')[0] || '';
        const file = this.plugin.app.metadataCache.getFirstLinkpathDest(link, sourcePath);
        if (!(file instanceof TFile)) return '';
        const revision = `${file.stat.mtime}:${file.stat.size}:${this.baseUrl}`;
        const previous = this.cache.get(file.path);
        if (previous?.revision === revision) return previous.url;
        if (!enabled) return previous?.url || '';
        try {
            if (file.stat.size > 20 * 1024 * 1024 || !/^(png|jpe?g|webp|gif|avif)$/i.test(file.extension)) return '';
            const original = await this.plugin.app.vault.readBinary(file);
            const bitmap = await createImageBitmap(new Blob([original]));
            let bytes: ArrayBuffer;
            try {
                const canvas = document.createElement('canvas');
                const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
                canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                const context = canvas.getContext('2d');
                if (!context) throw new Error('Canvas unavailable');
                context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
                    value => value ? resolve(value) : reject(new Error('Cover conversion failed')), 'image/webp', 0.78));
                if (blob.size > 256 * 1024) throw new Error('Cover too large');
                bytes = await blob.arrayBuffer();
            } finally { bitmap.close(); }
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
            const url = `${this.baseUrl}/covers/${hash}`;
            const existing = await requestUrl({ url, method: 'HEAD', throw: false });
            if (existing.status !== 200) {
                await requestUrl({ url: `${this.baseUrl}/api/covers/${hash}`, method: 'POST',
                    headers: { ...this.headers, 'Content-Type': 'image/webp' }, body: bytes });
            }
            this.cache.set(file.path, { revision, url });
            return url;
        } catch (error) {
            console.warn(`Cover sync failed: ${file.path}`, error);
            return previous?.url || '';
        }
    }

    private get baseUrl(): string { return (this.plugin.settings.cloudflareWorkerUrl || '').trim().replace(/\/+$/, ''); }
    private get headers(): Record<string, string> { return { Authorization: `Bearer ${(this.plugin.settings.cloudflareApiToken || '').trim()}` }; }
}
