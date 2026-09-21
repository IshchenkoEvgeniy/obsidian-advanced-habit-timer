import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFromWebApp } from '../cloudflare-companion/src/webapp-create';
import type { CompanionConfigRow, Env } from '../cloudflare-companion/src/types';

vi.mock('../cloudflare-companion/src/db', () => ({
    findLibraryDuplicate: vi.fn(async () => null), getLibraryCollections: vi.fn(async () => []),
    getLibrarySuggestions: vi.fn(async () => []), nextSeriesIndex: vi.fn(async () => 4)
}));
import { findLibraryDuplicate } from '../cloudflare-companion/src/db';

describe('Mini App creation events', () => {
    const config = { timezone: 'Europe/Kyiv' } as CompanionConfigRow;
    const requestId = '12345678-1234-1234-1234-123456789012';
    beforeEach(() => vi.clearAllMocks());
    function setup(alreadySaved = false) {
        const run = vi.fn(async () => ({ success: true }));
        const bind = vi.fn(() => ({ first: vi.fn(async () => alreadySaved ? { sequence: 1 } : null), run }));
        const env = { DB: { prepare: vi.fn(() => ({ bind })) } } as unknown as Env;
        return { env, run, bind };
    }
    function request(body: object) { return new Request('https://example.com/app/api/capture', { method: 'POST', body: JSON.stringify({ requestId, ...body }) }); }
    it('queues category, text, and URL for the existing daily note consumer', async () => {
        const { env, bind, run } = setup();
        const response = await createFromWebApp(request({ category: 'link', text: 'Прочитать позже', url: 'https://example.com/article' }), env, 'default', config, 'capture');
        expect(response.status).toBe(200);
        expect(run).toHaveBeenCalledOnce();
        const payload = JSON.parse(bind.mock.calls.at(-1)![5] as unknown as string);
        expect(payload.category).toBe('link');
        expect(payload.text).toBe('Прочитать позже\nhttps://example.com/article');
    });
    it('rejects empty captures and unsafe links without writing', async () => {
        const { env, run } = setup();
        expect((await createFromWebApp(request({ category: 'thought', text: ' ' }), env, 'default', config, 'capture')).status).toBe(400);
        expect((await createFromWebApp(request({ category: 'link', url: 'javascript:alert(1)' }), env, 'default', config, 'capture')).status).toBe(400);
        expect(run).not.toHaveBeenCalled();
    });
    it('does not create a second event on retry', async () => {
        const { env, run } = setup(true);
        expect((await createFromWebApp(request({ category: 'thought', text: 'Idea' }), env, 'default', config, 'capture')).status).toBe(200);
        expect(run).not.toHaveBeenCalled();
    });
    it('preserves multiple values and uses minutes for audiobooks', async () => {
        const { env, bind } = setup();
        const response = await createFromWebApp(request({ title: 'Book', collectionId: 'book', authors: 'A, B, A', genres: ['Novel'],
            total: '120', series: 'Series', seriesIndex: '', format: 'Audiobook', unit: 'pages' }), env, 'default', config, 'library_create');
        expect(response.status).toBe(200);
        const payload = JSON.parse(bind.mock.calls.at(-1)![5] as unknown as string);
        expect(payload).toMatchObject({ authors: ['A', 'B'], unit: 'minutes', seriesIndex: 4, total: 120 });
    });
    it('requires explicit confirmation for duplicates', async () => {
        vi.mocked(findLibraryDuplicate).mockResolvedValueOnce({ title: 'Book' } as never);
        const { env, run } = setup();
        const response = await createFromWebApp(request({ title: 'Book', collectionId: 'book', unit: 'pages' }), env, 'default', config, 'library_create');
        expect(response.status).toBe(409);
        expect(run).not.toHaveBeenCalled();
    });
});
