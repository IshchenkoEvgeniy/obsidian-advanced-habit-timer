import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, '../..');
const vaultRoot = resolve(pluginRoot, '../../..');
const settings = JSON.parse(await readFile(resolve(pluginRoot, 'data.json'), 'utf8'));
const aliases = settings.libraryPropertyAliases || {};

function frontmatterOf(markdown) {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/);
  return match ? (parse(match[1]) || {}) : null;
}

function aliasedValue(frontmatter, key) {
  const names = aliases[key] || [];
  const actual = new Map(Object.keys(frontmatter).map(name => [name.toLocaleLowerCase(), name]));
  for (const alias of names) {
    const property = actual.get(String(alias).toLocaleLowerCase());
    if (property !== undefined) return frontmatter[property];
  }
  return undefined;
}

function stringValue(value, fallback = '') {
  if (Array.isArray(value)) return stringValue(value[0], fallback);
  if (value === null || value === undefined) return fallback;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim() || fallback;
}

function stringValues(value) {
  if (Array.isArray(value)) return value.flatMap(stringValues).filter(Boolean);
  const text = stringValue(value);
  return text ? text.split(',').map(part => part.trim()).filter(Boolean) : [];
}

function numberValue(value) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeUnit(value, fallback) {
  const normalized = stringValue(value).toLocaleLowerCase();
  const known = ['pages', 'items', 'episodes', 'chapters', 'minutes', 'hours', 'lessons', 'units'];
  if (known.includes(normalized)) return normalized;
  if (/page|страниц/.test(normalized)) return 'pages';
  if (/episode|эпизод/.test(normalized)) return 'episodes';
  if (/chapter|глав/.test(normalized)) return 'chapters';
  if (/minute|минут/.test(normalized)) return 'minutes';
  if (/hour|час/.test(normalized)) return 'hours';
  if (/lesson|урок/.test(normalized)) return 'lessons';
  if (/item|произвед|штук|шт/.test(normalized)) return 'items';
  return fallback || 'units';
}

async function markdownFiles(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.md')) files.push(path);
  }
  return files;
}

const library = [];
for (const collection of settings.mediaCollections || []) {
  if (!collection.enabled || !collection.folder) continue;
  const folder = resolve(vaultRoot, collection.folder);
  let files = [];
  try { files = await markdownFiles(folder); } catch { continue; }
  for (const file of files) {
    const itemPath = relative(vaultRoot, file).replaceAll('\\', '/');
    if (/шаблоны|templates?/i.test(itemPath)) continue;
    const frontmatter = frontmatterOf(await readFile(file, 'utf8'));
    if (!frontmatter) continue;
    const format = stringValue(aliasedValue(frontmatter, 'format'));
    const total = numberValue(aliasedValue(frontmatter, 'total'));
    const explicitUnit = normalizeUnit(aliasedValue(frontmatter, 'unit'), collection.dailyGoalUnit);
    const unit = /audio|аудио/i.test(format)
      ? 'minutes'
      : collection.id.toLocaleLowerCase() === 'film' && explicitUnit === 'items' && total > 1
        ? 'minutes'
        : explicitUnit;
    const cover = stringValue(aliasedValue(frontmatter, 'cover'));
    library.push({
      path: itemPath,
      title: stringValue(aliasedValue(frontmatter, 'title'), file.split(/[\\/]/).at(-1).replace(/\.md$/i, '')),
      collectionId: collection.id,
      status: stringValue(aliasedValue(frontmatter, 'status')),
      format,
      rating: stringValue(aliasedValue(frontmatter, 'rating')),
      total,
      progress: numberValue(aliasedValue(frontmatter, 'progress')),
      authors: stringValues(aliasedValue(frontmatter, 'author')),
      genres: stringValues(aliasedValue(frontmatter, 'genre')),
      series: stringValue(aliasedValue(frontmatter, 'series')),
      seriesIndex: numberValue(aliasedValue(frontmatter, 'seriesIndex')),
      unit,
      coverUrl: /^https?:\/\//i.test(cover) ? cover : '',
      startDate: stringValue(aliasedValue(frontmatter, 'startDate')),
      endDate: stringValue(aliasedValue(frontmatter, 'endDate')),
      season: numberValue(aliasedValue(frontmatter, 'season')),
      episode: numberValue(aliasedValue(frontmatter, 'episode')),
      readingStatus: collection.readingStatusName || '',
      finishedStatus: collection.finishedStatusName || ''
    });
  }
}

const workerUrl = stringValue(settings.cloudflareWorkerUrl).replace(/\/$/, '');
const token = stringValue(settings.cloudflareApiToken);
if (!workerUrl || !token) throw new Error('Cloudflare Worker URL or API token is not configured');
const response = await fetch(`${workerUrl}/api/sync/library`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ library })
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(`Library sync failed (${response.status})`);
console.log(`Library synchronized: ${result.libraryItemCount} items.`);
