import type { DailyTask } from './model';
export const taskStatuses = {planned:'Запланировано',active:'В работе',waiting:'Ожидает',completed:'Выполнено',cancelled:'Отменено'};
export type TaskStatus=keyof typeof taskStatuses;
/** Legacy timetable entries and generated habits stay on their scheduled date. */
export function taskCarriesOver(task:DailyTask):boolean {
 if(task.carryOver!==undefined)return task.carryOver;
 return !task.autoHabitId&&!task.repeat&&!task.description?.includes('student-time-table.xls')
  &&!(task.startTime&&task.tags?.some(t=>/^(университет|університет)$/i.test(t)));
}
export function taskIsOverdue(task:DailyTask,today:string):boolean {
 return !task.done&&!task.deleted&&task.status!=='cancelled'&&taskCarriesOver(task)
  &&(!!task.date&&task.date<today||!!task.deadline&&task.deadline<today);
}
export function taskIsMissed(task:DailyTask,today:string):boolean {
 return !task.done&&!task.deleted&&task.status!=='cancelled'&&!taskCarriesOver(task)&&!!task.date&&task.date<today
  &&!task.repeat;
}
export interface TaskRepeat { kind:'daily'|'weekdays'|'monthly'|'after'; interval?:number; weekdays?:number[]; day?:number; }
export interface TaskCompletion { id:string; date:string; plannedDate:string; name:string; subtasks:DailyTask['subtasks']; startTime?:string; endTime?:string; }
export function shiftDate(date:string,days:number):string {const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
/** Bounded calendar projection; deliberately self-contained for the Mini App. */
export function occurrenceDates(task:DailyTask,from:string,to:string):string[] {
 if(task.deleted||task.done||task.status==='cancelled'||from>to)return [];
 if(!task.repeat||task.repeat.kind==='after')return task.date&&task.date>=from&&task.date<=to?[task.date]:[];
 const anchor=task.date||task.noteDate||from;
 const cursor=new Date(`${from>anchor?from:anchor}T12:00:00Z`);
 const dates:string[]=[];
 for(let n=0;n<3660&&Number.isFinite(cursor.getTime());n++,cursor.setUTCDate(cursor.getUTCDate()+1)){
  const date=cursor.toISOString().slice(0,10);if(date>to)break;
  if(task.history?.some(h=>h.plannedDate===date))continue;
  const repeat=task.repeat;
  const last=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,0)).getUTCDate();
  if(repeat.kind==='daily'||repeat.kind==='weekdays'&&repeat.weekdays?.includes(cursor.getUTCDay())
   ||repeat.kind==='monthly'&&cursor.getUTCDate()===Math.min(repeat.day||Number(anchor.slice(8)),last))dates.push(date);
 }
 return dates;
}
export function nextOccurrence(task:DailyTask,completed:string):string {
 const repeat=task.repeat;if(!repeat)return '';
 const base=task.date||completed;
 if(repeat.kind==='after')return shiftDate(completed,Math.max(1,repeat.interval||1));
 if(repeat.kind==='daily')return shiftDate(base,1);
 if(repeat.kind==='weekdays'){
  for(let n=1;n<=7;n++){const next=shiftDate(base,n);if(repeat.weekdays?.includes(new Date(next+'T12:00:00Z').getUTCDay()))return next;}
  return '';
 }
 const d=new Date(base+'T12:00:00Z');d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
 d.setUTCDate(Math.min(repeat.day||Number(base.slice(8)),last));return d.toISOString().slice(0,10);
}
export function completeTask(task:DailyTask,previous:DailyTask|undefined,today:string,id:string):DailyTask {
 const result={...task,noteDate:task.noteDate||previous?.noteDate||task.date||today};
 if(task.done&&!previous?.done){
  const alreadyRecorded=task.history?.some(h=>!previous?.history?.some(old=>old.id===h.id));
  result.history=alreadyRecorded?task.history:[...(task.history||[]),{id,date:today,plannedDate:task.date,name:task.name,startTime:task.startTime,endTime:task.endTime,subtasks:task.subtasks.map(s=>({...s}))}];
  const next=nextOccurrence(task,today);
  if(next)return {...result,date:next,done:false,status:'planned',subtasks:task.subtasks.map(s=>({...s,checked:false}))};
 }
 return {...result,status:task.done?'completed':task.status==='completed'?'planned':task.status||'planned'};
}
export function taskMatches(task:DailyTask,filter:string,today:string,query='',list='',tag=''):boolean {
 if(task.deleted)return false;
 if(list&&task.list!==list)return false;
 if(tag&&!task.tags?.includes(tag))return false;
 if(query&&!`${task.name} ${task.description||''} ${(task.tags||[]).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))return false;
 if(filter==='all')return true;
 if(filter==='done')return task.done;
 if(task.done||task.status==='cancelled')return false;
 if(filter==='inbox')return !task.date&&!task.repeat&&!task.list;
 if(filter==='undated')return !task.date&&!task.repeat;
 if(filter==='today')return occurrenceDates(task,today,today).length>0||taskIsOverdue(task,today)||task.deadline===today;
 if(filter==='missed')return taskIsMissed(task,today);
 if(filter==='upcoming')return task.date>today||!!task.repeat&&occurrenceDates(task,shiftDate(today,1),shiftDate(today,366)).length>0;
 return taskIsOverdue(task,today);
}
