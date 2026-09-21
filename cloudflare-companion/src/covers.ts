export interface CoverBucket {
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<{ body: ReadableStream; httpEtag: string } | null>;
  put(key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
}

export async function handleCoverRequest(request: Request, bucket?: CoverBucket): Promise<Response> {
  if (!bucket) return Response.json({ error: 'r2_not_configured' }, { status: 503 });
  const url = new URL(request.url);
  const hash = url.pathname.split('/').at(-1) || '';
  if (!/^[a-f0-9]{64}$/.test(hash)) return new Response('Invalid cover', { status: 400 });
  const key = `covers/${hash}.webp`;
  if (request.method === 'HEAD') return new Response(null, { status: await bucket.head(key) ? 200 : 404 });
  if (request.method === 'GET') {
    const object = await bucket.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, { headers: {
      'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: object.httpEtag, 'X-Content-Type-Options': 'nosniff'
    } });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  if (Number(request.headers.get('content-length')) > 256 * 1024) return new Response('Too large', { status: 413 });
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 256 * 1024) return new Response('Too large', { status: 413 });
  const decoder = new TextDecoder();
  if (decoder.decode(bytes.slice(0, 4)) !== 'RIFF' || decoder.decode(bytes.slice(8, 12)) !== 'WEBP') return new Response('Expected WebP', { status: 415 });
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== hash) return new Response('Hash mismatch', { status: 400 });
  if (!await bucket.head(key)) await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/webp' } });
  return Response.json({ ok: true, url: `${url.origin}/covers/${hash}` });
}
