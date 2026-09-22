import type { Env, CompanionConfigRow } from './types';
import { validTask, type DailyTask } from '../../src/tasks/model';
import { zonedParts } from './time';
import { startTimer, parseHabits, getTimer } from './db';
import { completeTask } from '../../src/tasks/planning';
import { reconcileHabitTasks } from './habit-tasks';

export async function dailyTasksApi(request: Request, env: Env, profile: string, config: CompanionConfigRow): Promise<Response> {
 const json = (v: unknown, status = 200) => Response.json(v, {status, headers:{'Cache-Control':'no-store'}});
 if (request.method === 'GET') {
  await reconcileHabitTasks(env,profile,config);
  const rows = await env.DB.prepare('SELECT data_json FROM daily_tasks WHERE profile_id=?').bind(profile).all<{data_json:string}>();
  return json({tasks:(rows.results||[]).map(r=>JSON.parse(r.data_json) as DailyTask)});
 }
 if(request.method!=='POST') return json({error:'method_not_allowed'},405);
 const body=await request.json() as {task:DailyTask;requestId:string;confirm?:boolean;action?:string;id?:string};
 if(body.action==='start') {
  const row=await env.DB.prepare('SELECT data_json FROM daily_tasks WHERE profile_id=? AND id=?').bind(profile,body.id||'').first<{data_json:string}>();
  const task:DailyTask|undefined=row?JSON.parse(row.data_json) as DailyTask:undefined;
  if(!task||task.deleted||task.done)return json({error:'task_not_found'},404);
  if(task.habitName&&!parseHabits(config).some(h=>h.name===task.habitName&&(h.type||'timer')==='timer'))return json({error:'task_habit_required'},400);
  const {time}=zonedParts(Date.now(),config.timezone);
  return await startTimer(env.DB,profile,task.habitName||'Задания',null,time,null,JSON.stringify({...task,key:task.id,kind:'daily'}))?json({ok:true}):json({error:'timer_exists'},409);
 }
 if(!body.task || !validTask(body.task) || !/^[a-f0-9-]{36}$/i.test(body.requestId)) return json({error:'invalid_task'},400);
 if(body.task.deleted && body.confirm!==true) return json({error:'confirmation_required'},400);
 if(body.task.deleted) {
  const timer=await getTimer(env.DB,profile);
  if(timer?.task_json&&(JSON.parse(timer.task_json) as {id?:string}).id===body.task.id)return json({error:'task_timer_running'},409);
 }
 if(await env.DB.prepare('SELECT id FROM daily_task_requests WHERE profile_id=? AND id=?').bind(profile,body.requestId).first()) return json({ok:true});
 const row=await env.DB.prepare('SELECT data_json,revision FROM daily_tasks WHERE profile_id=? AND id=?').bind(profile,body.task.id).first<{data_json:string;revision:number}>();
 if((row?.revision||0)!==body.task.revision) return json({error:'task_conflict',remote:row?JSON.parse(row.data_json) as DailyTask:null},409);
 const task=completeTask({...body.task,revision:body.task.revision+1},row?JSON.parse(row.data_json) as DailyTask:undefined,zonedParts(Date.now(),config.timezone).date,body.requestId);
 const mutation=row?env.DB.prepare('UPDATE daily_tasks SET data_json=?,revision=? WHERE profile_id=? AND id=? AND revision=?').bind(JSON.stringify(task),task.revision,profile,task.id,body.task.revision):env.DB.prepare('INSERT OR IGNORE INTO daily_tasks VALUES(?,?,?,?)').bind(profile,task.id,task.revision,JSON.stringify(task));
 const {date}=zonedParts(Date.now(),config.timezone);
 await env.DB.batch([mutation,
  env.DB.prepare('INSERT OR IGNORE INTO daily_task_requests SELECT ?,? WHERE changes()>0').bind(profile,body.requestId),
  env.DB.prepare("INSERT OR IGNORE INTO companion_events(event_id,profile_id,event_type,habit_name,habit_date,payload_json,created_at) SELECT ?,?,'daily_task',?,?,?,? WHERE changes()>0").bind(`daily:${profile}:${body.requestId}`,profile,task.id,date,JSON.stringify({task,previous:row?JSON.parse(row.data_json) as DailyTask:null,requestId:body.requestId}),Date.now())]);
 const accepted=await env.DB.prepare('SELECT id FROM daily_task_requests WHERE profile_id=? AND id=?').bind(profile,body.requestId).first();
 return accepted?json({ok:true,task}):json({error:'task_conflict'},409);
}
