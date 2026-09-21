import { describe, expect, it, vi } from 'vitest';
import { handleCoverRequest } from '../cloudflare-companion/src/covers';

describe('cover storage', () => {
    const hash = 'a'.repeat(64);
    const url = `https://example.com/api/covers/${hash}`;
    function bucket() { return { head: vi.fn(async () => null), get: vi.fn(async () => null), put: vi.fn(async () => undefined) }; }
    it('reports unavailable storage', async () => {
        expect((await handleCoverRequest(new Request(url))).status).toBe(503);
    });
    it('rejects oversized uploads before storage', async () => {
        const storage = bucket();
        const response = await handleCoverRequest(new Request(url, { method: 'POST', body: new Uint8Array(262145) }), storage);
        expect(response.status).toBe(413);
        expect(storage.put).not.toHaveBeenCalled();
    });
    it('rejects non-WebP payloads and wrong hashes', async () => {
        const storage = bucket();
        expect((await handleCoverRequest(new Request(url, { method: 'POST', body: 'not an image' }), storage)).status).toBe(415);
        expect((await handleCoverRequest(new Request(url, { method: 'POST', body: 'RIFF0000WEBP' }), storage)).status).toBe(400);
        expect(storage.put).not.toHaveBeenCalled();
    });
    it('reuses an existing content-addressed cover', async () => {
        const bytes = new TextEncoder().encode('RIFF0000WEBP');
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
        const storage = { ...bucket(), head: vi.fn(async () => ({})) };
        const response = await handleCoverRequest(new Request(`https://example.com/api/covers/${digest}`, { method: 'POST', body: bytes }), storage);
        expect(response.status).toBe(200);
        expect(storage.put).not.toHaveBeenCalled();
        expect((await response.json()).url).toBe(`https://example.com/covers/${digest}`);
    });
    it('uploads a new content-addressed cover', async () => {
        const bytes = new TextEncoder().encode('RIFF0000WEBP');
        bytes.set([0xc2, 0x80, 0, 0], 4);
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
        const storage = bucket();
        expect((await handleCoverRequest(new Request(`https://example.com/api/covers/${digest}`, { method: 'POST', body: bytes }), storage)).status).toBe(200);
        expect(storage.put).toHaveBeenCalledOnce();
    });
});
