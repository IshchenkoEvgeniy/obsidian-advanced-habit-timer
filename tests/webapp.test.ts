import { describe, expect, it } from 'vitest';
import { validateTelegramInitData } from '../cloudflare-companion/src/webapp-auth';
import { webAppHtml } from '../cloudflare-companion/src/webapp';
import { parse } from 'acorn';

async function signedData(token: string, userId: number, authDate: number): Promise<string> {
    const params = new URLSearchParams({ auth_date: String(authDate), query_id: 'q1', user: JSON.stringify({ id: userId, first_name: 'Test' }) });
    const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
    const encoder = new TextEncoder();
    const secret = await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encoder.encode(token));
    const signature = await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encoder.encode(check));
    params.set('hash', [...new Uint8Array(signature)].map(value => value.toString(16).padStart(2, '0')).join(''));
    return params.toString();
}

describe('Telegram Mini App', () => {
    it('accepts a fresh signed session for the configured private chat', async () => {
        const now = 1_800_000_000_000;
        const session = await validateTelegramInitData(await signedData('token', 42, now / 1000), 'token', '42', now);
        expect(session?.user.id).toBe(42);
    });

    it('rejects tampering, another user, and expired sessions', async () => {
        const now = 1_800_000_000_000;
        const valid = await signedData('token', 42, now / 1000);
        expect(await validateTelegramInitData(valid.replace('Test', 'Fake'), 'token', '42', now)).toBeNull();
        expect(await validateTelegramInitData(valid, 'token', '99', now)).toBeNull();
        expect(await validateTelegramInitData(valid, 'token', '42', now + 90_000_000)).toBeNull();
    });

    it('ships all four views and syntactically valid client JavaScript', () => {
        const html = webAppHtml();
        expect(html).toContain('data-tab="today"');
        expect(html).toContain('data-tab="timer"');
        expect(html).toContain('data-tab="library"');
        expect(html).toContain('data-tab="stats"');
        const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)];
        expect(scripts.length).toBeGreaterThan(0);
        const source = scripts.at(-1)?.[1] || '';
        try { parse(source, { ecmaVersion: 'latest' }); }
        catch (error) {
            const line = (error as { loc?: { line?: number } }).loc?.line || 0;
            throw new Error(`${String(error)}\n${source.split('\n')[line - 1] || ''}`);
        }
    });
});
