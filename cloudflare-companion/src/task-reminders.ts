import type {Env,CompanionConfigRow} from './types';
import type {DailyTask} from '../../src/tasks/model';
import {shiftDate,occurrenceDates} from '../../src/tasks/planning';
import {zonedParts} from './time';
import {dailyTasksApi} from './daily-tasks';
const appUrl='https://habit-timer-companion.ghjcnj1122.workers.dev/app';
async function message(env:Env,config:CompanionConfigRow,text:string,markup?:unknown){
 const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:config.chat_id,text,reply_markup:markup})});
 const body=await r.json() as {ok?:boolean};if(!r.ok||!body.ok)throw new Error('Task reminder delivery failed');
}
export async function sendTaskReminders(env:Env,profile:string,config:CompanionConfigRow,now:number){
 const local=zonedParts(now,config.timezone);
 const rows=await env.DB.prepare('SELECT data_json FROM daily_tasks WHERE profile_id=?').bind(profile).all<{data_json:string}>();
 for(const row of rows.results||[]){
  const task=JSON.parse(row.data_json) as DailyTask;
  if(task.done||task.deleted||task.status==='cancelled'||!occurrenceDates(task,local.date,local.date).length||!task.reminderTime||task.reminderTime>local.time)continue;
  const occurrence=local.date+'T'+task.reminderTime;
  const claim=await env.DB.prepare(`INSERT INTO task_reminders(profile_id,task_id,occurrence,lease_until) VALUES(?,?,?,?) ON CONFLICT(profile_id,task_id,occurrence) DO UPDATE SET lease_until=excluded.lease_until WHERE sent_at IS NULL AND lease_until<? RETURNING task_id`).bind(profile,task.id,occurrence,now+300000,now).first();
  if(!claim)continue;
  await message(env,config,`Напоминание: ${task.name}\n${local.date} · ${task.reminderTime}`,{inline_keyboard:[[{text:'Через час',callback_data:`dts:hour:${task.id}`},{text:'Завтра',callback_data:`dts:tomorrow:${task.id}`}],[{text:'Выбрать дату',web_app:{url:`${appUrl}?task=${task.id}`}}]]});
  await env.DB.prepare('UPDATE task_reminders SET sent_at=? WHERE profile_id=? AND task_id=? AND occurrence=?').bind(now,profile,task.id,occurrence).run();
 }
}
export async function snoozeTask(env:Env,profile:string,config:CompanionConfigRow,data:string){
 const [,mode,id]=data.split(':');
 if(!['hour','tomorrow'].includes(mode||''))return;
 const row=await env.DB.prepare('SELECT data_json FROM daily_tasks WHERE profile_id=? AND id=?').bind(profile,id||'').first<{data_json:string}>();if(!row)return;
 const task:DailyTask=JSON.parse(row.data_json) as DailyTask;if(task.deleted||task.done)return;
 const local=zonedParts(Date.now()+(mode==='hour'?3600000:0),config.timezone);
 const updated={...task,date:mode==='hour'?local.date:shiftDate(local.date,1),reminderTime:mode==='hour'?local.time:task.reminderTime||'09:00'};
 const response=await dailyTasksApi(new Request('https://internal/tasks',{method:'POST',body:JSON.stringify({task:updated,requestId:crypto.randomUUID()})}),env,profile,config);
 await message(env,config,response.ok?`Перенесено: ${task.name}\n${updated.date} · ${updated.reminderTime}`:'Задание изменилось. Откройте карточку и повторите перенос.');
}
