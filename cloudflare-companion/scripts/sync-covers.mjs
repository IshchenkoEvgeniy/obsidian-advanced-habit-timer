import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, relative, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const vaultRoot = resolve(pluginRoot, '../../..');
const settings = JSON.parse(await readFile(resolve(pluginRoot, 'data.json'), 'utf8'));
const require = createRequire(import.meta.url);
const sharp = require(process.env.COVER_SHARP_PATH || 'sharp');
const baseUrl = settings.cloudflareWorkerUrl.trim().replace(/\/+$/, '');
const headers = { Authorization: `Bearer ${settings.cloudflareApiToken.trim()}` };
const status = await fetch(`${baseUrl}/api/covers/status`, { headers });
if (!status.ok || !(await status.json()).enabled) throw new Error('R2 is not enabled');

async function walk(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
const files = await walk(vaultRoot);
const images = files.filter(file => /\.(png|jpe?g|webp|gif|avif)$/i.test(file));
const uploaded = new Map();
const verified = new Set();
let linked = 0;
let bytesUploaded = 0;
const failures = [];
for (const file of files.filter(file => /\.md$/i.test(file))) {
  const path = relative(vaultRoot, file).replaceAll('\\', '/');
  if (process.argv[2] && path !== process.argv[2]) continue;
  if (!settings.mediaCollections.some(collection => collection.folder && path.startsWith(`${collection.folder}/`))) continue;
  if (/шаблоны|templates?/i.test(path)) continue;
  const markdown = await readFile(file, 'utf8');
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/);
  if (!match) continue;
  const fm = parse(match[1]) || {};
  const names = settings.libraryPropertyAliases?.cover || ['Cover'];
  const key = names.map(alias => Object.keys(fm).find(key => key.toLowerCase() === alias.toLowerCase())).find(Boolean);
  let cover = key ? fm[key] : '';
  if (Array.isArray(cover)) cover = cover[0];
  if (typeof cover !== 'string' || !cover || /^https?:\/\//i.test(cover)) continue;
  try {
    cover = cover.replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0];
    const direct = [resolve(dirname(file), cover), resolve(vaultRoot, cover)];
    const candidates = images.filter(image => relative(vaultRoot, image).replaceAll('\\', '/').endsWith(`/${cover}`) || basename(image) === cover);
    const image = direct.find(candidate => images.includes(candidate)) || (candidates.length === 1 ? candidates[0] : undefined);
    if (!image) throw new Error(candidates.length > 1 ? 'Ambiguous image name' : 'Image not found');
    let coverUrl = uploaded.get(image);
    if (!coverUrl) {
      if ((await stat(image)).size > 20 * 1024 * 1024) throw new Error('Original exceeds 20 MB');
      const bytes = await sharp(image).rotate().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
      if (bytes.length > 256 * 1024) throw new Error('Thumbnail exceeds 256 KB');
      const hash = createHash('sha256').update(bytes).digest('hex');
      coverUrl = `${baseUrl}/covers/${hash}`;
      const existing = await fetch(coverUrl, { method: 'HEAD' });
      if (existing.status !== 200) {
        const upload = await fetch(`${baseUrl}/api/covers/${hash}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'image/webp' }, body: bytes });
        if (!upload.ok) throw new Error(`Upload failed: ${upload.status}`);
        bytesUploaded += bytes.length;
      }
      const check = await fetch(coverUrl);
      if (!check.ok || check.headers.get('content-type') !== 'image/webp') throw new Error('Image URL verification failed');
      const metadata = await sharp(Buffer.from(await check.arrayBuffer())).metadata();
      if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > 480) throw new Error('Invalid image dimensions');
      verified.add(coverUrl);
      uploaded.set(image, coverUrl);
    }
    const link = await fetch(`${baseUrl}/api/covers/link`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ path, coverUrl }) });
    if (!link.ok) throw new Error(`Link failed: ${link.status}`);
    linked++;
  } catch (error) { failures.push({ path, error: error.message }); }
}
console.log(JSON.stringify({ linked, uniqueImages: verified.size, uploadedKB: Math.round(bytesUploaded / 1024), failures }, null, 2));
if (failures.length) process.exitCode = 1;
