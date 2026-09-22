import type { Env, CompanionConfigRow } from './types';
import { parseHabits, getValues } from './db';
import { habitGoals } from './stats';
import { zonedParts } from './time';
import { generateHabitTasks } from '../../src/tasks/habit-tasks';
import type { DailyTask } from '../../src/tasks/model';

export async function reconcileHabitTasks(env:Env,profile:string,config:CompanionConfigRow,now=Date.now()):Promise<void>{
    const habits=parseHabits(config).filter(h=>h.autoDailyTask&&h.autoDailyTaskOwner!=='obsidian');
    if(!habits.length)return;
    const {date}=zonedParts(now,config.timezone);
    const values=await getValues(env.DB,profile,date,date);
    const rows=await env.DB.prepare('SELECT data_json FROM daily_tasks WHERE profile_id=?').bind(profile).all<{data_json:string}>();
    const tasks:DailyTask[]=(rows.results||[]).map(r=>JSON.parse(r.data_json) as DailyTask);
    const input=habits.map(h=>({...h,desired:habitGoals(h,date).desired,value:values.find(v=>v.habit_name===h.name)?.value||0}));
    for(const next of await generateHabitTasks(input,tasks,date)){
        const previous=tasks.find(t=>t.id===next.id),task={...next,revision:next.revision+1};
        const requestId=crypto.randomUUID();
        const mutation=previous
            ?env.DB.prepare('UPDATE daily_tasks SET data_json=?,revision=? WHERE profile_id=? AND id=? AND revision=?').bind(JSON.stringify(task),task.revision,profile,task.id,previous.revision)
            :env.DB.prepare('INSERT OR IGNORE INTO daily_tasks VALUES(?,?,?,?)').bind(profile,task.id,task.revision,JSON.stringify(task));
        await env.DB.batch([mutation,env.DB.prepare("INSERT OR IGNORE INTO companion_events(event_id,profile_id,event_type,habit_name,habit_date,payload_json,created_at) SELECT ?,?,'daily_task',?,?,?,? WHERE changes()>0")
            .bind(`daily:${profile}:${requestId}`,profile,task.id,date,JSON.stringify({task,previous:previous||null,requestId}),now)]);
    }
}
