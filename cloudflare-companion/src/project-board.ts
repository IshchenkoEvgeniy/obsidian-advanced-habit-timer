import type { D1Database, Env, CompanionConfigRow } from './types';
import { getTimer, parseHabits, startTimer } from './db';
import { zonedParts } from './time';

export interface BoardTask {
 key: string; scopeId: string; scopeName: string; path: string; id?: string; blockId?: string;
 name: string; status: string; priority: string; startDate: string; endDate: string;
 habitName: string; timeSpentSec: number; timeEstimatedSec: number;
 subtasks: Array<{text: string; checked: boolean}>;
}
export interface BoardScope { id: string; name: string; statuses: string; sourceType?: string; }
interface DocumentRow { data_json: string; revision: number; pending: number; deleted: number; }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function syncBoard(db: D1Database, profile: string, tasks: BoardTask[], scopes: BoardScope[]): Promise<void> {
 const token = crypto.randomUUID();
 const statements = [db.prepare('INSERT INTO project_scopes VALUES (?, ?) ON CONFLICT(profile_id) DO UPDATE SET data_json=excluded.data_json').bind(profile, JSON.stringify(scopes))];
 for (const task of tasks) statements.push(db.prepare(`INSERT INTO project_documents (profile_id,task_key,data_json,sync_token) VALUES(?,?,?,?)
 ON CONFLICT(profile_id,task_key) DO UPDATE SET data_json=excluded.data_json,sync_token=excluded.sync_token,revision=project_documents.revision+CASE WHEN data_json<>excluded.data_json THEN 1 ELSE 0 END,pending=0,deleted=0
 WHERE NOT EXISTS (SELECT 1 FROM companion_events WHERE profile_id=? AND habit_name=? AND event_type IN ('project_change','project_timer') AND acknowledged_at IS NULL)`)
 .bind(profile,task.key,JSON.stringify(task),token,profile,task.key));
 statements.push(db.prepare(`DELETE FROM project_documents WHERE profile_id=? AND sync_token<>? AND NOT EXISTS
 (SELECT 1 FROM companion_events WHERE profile_id=? AND habit_name=project_documents.task_key AND event_type IN ('project_change','project_timer') AND acknowledged_at IS NULL)`)
 .bind(profile,token,profile));
 for(let i=0;i<statements.length;i+=60)await db.batch(statements.slice(i,i+60));
}
async function scopesFor(db:D1Database,profile:string):Promise<BoardScope[]> {
 const row=await db.prepare('SELECT data_json FROM project_scopes WHERE profile_id=?').bind(profile).first<{data_json:string}>();
 return row?JSON.parse(row.data_json):[];
}
export async function boardApi(request:Request,env:Env,profile:string,config:CompanionConfigRow):Promise<Response>{
 const scopes=await scopesFor(env.DB,profile);
 if(request.method==='GET'){
  const rows=await env.DB.prepare('SELECT * FROM project_documents WHERE profile_id=? AND deleted=0').bind(profile).all<DocumentRow>();
  return json({scopes,tasks:(rows.results||[]).map(r=>({...JSON.parse(r.data_json),revision:r.revision,pending:!!r.pending}))});
 }
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);
 const body=await request.json() as Record<string,unknown>;
 const action=String(body.action||'');
 const key=typeof body.key==='string'?body.key:'';
 const row=key?await env.DB.prepare('SELECT * FROM project_documents WHERE profile_id=? AND task_key=?').bind(profile,key).first<DocumentRow>():null;
 const previous:BoardTask|null=row?JSON.parse(row.data_json):null;
 if(action==='start'){
  if(!previous||row?.deleted)return json({error:'task_not_found'},404);
  const habit=parseHabits(config).find(h=>h.name===previous.habitName&&(h.type||'timer')==='timer');
  if(!habit)return json({error:'task_habit_required'},400);
  const {time}=zonedParts(Date.now(),config.timezone);
  if(!await startTimer(env.DB,profile,habit.name,null,time,null,JSON.stringify(previous)))return json({error:'timer_exists'},409);
  return json({ok:true});
 }
 const requestId=String(body.requestId||'');
 if(!/^[a-f0-9-]{36}$/i.test(requestId))return json({error:'invalid_request'},400);
 const eventId=`board:${profile}:${requestId}`;
 if(await env.DB.prepare('SELECT sequence FROM companion_events WHERE event_id=?').bind(eventId).first())return json({ok:true});
 if(!['save','delete','create'].includes(action))return json({error:'invalid_action'},400);
 if(action!=='create'&&(!previous||row?.deleted))return json({error:'task_not_found'},404);
 if(previous&&body.revision!==row?.revision)return json({error:'task_conflict'},409);
 if(action==='delete'&&body.confirm!==true)return json({error:'confirmation_required'},400);
 if(action==='delete'){
  const timer=await getTimer(env.DB,profile);
  if(timer?.task_json&&JSON.parse(timer.task_json).key===key)return json({error:'task_timer_running'},409);
 }
 const raw=(body.task||{}) as Record<string,unknown>;
 const scope=scopes.find(s=>s.id===(previous?.scopeId||raw.scopeId));
 if(!scope)return json({error:'scope_not_found'},400);
 const clean=(v:unknown,max=250)=>typeof v==='string'?v.trim().slice(0,max):'';
 const task:BoardTask= action==='delete'?previous!:{
  ...(previous||{}),key:previous?.key||`cloud:${requestId}`,scopeId:scope.id,scopeName:scope.name,path:previous?.path||'',
  name:clean(raw.name),status:clean(raw.status,100),priority:clean(raw.priority,20),startDate:clean(raw.startDate,10),endDate:clean(raw.endDate,10),
  habitName:clean(raw.habitName,150),timeSpentSec:previous?.timeSpentSec||0,timeEstimatedSec:Number(raw.timeEstimatedSec)||0,
  subtasks:Array.isArray(raw.subtasks)?raw.subtasks.slice(0,100).map((s:{text?:unknown;checked?:unknown})=>({text:clean(s.text),checked:s.checked===true})):[]
 };
 const columns=scope.statuses.split(',').map(s=>s.trim()).filter(Boolean);
 if(action==='create'){
  const names=await env.DB.prepare('SELECT data_json FROM project_documents WHERE profile_id=? AND deleted=0').bind(profile).all<{data_json:string}>();
  if((names.results||[]).some(r=>{const t:BoardTask=JSON.parse(r.data_json);return t.scopeId===scope.id&&t.name.toLocaleLowerCase()===task.name.toLocaleLowerCase();}))return json({error:'task_duplicate'},409);
 }
 const validDate=(date:string)=>!date||(/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date);
 if(!task.name||/[\r\n\\/:*?"<>|]/.test(task.name)||!columns.includes(task.status)||!validDate(task.startDate)||!validDate(task.endDate)
 ||(task.startDate&&task.endDate&&task.startDate>task.endDate)||task.subtasks.some(s=>!s.text||/[\r\n]/.test(s.text))
 ||task.timeEstimatedSec<0||task.timeEstimatedSec>31536000)return json({error:'invalid_task'},400);
 if(task.habitName&&!parseHabits(config).some(h=>h.name===task.habitName&&(h.type||'timer')==='timer'))return json({error:'task_habit_required'},400);
 const {date}=zonedParts(Date.now(),config.timezone);
 const payload={action,task,previous};
 // The optimistic revision and event insertion are committed together in one D1 batch.
 const mutation=previous?env.DB.prepare(`UPDATE project_documents SET data_json=?,revision=revision+1,pending=1,deleted=? WHERE profile_id=? AND task_key=? AND revision=?`)
 .bind(JSON.stringify(task),action==='delete'?1:0,profile,task.key,row!.revision):env.DB.prepare(`INSERT OR IGNORE INTO project_documents(profile_id,task_key,data_json,revision,pending) VALUES(?,?,?,1,1)`)
 .bind(profile,task.key,JSON.stringify(task));
 const results=await env.DB.batch([mutation,env.DB.prepare(`INSERT OR IGNORE INTO companion_events(event_id,profile_id,event_type,habit_name,habit_date,payload_json,created_at)
 SELECT ?,?,'project_change',?,?,?,? WHERE changes()>0`).bind(eventId,profile,task.key,date,JSON.stringify(payload),Date.now())]);
 if(!results.every(r=>r.success))return json({error:'save_failed'},500);
 if(!await env.DB.prepare('SELECT sequence FROM companion_events WHERE event_id=?').bind(eventId).first())return json({error:'task_conflict'},409);
 return json({ok:true});
}

export async function recordProjectTime(db:D1Database,profile:string,task:BoardTask,seconds:number,date:string):Promise<void>{
 const row=await db.prepare('SELECT data_json FROM project_documents WHERE profile_id=? AND task_key=? AND deleted=0').bind(profile,task.key).first<{data_json:string}>();
 const current:BoardTask=row?JSON.parse(row.data_json):task;
 const next={...current,timeSpentSec:current.timeSpentSec+seconds};
 await db.batch([
 db.prepare('UPDATE project_documents SET data_json=?,revision=revision+1,pending=1 WHERE profile_id=? AND task_key=?').bind(JSON.stringify(next),profile,task.key),
 db.prepare(`INSERT INTO companion_events(event_id,profile_id,event_type,habit_name,habit_date,payload_json,created_at) VALUES(?,?,'project_timer',?,?,?,?)`)
 .bind(crypto.randomUUID(),profile,task.key,date,JSON.stringify({task:current,seconds}),Date.now())]);
}
