import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parse} from 'yaml';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),vault=resolve(root,'../../..');
const settings=JSON.parse(await readFile(resolve(root,'data.json'),'utf8'));
if(settings.projectScopes.some(s=>s.sourceType!=='folder'))throw new Error('Use Obsidian sync for non-folder project scopes');
const compiled=await build({stdin:{contents:"export { ProjectParser } from './src/projects/engine/parser'; export { ProjectCache } from './src/projects/engine/cache'; export { TFile } from 'obsidian';",resolveDir:root},bundle:true,platform:'node',format:'esm',write:false,alias:{obsidian:resolve(root,'tests/__mocks__/obsidian.ts')}});
const {ProjectParser,ProjectCache,TFile}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const files=[],contents=new Map(),metadata=new Map();
async function scan(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
 const path=resolve(folder,entry.name);if(entry.isDirectory())await scan(path);else if(entry.isFile()&&entry.name.endsWith('.md')){
  const key=relative(vault,path).replaceAll('\\','/');if(contents.has(key))continue;
  const file=new TFile(key),info=await stat(path);file.stat.mtime=info.mtimeMs;
  const content=await readFile(path,'utf8'),front=content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  files.push(file);contents.set(key,content);metadata.set(key,{frontmatter:front?parse(front[1]):{}});
 }
}}
for(const scope of settings.projectScopes)await scan(resolve(vault,scope.sourceValue));
const parser=new ProjectParser({vault:{getMarkdownFiles:()=>files,cachedRead:async f=>contents.get(f.path),read:async f=>contents.get(f.path)},metadataCache:{getFileCache:f=>metadata.get(f.path)}},new ProjectCache());
const tasks=[];
for(const scope of settings.projectScopes)for(const task of await parser.loadTasks(scope)){
 const identity=`${scope.id}:${task.id}`,keys=settings.cloudflareProjectKeys||{};
 tasks.push({key:Object.keys(keys).find(k=>keys[k]===identity)||identity,id:task.id,scopeId:scope.id,scopeName:scope.name,path:task.file.path,
 name:task.name,status:task.status,priority:task.priority||'',startDate:task.startDate||'',endDate:task.endDate||'',habitName:task.habitName||'',
 timeSpentSec:task.timeSpentSec||0,timeEstimatedSec:task.timeEstimatedSec||0,subtasks:(task.subtasks||[]).map(s=>({text:s.text,checked:s.checked}))});
}
const response=await fetch(`${settings.cloudflareWorkerUrl.replace(/\/+$/,'')}/api/sync/projects`,{method:'POST',headers:{Authorization:`Bearer ${settings.cloudflareApiToken}`,'Content-Type':'application/json'},
 body:JSON.stringify({tasks,scopes:settings.projectScopes.map(({id,name,statuses,sourceType})=>({id,name,statuses,sourceType}))})});
if(!response.ok)throw new Error(`Project sync failed: ${response.status}`);
console.log(await response.json());
