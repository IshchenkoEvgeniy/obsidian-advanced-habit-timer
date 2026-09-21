import { TFile } from 'obsidian';
import type HabitTimerPlugin from '../main';
import type { BoardTask } from '../../cloudflare-companion/src/project-board';
import { projectTaskToData } from '../projects/task-data';
import { projectTaskId } from '../projects/types';
import type { ProjectTask } from '../projects/types';
import { findTaskBlockEnd } from '../projects/engine/task-block';
import { parseDuration } from '../utils';

export class CloudflareProjectService {
 constructor(private plugin:HabitTimerPlugin){}
 async snapshot():Promise<BoardTask[]>{
  const items:BoardTask[]=[];
  const keys=this.plugin.settings.cloudflareProjectKeys||{};
  for(const scope of this.plugin.settings.projectScopes){
   const tasks=await this.plugin.projectEngine.loadTasks(scope);
   for(const task of tasks){
    const identity=`${scope.id}:${task.id}`;
    const key=Object.keys(keys).find(k=>keys[k]===identity)||identity;
    items.push({key,scopeId:scope.id,scopeName:scope.name,path:task.file.path,id:task.id,blockId:task.blockId,
     name:task.name,status:task.status,priority:task.priority||'',startDate:task.startDate||'',endDate:task.endDate||'',habitName:task.habitName||'',
     timeSpentSec:task.timeSpentSec||0,timeEstimatedSec:task.timeEstimatedSec||0,subtasks:(task.subtasks||[]).map(s=>({text:s.text,checked:s.checked}))});
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
   task=tasks.find(t=>t.name===incoming.name);
   const marker=`<!-- cloud-project:${incoming.key} -->`;
   if(task&&!(await this.plugin.app.vault.read(task.file)).includes(marker))throw new Error('A local task with this name already exists');
   if(!task){
    const source=this.plugin.app.vault.getAbstractFileByPath(scope.sourceValue);
    if(single&&!(source instanceof TFile))throw new Error('Project source file missing');
    await engine.createTask(scope,{name:incoming.name,status:incoming.status,priority:incoming.priority,habitName:incoming.habitName,
     startDate:incoming.startDate,endDate:incoming.endDate,timeEstimated:this.plugin.formatTime(incoming.timeEstimatedSec)});
    const folder=scope.sourceType==='folder'?scope.sourceValue:(scope.targetFolder||'');
    const created=this.plugin.app.vault.getAbstractFileByPath(single?scope.sourceValue:`${folder?folder.replace(/\/$/,'')+'/':''}${incoming.name}.md`);
    if(created instanceof TFile)await this.plugin.app.vault.process(created,c=>c.includes(marker)?c:`${c.trimEnd()}\n\n${marker}\n`);
    for(const file of this.plugin.app.vault.getMarkdownFiles())engine.invalidateCacheEntry(file.path);
    tasks=await engine.loadTasks(scope);
    task=tasks.find(t=>t.name===incoming.name);
   }
  }
  if(!task){if(payload.action==='delete')return;throw new Error(`Project task not found: ${previous.name}`);}
  if(payload.action==='delete'){await engine.deleteTask(task,single);delete keys[incoming.key];return;}
  if(timer){
   const seconds=Math.max(0,Math.round(payload.seconds||0));
   if(single){
    await this.plugin.app.vault.process(task.file,content=>{
     const lines=content.split('\n');
     const index=task!.blockId?lines.findIndex(line=>line.trimEnd().endsWith(` ^${task!.blockId}`)):task!.sourceLine??-1;
     if(index<0||!lines[index])throw new Error('Task block missing');
     const current=lines[index]!.match(/⏱️\s*(\d+:\d+(?::\d+)?)/)?.[1]||'00:00:00';
     const tag=`⏱️ ${this.plugin.formatTime(parseDuration(current)+seconds)}`;
     lines[index]=/⏱️\s*\d+:\d+(?::\d+)?/.test(lines[index]!)?lines[index]!.replace(/⏱️\s*\d+:\d+(?::\d+)?/,tag):lines[index]!.replace(/(\s+\^[\w-]+)?$/,` ${tag}$1`);
     return lines.join('\n');
    });
   }else await this.plugin.app.fileManager.processFrontMatter(task.file,fm=>{fm.time_spent=this.plugin.formatTime(parseDuration(fm.time_spent||'00:00:00')+seconds);});
  }else{
   if(!single&&incoming.name!==task.name){
    const destination=`${task.file.parent?.path}/${incoming.name}.md`;
    if(this.plugin.app.vault.getAbstractFileByPath(destination))throw new Error('A task with this filename already exists');
   }
   await this.replaceSubtasks(task,incoming.subtasks,single);
   const data=projectTaskToData(task,v=>this.plugin.formatTime(v),{name:incoming.name,status:incoming.status,priority:incoming.priority,habitName:incoming.habitName,
    startDate:incoming.startDate,endDate:incoming.endDate,timeEstimated:incoming.timeEstimatedSec?this.plugin.formatTime(incoming.timeEstimatedSec):''});
   await engine.saveTask(task.file,data,single,task.name,scope.statuses.split(',').map(s=>s.trim()),task.blockId);
  }
  keys[incoming.key]=`${scope.id}:${projectTaskId(task.file.path,task.sourceLine,task.blockId)}`;
  engine.invalidateCacheEntry(task.file.path);
  await this.plugin.saveSettings();
 }
 private async replaceSubtasks(task:ProjectTask,subtasks:BoardTask['subtasks'],single:boolean):Promise<void>{
  await this.plugin.app.vault.process(task.file,content=>{
   const lines=content.split('\n');
   let start=0,end=lines.length,indent='';
   if(single){
    start=task.blockId?lines.findIndex(line=>line.trimEnd().endsWith(` ^${task.blockId}`)):task.sourceLine??-1;
    if(start<0)throw new Error('Task block missing');
    const parentIndent=lines[start]!.match(/^\s*/)?.[0]||'';
    end=findTaskBlockEnd(lines,start,parentIndent.length);indent=parentIndent+'  ';start++;
   }
   const indices=(task.subtasks||[]).map(s=>s.line).filter(i=>i>=start&&i<end).sort((a,b)=>b-a);
   for(const i of indices)lines.splice(i,1);
   const insertion=single?start:Math.min(task.subtasks?.[0]?.line??lines.length,lines.length);
   lines.splice(insertion,0,...subtasks.map(s=>`${indent}- [${s.checked?'x':' '}] ${s.text}`));
   return lines.join('\n');
  });
 }
}
