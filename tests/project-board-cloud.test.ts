import { describe, it, expect, vi } from 'vitest';
import { sendTaskReminders } from '../cloudflare-companion/src/task-reminders';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { boardApi, syncBoard } from '../cloudflare-companion/src/project-board';
import { addHabitValue, finishTimer, startTimer, pauseTimer, resumeTimer, getTimer, setLibraryProgress, cancelTimer } from '../cloudflare-companion/src/db';
import { sessionHistoryApi } from '../cloudflare-companion/src/session-history';
import { dailyTasksApi } from '../cloudflare-companion/src/daily-tasks';
import type { BoardTask } from '../cloudflare-companion/src/project-board';
import type { D1Database, Env, CompanionConfigRow } from '../cloudflare-companion/src/types';
// Shapes of API/JSON.parse answers used by the tests below
interface SessionHistoryItem{id:string,legacy:number,data:{note:string}}
interface SessionHistoryResponse{items:SessionHistoryItem[]}

function database(){
 const sql=new DatabaseSync(':memory:');
 for(const file of readdirSync('cloudflare-companion/migrations').sort())sql.exec(readFileSync(`cloudflare-companion/migrations/${file}`,'utf8'));
 const wrap=(query:string,args:unknown[]=[])=>({bind:(...next:unknown[])=>wrap(query,next),
  first:async()=>sql.prepare(query).get(...args as never[])||null,
  all:async()=>({success:true,results:sql.prepare(query).all(...args as never[])}),
  run:async()=>{const result=sql.prepare(query).run(...args as never[]);return {success:true,meta:{changes:Number(result.changes)}};}});
 let batchChain:Promise<unknown>=Promise.resolve();
 const db={prepare:(q:string)=>wrap(q),batch:(statements:Array<ReturnType<typeof wrap>>)=>{
  const next=batchChain.then(async()=>{sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}});
  batchChain=next.catch(()=>undefined);return next;
 }} as unknown as D1Database;
 return {sql,db};
}
const scopes=[{id:'work',name:'Work',statuses:'Backlog, Doing, Done'}];
const task:BoardTask={key:'work:one',id:'file:Task.md',scopeId:'work',scopeName:'Work',path:'Task.md',name:'Task',status:'Backlog',priority:'',startDate:'',endDate:'',habitName:'Focus',timeSpentSec:0,timeEstimatedSec:0,subtasks:[]};
const config={timezone:'UTC',habits_json:JSON.stringify([{name:'Focus',type:'timer'}])} as CompanionConfigRow;
const request=(body:unknown)=>new Request('https://example.com/app/api/projects',{method:'POST',body:JSON.stringify(body)});
describe('Cloud project board',()=>{
 it('rejects malformed daily task API bodies with a client error',async()=>{
  const {sql,db}=database();
  try{
   for(const body of [null,[],{task:null}])expect((await dailyTasksApi(request(body),{DB:db} as Env,'p',config)).status).toBe(400);
   const invalid=new Request('https://example.com/app/api/tasks',{method:'POST',body:'{'});
   expect((await dailyTasksApi(invalid,{DB:db} as Env,'p',config)).status).toBe(400);
  }finally{sql.close();}
 });
 it('finishes a cloud session exactly once under concurrent requests',async()=>{
  const {sql,db}=database();
  try{
   await startTimer(db,'p','Focus',null,'12:00');
   sql.prepare('UPDATE active_timers SET started_at=?').run(Date.now()-60000);
   const results=await Promise.all([finishTimer(db,'p','2026-10-04','12:01'),finishTimer(db,'p','2026-10-04','12:01')]);
   expect(results.filter(Boolean)).toHaveLength(1);
   expect(sql.prepare('SELECT value FROM habit_values').get()!.value).toBe(60);
   expect(sql.prepare('SELECT * FROM session_history').all()).toHaveLength(1);
   expect(sql.prepare('SELECT * FROM companion_events').all()).toHaveLength(1);
   const history:unknown=JSON.parse(String(sql.prepare('SELECT data_json FROM session_history').get()!.data_json));
   expect(history).toMatchObject({date:'2026-10-04',endTime:'12:01'});
  }finally{sql.close();}
 });
 it('clamps an atomic count decrement to zero',async()=>{
  const {sql,db}=database();
  try{
   await addHabitValue(db,'p','Count','2026-10-04',5,'add_count');
   await addHabitValue(db,'p','Count','2026-10-04',-8,'add_count');
   expect(sql.prepare('SELECT value FROM habit_values').get()!.value).toBe(0);
  }finally{sql.close();}
 });
 it('preserves both concurrent habit increments',async()=>{
  const {sql,db}=database();
  try{
   await Promise.all([addHabitValue(db,'p','Focus','2026-10-04',30,'add_timer'),addHabitValue(db,'p','Focus','2026-10-04',60,'add_timer')]);
   expect(sql.prepare('SELECT value FROM habit_values').get()!.value).toBe(90);
  }finally{sql.close();}
 });
 it('accepts exactly one concurrent timer start without a database exception',async()=>{
  const {sql,db}=database();
  try{expect(await Promise.all([startTimer(db,'p','Focus',null,'12:00'),startTimer(db,'p','Focus',null,'12:00')])).toEqual([true,false]);}
  finally{sql.close();}
 });
 it('does not reset elapsed time when a running cloud timer is resumed again',async()=>{
  const {sql,db}=database();
  try{
   await startTimer(db,'p','Focus',null,'12:00');
   sql.prepare('UPDATE active_timers SET started_at=?').run(Date.now()-60000);
   const before=(await getTimer(db,'p'))!.started_at;
   await resumeTimer(db,'p');expect((await getTimer(db,'p'))!.started_at).toBe(before);
  }finally{sql.close();}
 });
 it('retains the active timer if recording completion fails, and retries without duplicates',async()=>{
  const {sql,db}=database();
  try{
   await startTimer(db,'p','Focus',null,'12:00');
   sql.prepare('UPDATE active_timers SET started_at=?').run(Date.now()-60000);
   sql.exec("CREATE TRIGGER fail_event BEFORE INSERT ON companion_events BEGIN SELECT RAISE(ABORT,'write failed'); END");
   await expect(finishTimer(db,'p','2026-10-04','12:01')).rejects.toThrow('write failed');
   expect(await getTimer(db,'p')).not.toBeNull();
   expect(sql.prepare('SELECT * FROM session_history').all()).toHaveLength(0);
   expect(sql.prepare('SELECT * FROM habit_values').all()).toHaveLength(0);
   sql.exec('DROP TRIGGER fail_event');
   expect(await finishTimer(db,'p','2026-10-04','12:01')).not.toBeNull();
   expect(await finishTimer(db,'p','2026-10-04','12:01')).toBeNull();
   expect(sql.prepare('SELECT * FROM session_history').all()).toHaveLength(1);
  }finally{sql.close();}
 });
 it('sends a scheduled task reminder once across cron retries',async()=>{
  const {sql,db}=database();const task={id:crypto.randomUUID(),name:'Reminder',date:'2026-09-08',done:false,reminderTime:'10:00'};
  sql.prepare('INSERT INTO daily_tasks VALUES(?,?,?,?)').run('p',task.id,1,JSON.stringify(task));
  const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({ok:true}));
  try{await sendTaskReminders({DB:db} as Env,'p',config,Date.parse('2026-09-08T10:01:00Z'));await sendTaskReminders({DB:db} as Env,'p',config,Date.parse('2026-09-08T10:02:00Z'));expect(fetcher).toHaveBeenCalledTimes(1);}finally{fetcher.mockRestore();sql.close();}
 });
 it('manages independent daily tasks with revisions, idempotency and a dedicated timer event',async()=>{
  const {sql,db}=database(),env={DB:db} as Env;
  const task={id:crypto.randomUUID(),name:'Daily task',date:'2026-09-07',deadline:'',priority:'',done:false,deleted:false,habitName:'Focus',subtasks:[],revision:0};
  const body={task,requestId:crypto.randomUUID()};
  expect((await dailyTasksApi(request(body),env,'p',config)).status).toBe(200);
  expect((await dailyTasksApi(request(body),env,'p',config)).status).toBe(200);
  expect(sql.prepare('SELECT * FROM companion_events').all()).toHaveLength(1);
  expect((await dailyTasksApi(request({...body,requestId:crypto.randomUUID()}),env,'p',config)).status).toBe(409);
  expect((await dailyTasksApi(request({action:'start',id:task.id}),env,'p',config)).status).toBe(200);
  expect((await dailyTasksApi(request({task:{...task,revision:1,deleted:true},requestId:crypto.randomUUID(),confirm:true}),env,'p',config)).status).toBe(409);
  await finishTimer(db,'p','2026-09-07','12:01');
  expect(sql.prepare("SELECT * FROM companion_events WHERE event_type='daily_task_session'").all()).toHaveLength(1);
  expect(sql.prepare("SELECT * FROM companion_events WHERE event_type IN ('project_timer','add_timer')").all()).toHaveLength(0);
  sql.close();
 });
 it('lists legacy records once alongside new sessions and retains original start through pauses',async()=>{
  const {sql,db}=database();
  sql.prepare("INSERT INTO companion_events(event_id,profile_id,event_type,habit_name,habit_date,amount,payload_json,created_at) VALUES('old','p','add_timer','Focus','2026-09-05',30,?,?)")
   .run(JSON.stringify({startTime:'10:00',endTime:'10:01'}),Date.now()-86400000);
  await startTimer(db,'p','Focus',null,'12:00');const original=(await getTimer(db,'p'))!.original_started_at;
  await pauseTimer(db,'p');await resumeTimer(db,'p');expect((await getTimer(db,'p'))!.original_started_at).toBe(original);
  const finished=await finishTimer(db,'p','2026-09-06','12:01',false,'Worked on prototype');
  const response=await sessionHistoryApi(new Request('https://example.com/app/api/sessions'),{DB:db} as Env,'p');
  const history=await response.json() as SessionHistoryResponse;expect(history.items).toHaveLength(2);expect(history.items.find((s:{id:string})=>s.id===finished!.sessionId).data.note).toBe('Worked on prototype');
  expect(history.items.filter((s:{legacy:number})=>s.legacy)).toHaveLength(1);sql.close();
 });
 it('records a media result once and rejects attribution to another work',async()=>{
  const {sql,db}=database();
  sql.exec("INSERT INTO library_items(profile_id,item_path,title,collection_id,updated_at) VALUES('p','Book.md','Book','book',0),('p','Other.md','Other','book',0)");
  const id=Number(sql.prepare("SELECT id FROM library_items WHERE title='Book'").get()!.id),other=Number(sql.prepare("SELECT id FROM library_items WHERE title='Other'").get()!.id);
  await startTimer(db,'p','Focus',null,'12:00',id);const finished=await finishTimer(db,'p','2026-09-06','12:01');
  await setLibraryProgress(db,'p',id,10,'2026-09-07',{sessionId:finished!.sessionId,note:'Chapter one'});
  await setLibraryProgress(db,'p',id,20,'2026-09-07',{sessionId:finished!.sessionId});
  expect(sql.prepare('SELECT progress FROM library_items WHERE id=?').get(id)!.progress).toBe(10);
  const result=JSON.parse(sql.prepare('SELECT result_json FROM session_history').get()!.result_json as string) as {delta:number,note:string};expect(result.delta).toBe(10);expect(result.note).toBe('Chapter one');
  await expect(setLibraryProgress(db,'p',other,5,'2026-09-07',{sessionId:finished!.sessionId})).rejects.toThrow('session_media_mismatch');sql.close();
 });
 it('keeps cancelled sessions in history without crediting the habit',async()=>{
  const {sql,db}=database();await startTimer(db,'p','Focus',null,'12:00');await cancelTimer(db,'p');
  expect(sql.prepare('SELECT status FROM session_history').get()!.status).toBe('cancelled');expect(sql.prepare('SELECT * FROM habit_values').all()).toHaveLength(0);sql.close();
 });
 it('keeps pending remote edits across stale snapshots and rejects stale revisions',async()=>{
  const {sql,db}=database();await syncBoard(db,'p',[task],scopes);const env={DB:db} as Env;
  const change={action:'save',key:task.key,revision:0,requestId:crypto.randomUUID(),task:{...task,status:'Doing',subtasks:[{text:'Step',checked:true}]}};
  expect((await boardApi(request(change),env,'p',config)).status).toBe(200);
  await syncBoard(db,'p',[task],scopes);
  let row=sql.prepare('SELECT * FROM project_documents').get()!;
  expect((JSON.parse(row.data_json as string) as {status:string}).status).toBe('Doing');
  expect((await boardApi(request({...change,requestId:crypto.randomUUID()}),env,'p',config)).status).toBe(409);
  expect((await boardApi(request(change),env,'p',config)).status).toBe(200);
  expect(sql.prepare('SELECT count(*) AS n FROM companion_events').get()!.n).toBe(1);
  sql.exec('UPDATE companion_events SET acknowledged_at=1');
  await syncBoard(db,'p',[{...task,status:'Doing'}],scopes);
  row=sql.prepare('SELECT * FROM project_documents').get()!;expect(row.pending).toBe(0);
  sql.close();
 });
 it('requires delete confirmation and keeps a tombstone until Obsidian applies it',async()=>{
  const {sql,db}=database();await syncBoard(db,'p',[task],scopes);const env={DB:db} as Env;
  const remove={action:'delete',key:task.key,revision:0,requestId:crypto.randomUUID()};
  expect((await boardApi(request(remove),env,'p',config)).status).toBe(400);
  expect((await boardApi(request({...remove,confirm:true}),env,'p',config)).status).toBe(200);
  await syncBoard(db,'p',[task],scopes);expect(sql.prepare('SELECT deleted FROM project_documents').get()!.deleted).toBe(1);
  sql.exec('UPDATE companion_events SET acknowledged_at=1');await syncBoard(db,'p',[],scopes);
  expect(sql.prepare('SELECT * FROM project_documents').all()).toHaveLength(0);sql.close();
 });
 it('creates tasks once, validates dates and rejects duplicate names',async()=>{
  const {sql,db}=database();await syncBoard(db,'p',[],scopes);const env={DB:db} as Env;
  const create={action:'create',requestId:crypto.randomUUID(),task};
  expect((await boardApi(request({...create,task:{...task,endDate:'2026-02-31'}}),env,'p',config)).status).toBe(400);
  expect((await boardApi(request(create),env,'p',config)).status).toBe(200);
  expect((await boardApi(request(create),env,'p',config)).status).toBe(200);
  expect((await boardApi(request({...create,requestId:crypto.randomUUID()}),env,'p',config)).status).toBe(409);
  expect(sql.prepare('SELECT * FROM project_documents').all()).toHaveLength(1);sql.close();
 });
 it('attributes timer completion to the task and the associated habit',async()=>{
  const {sql,db}=database();await syncBoard(db,'p',[task],scopes);const env={DB:db} as Env;
  expect((await boardApi(request({action:'start',key:task.key}),env,'p',config)).status).toBe(200);
  sql.prepare('UPDATE active_timers SET started_at=?').run(Date.now()-65000);
  const result=await finishTimer(db,'p','2026-09-06','12:00');expect(result!.elapsed).toBeGreaterThanOrEqual(65);
  expect((JSON.parse(sql.prepare('SELECT data_json FROM project_documents').get()!.data_json as string) as {timeSpentSec:number}).timeSpentSec).toBe(result!.elapsed);
  expect(sql.prepare('SELECT value FROM habit_values').get()!.value).toBe(result!.elapsed);
  expect(sql.prepare("SELECT * FROM companion_events WHERE event_type='project_timer'").all()).toHaveLength(1);sql.close();
 });
});
