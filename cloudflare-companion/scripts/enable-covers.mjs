import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const configPath = new URL('../wrangler.jsonc', import.meta.url);
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const bucket = 'habit-timer-covers';
const options = { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' };
const listing = execFileSync(process.execPath, [wrangler, 'r2', 'bucket', 'list'], options);
if (!listing.includes(bucket)) execFileSync(process.execPath, [wrangler, 'r2', 'bucket', 'create', bucket], { ...options, stdio: 'inherit' });
const config = JSON.parse(await readFile(configPath, 'utf8'));
config.r2_buckets = [...(config.r2_buckets || []).filter(item => item.binding !== 'COVERS'), { binding: 'COVERS', bucket_name: bucket }];
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
execFileSync(process.execPath, [wrangler, 'deploy'], { ...options, stdio: 'inherit' });
