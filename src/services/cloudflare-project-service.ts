import { TFile } from 'obsidian';
import type HabitTimerPlugin from '../main';
import type { BoardTask } from '../../cloudflare-companion/src/project-board';
import { projectTaskToData } from '../projects/task-data';
import type { ProjectTask } from '../projects/types';
import { findTaskBlockEnd } from '../projects/engine/task-block';
import { parseDuration } from '../utils';
import type { Frontmatter } from '../utils/frontmatter';
import { blockIdFromTaskLine, newTaskBlockId, taskDisplayTitle, stableHash } from '../projects/engine/task-identity';
import { readTaskMetadata, replaceTaskMetadata, stripTaskMetadata } from '../projects/engine/task-metadata';
import { markdownContentLines } from '../projects/engine/markdown-lines';
import { validateTaskData } from '../projects/task-validation';

function comparableSubtasks(subtasks:BoardTask['subtasks']):BoardTask['subtasks'] {
 return subtasks.map(subtask=>({text:taskDisplayTitle(subtask.text),checked:subtask.checked}));
}

export class CloudflareProjectService {
 constructor(private plugin:HabitTimerPlugin){}
 private children(task:ProjectTask,tasks:ProjectTask[]):BoardTask['subtasks'] {
  return (task.subtasks||[]).map(child=>({
   id:tasks.find(candidate=>candidate.file.path===task.file.path&&candidate.sourceLine===child.line)?.id ||
    readTaskMetadata(child.text).id || blockIdFromTaskLine(child.text) ||
    `child:${task.id}:${stableHash(stripTaskMetadata(child.text))}:${child.line}`,
   text:taskDisplayTitle(child.text),checked:child.checked
  }));
 }
 private boardTask(scopeId:string,scopeName:string,task:ProjectTask,tasks:ProjectTask[],key:string):BoardTask {
  const descendants=new Set([task.id]);
  for(const candidate of tasks)if(candidate.parentId&&descendants.has(candidate.parentId))descendants.add(candidate.id);
  return {key,scopeId,scopeName,path:task.file.path,id:task.id,blockId:task.blockId,
   name:task.name,status:task.status,priority:task.priority||'',startDate:task.startDate||'',endDate:task.endDate||'',habitName:task.habitName||'',
   timeSpentSec:task.timeSpentSec||0,timeEstimatedSec:task.timeEstimatedSec||0,subtasks:this.children(task,tasks),
   stateSignature:stableHash(JSON.stringify({description:task.description||'',tags:task.tags||'',cover:task.cover||'',
    color:task.color||'',section:task.section||'',parent:task.parentId||'',archived:!!task.archived,
    order:task.order||0,images:task.images||[],body:task.sourceContent?.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'')||''})),
   subtreeSignature:stableHash(JSON.stringify(tasks.filter(candidate=>candidate.id!==task.id&&descendants.has(candidate.id)).map(candidate=>
    ({id:candidate.id,name:candidate.name,status:candidate.status,description:candidate.description||'',
     start:candidate.startDate,due:candidate.endDate,spent:candidate.timeSpentSec,estimate:candidate.timeEstimatedSec,
     priority:candidate.priority,tags:candidate.tags,habit:candidate.habitName,cover:candidate.cover,color:candidate.color,
     section:candidate.section,parent:candidate.parentId,archived:!!candidate.archived,order:candidate.order,images:candidate.images}))))};
 }
 async snapshot():Promise<BoardTask[]>{
  const items:BoardTask[]=[];
  const keys=this.plugin.settings.cloudflareProjectKeys||{};
  for(const scope of this.plugin.settings.projectScopes){
   const tasks=await this.plugin.projectEngine.loadTasks(scope);
   for(const task of tasks){
    const identity=`${scope.id}:${task.id}`;
    const key=Object.keys(keys).find(k=>keys[k]===identity)||identity;
    items.push(this.boardTask(scope.id,scope.name,task,tasks,key));
   }
  }
  return items.sort((a,b)=>a.key.localeCompare(b.key));
 }
 async apply(payload:{action?:string;task:BoardTask;previous?:BoardTask;seconds?:number},timer=false):Promise<void>{
  const incoming=payload.task;
  const scope=this.plugin.settings.projectScopes.find(s=>s.id===incoming.scopeId);
  if(!scope)throw new Error(`Project scope missing: ${incoming.scopeId}`);
  const engine=this.plugin.projectEngine;
  const single=scope.sourceType==='file';
  const keys=this.plugin.settings.cloudflareProjectKeys||(this.plugin.settings.cloudflareProjectKeys={});
  const previous=payload.previous||incoming;
  engine.invalidateCacheEntry(previous.path);
  let tasks=await engine.loadTasks(scope);
  let task=tasks.find(t=>keys[incoming.key]===`${scope.id}:${t.id}`||t.id===previous.id);
  if(!task)task=tasks.find(t=>t.file.path===previous.path&&(single?t.blockId===previous.blockId&&!!previous.blockId:true));
  if(payload.action==='create'&&!task){
   if(tasks.some(candidate=>candidate.name===incoming.name))throw new Error('A local task with this name already exists');
   task=await engine.createTask(scope,{name:incoming.name,status:incoming.status,priority:incoming.priority,habitName:incoming.habitName,
    startDate:incoming.startDate,endDate:incoming.endDate,timeEstimated:this.plugin.formatTime(incoming.timeEstimatedSec)});
   keys[incoming.key]=`${scope.id}:${task.id}`;
   await this.plugin.saveSettings();
   tasks=await engine.loadTasks(scope);
  }
  if(!task){if(payload.action==='delete')return;throw new Error(`Project task not found: ${previous.name}`);}
  const local=this.boardTask(scope.id,scope.name,task,tasks,incoming.key);
  const fields=['name','status','priority','startDate','endDate','habitName','timeEstimatedSec'] as const;
  if(payload.action==='delete'){
   if(!previous.stateSignature || previous.stateSignature!==local.stateSignature ||
    fields.some(field=>local[field]!==previous[field]) || local.timeSpentSec!==previous.timeSpentSec ||
    JSON.stringify(comparableSubtasks(local.subtasks))!==JSON.stringify(comparableSubtasks(previous.subtasks)) ||
    (previous.subtreeSignature ? previous.subtreeSignature!==local.subtreeSignature : tasks.some(candidate=>candidate.parentId===task!.id&&candidate.subtasks?.length))) {
    throw new Error('The task or its descendants changed locally. Synchronize before deleting it in Companion.');
   }
   await engine.deleteTask(task,single);delete keys[incoming.key];await this.plugin.saveSettings();return;
  }
  if(timer){
   const timerTask=task;
   const seconds=Math.max(0,Math.round(payload.seconds||0));
   if(single){
    await this.plugin.app.vault.process(task.file,content=>{
     const lines=content.split('\n');
     const contentLines=markdownContentLines(lines);
     const index=timerTask.blockId?lines.findIndex((line,row)=>contentLines[row]&&line.trimEnd().endsWith(` ^${timerTask.blockId}`)):timerTask.sourceLine??-1;
     if(index<0||!lines[index])throw new Error('Task block missing');
     const current=lines[index].match(/⏱️\s*(\d+:\d+(?::\d+)?)/)?.[1]||'00:00:00';
     const tag=`⏱️ ${this.plugin.formatTime(parseDuration(current)+seconds)}`;
     lines[index]=/⏱️\s*\d+:\d+(?::\d+)?/.test(lines[index])?lines[index].replace(/⏱️\s*\d+:\d+(?::\d+)?/,tag):lines[index].replace(/(\s+\^[\w-]+)?$/,` ${tag}$1`);
     return lines.join('\n');
    });
   }else await this.plugin.app.fileManager.processFrontMatter(task.file,(fm:Frontmatter)=>{fm.time_spent=this.plugin.formatTime(parseDuration(fm.time_spent||'00:00:00')+seconds);});
  }else{
   const merged={...incoming};
   const conflicts:string[]=[];
   for(const field of fields){
    const remoteChanged=incoming[field]!==previous[field];
    if(payload.action!=='create'&&!remoteChanged)Object.assign(merged,{[field]:local[field]});
    else if(payload.action!=='create'&&local[field]!==previous[field]&&local[field]!==incoming[field])conflicts.push(field);
   }
   if(conflicts.length)throw new Error(`Project fields changed locally and in Companion: ${conflicts.join(', ')}`);
   if(!scope.statuses.split(',').map(value=>value.trim()).includes(merged.status))throw new Error(`Unknown project status: ${merged.status}`);
   const childChanges=payload.action==='create'||JSON.stringify(comparableSubtasks(incoming.subtasks))!==JSON.stringify(comparableSubtasks(previous.subtasks));
   if(childChanges&&payload.action!=='create'&&JSON.stringify(comparableSubtasks(local.subtasks))!==JSON.stringify(comparableSubtasks(previous.subtasks))&&
    JSON.stringify(comparableSubtasks(local.subtasks))!==JSON.stringify(comparableSubtasks(incoming.subtasks))) {
    throw new Error('Subtasks changed locally and in Companion. Synchronize before editing them again.');
   }
   const data=projectTaskToData(task,v=>this.plugin.formatTime(v),{name:merged.name,status:merged.status,priority:merged.priority,habitName:merged.habitName,
    startDate:merged.startDate,endDate:merged.endDate,timeEstimated:merged.timeEstimatedSec?this.plugin.formatTime(merged.timeEstimatedSec):''});
   const columns=scope.statuses.split(',').map(value=>value.trim()).filter(Boolean);
   validateTaskData(data,columns,!single);
   for(const child of incoming.subtasks)validateTaskData({name:taskDisplayTitle(child.text)});
   const removed=previous.subtasks.some(old=>old.id&&!incoming.subtasks.some(child=>child.id===old.id));
   if(childChanges&&removed&&previous.subtreeSignature!==local.subtreeSignature)throw new Error('Descendants changed locally. Synchronize before removing subtasks in Companion.');
   if(childChanges)await this.replaceSubtasks(task,incoming.subtasks,single,local.subtasks,previous.subtasks);
   const written=await engine.saveTask(task.file,data,single,task.name,scope.statuses.split(',').map(s=>s.trim()),task.blockId,task.sourceLine);
   const refreshed=(await engine.loadTasks(scope)).find(t=>t.file.path===written.file.path&&
    (written.blockId?t.blockId===written.blockId:t.file.path===written.file.path));
   if(refreshed)task=refreshed;
  }
  keys[incoming.key]=`${scope.id}:${task.id}`;
  engine.invalidateCacheEntry(task.file.path);
  await this.plugin.saveSettings();
 }
 private async replaceSubtasks(task:ProjectTask,subtasks:BoardTask['subtasks'],single:boolean,local:BoardTask['subtasks'],previous:BoardTask['subtasks']):Promise<void>{
  if(JSON.stringify(comparableSubtasks(task.subtasks||[]))===JSON.stringify(comparableSubtasks(subtasks)))return;
  await this.plugin.app.vault.process(task.file,content=>{
   const lines=content.split('\n');
   const contentLines=markdownContentLines(lines);
   let start=0,end=lines.length,indent='';
   if(single){
    start=task.blockId?lines.findIndex((line,row)=>contentLines[row]&&line.trimEnd().endsWith(` ^${task.blockId}`)):task.sourceLine??-1;
    if(start<0)throw new Error('Task block missing');
    if(taskDisplayTitle(lines[start]!.replace(/^[ \t]*-[ \t]+\[[ xX]\][ \t]*/,''))!==task.name)throw new Error('Task line moved. Synchronize again.');
    const parentIndent=lines[start]!.match(/^\s*/)?.[0]||'';
    if(task.sourceBlock!==undefined&&lines.slice(start,findTaskBlockEnd(lines,start,parentIndent.length)).join('\n')!==task.sourceBlock)throw new Error('Task subtree changed during synchronization. Refresh the project.');
    end=findTaskBlockEnd(lines,start,parentIndent.length);indent=parentIndent+'  ';start++;
   }
   const indices=(task.subtasks||[]).map(s=>s.line).filter(i=>i>=start&&i<end).sort((a,b)=>b-a);
   for(const child of task.subtasks||[]){
    const current=lines[child.line]?.match(/^[ \t]*-[ \t]+\[([ xX])\][ \t]*(.*)$/);
    if(!current || taskDisplayTitle(current[2]||'')!==taskDisplayTitle(child.text) || (current[1]!==' ')!==child.checked) {
     throw new Error('Subtask lines changed during synchronization. Refresh the project.');
    }
   }
   const rewriteChild=(original:string,child:BoardTask['subtasks'][number],identity?:string):string=>{
    const inherited=readTaskMetadata(original);
    const oldBlock=blockIdFromTaskLine(original);
    const oldText=original.replace(/^[ \t]*-[ \t]+\[[ xX]\][ \t]*/,'');
    const title=taskDisplayTitle(child.text);
    const annotations=oldText.match(/(?:⏱️|⏳)[ \t]*[\d:]+|🏷️[ \t]*\[\[Habits\/[^\]]+\]\]|(?:📅|🏁)[ \t]*[\d-]{10}|(?:⏫|🔼|🔽)|(?:^|\s)#[\p{L}\p{M}\p{N}_/-]+|<!-- (?:project-status: [^>]*|github-project-item: [^>]*|project-archived) -->/gu)||[];
    let updated=title===taskDisplayTitle(oldText)?original.replace(/\[([ xX])\]/,child.checked?'[x]':'[ ]'):
     `${original.match(/^[ \t]*/)?.[0]||indent}- [${child.checked?'x':' '}] ${title}${annotations.length?' '+annotations.map(value=>value.trim()).join(' '):''}${oldBlock?' ^'+oldBlock:''}`;
    const metadata={...inherited,id:inherited.id||identity,completedAt:child.checked?
     (/^\s*-[ \t]+\[[xX]\]/.test(original)?inherited.completedAt??null:new Date().toISOString()):null};
    updated=replaceTaskMetadata(updated,metadata);
    return updated;
   };
   if(single){
    // Move each direct child together with its descendants, never just its checkbox.
    const ordered=[...indices].sort((a,b)=>a-b);
    const chunks=ordered.map((line,index)=>({line,id:local[index]?.id,body:lines.slice(line,ordered[index+1]??end),used:false}));
    const matched=subtasks.map(child=>{
     const blockId=blockIdFromTaskLine(`- [ ] ${child.text}`);
     const candidates=chunks.filter(item=>!item.used&&(child.id?item.id===child.id:blockId?
      blockIdFromTaskLine(item.body[0]!)===blockId:taskDisplayTitle(item.body[0]!.replace(/^[ \t]*-[ \t]+\[[ xX]\][ \t]*/,''))===taskDisplayTitle(child.text)));
     if(candidates.length>1)throw new Error('Ambiguous subtask identity. Refresh Companion before editing.');
     const chunk=candidates[0];
     if(chunk)chunk.used=true;
     else if(child.id&&previous.some(old=>old.id===child.id))throw new Error('A subtask changed or was removed locally. Refresh Companion.');
     return {child,chunk};
    });
    if(matched.some(item=>!item.chunk&&(!item.child.id||previous.some(old=>!old.id)))&&chunks.some(chunk=>!chunk.used)) {
     throw new Error('Subtask IDs are missing. Refresh Companion before renaming or replacing subtasks.');
    }
    const result:string[]=[];
    for(const {child,chunk} of matched){
     if(chunk)result.push(rewriteChild(chunk.body[0]!,child,chunk.id),...chunk.body.slice(1));
     else{
      const blockId=newTaskBlockId(content+'\n'+result.join('\n'));
      result.push(replaceTaskMetadata(`${indent}- [${child.checked?'x':' '}] ${taskDisplayTitle(child.text)} ^${blockId}`,
       {id:child.id,completedAt:child.checked?new Date().toISOString():null}));
     }
    }
    const prefix=lines.slice(start,ordered[0]??end);
    lines.splice(start,end-start,...prefix,...result);
    return lines.join('\n');
   }
   // Separate-file tasks retain prose, indentation and persistent child IDs too.
   const available=(task.subtasks||[]).map((old,index)=>({old,id:local[index]?.id,used:false}));
   const updates=new Map<number,string>();
   const added:string[]=[];
   let unknownLegacy=false;
   for(const child of subtasks){
    const candidates=available.filter(item=>!item.used&&(child.id?item.id===child.id:
     taskDisplayTitle(item.old.text)===taskDisplayTitle(child.text)));
    if(candidates.length>1)throw new Error('Ambiguous subtask identity. Refresh Companion.');
    const found=candidates[0];
    if(found){found.used=true;updates.set(found.old.line,rewriteChild(lines[found.old.line]!,child,found.id));}
    else{
     if(child.id&&previous.some(old=>old.id===child.id))throw new Error('A subtask was removed locally. Refresh Companion.');
     if(!child.id)unknownLegacy=true;
     added.push(rewriteChild(`- [ ] ${taskDisplayTitle(child.text)}`,child,child.id||newTaskBlockId(content+'\n'+added.join('\n'))));
    }
   }
   if((unknownLegacy||added.length&&previous.some(old=>!old.id))&&available.some(item=>!item.used))throw new Error('Subtask IDs are missing. Refresh Companion before replacing subtasks.');
   const checkboxLines=new Set(indices);
   const last=Math.max(-1,...indices);
   const insertion=last<0?lines.length:findTaskBlockEnd(lines,last,0);
   const result:string[]=[];
   for(let index=0;index<lines.length;index++){
    if(index===insertion)result.push(...added);
    if(!checkboxLines.has(index))result.push(lines[index]!);
    else if(updates.has(index))result.push(updates.get(index)!);
   }
   if(insertion===lines.length)result.push(...added);
   return result.join('\n');
  });
 }
}
