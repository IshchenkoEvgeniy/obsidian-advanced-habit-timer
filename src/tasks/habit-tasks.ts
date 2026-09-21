import type { DailyTask } from './model';

export interface HabitTaskInput {
    id?:string; name:string; autoDailyTask?:boolean; type?:string; goalMode?:string;
    createdAt?:string; desired:number; value:number;
}

/** Stable across Obsidian and the companion, including retries and restarts. */
export async function habitTaskId(habitId:string,date:string):Promise<string> {
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`habit-task:${habitId}:${date}`));
    const hex=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export async function generateHabitTasks(habits:HabitTaskInput[],tasks:DailyTask[],date:string):Promise<DailyTask[]> {
    const updates:DailyTask[]=[];
    for(const habit of habits){
        const type=habit.type||'timer';
        if(!habit.autoDailyTask||habit.goalMode==='weekly'||!['timer','count'].includes(type)
            ||(habit.createdAt||'')>date||!Number.isFinite(habit.desired)||habit.desired<=0)continue;
        const key=habit.id||habit.name,id=await habitTaskId(key,date);
        const previous=tasks.find(t=>t.id===id);
        if(previous?.deleted||previous?.done)continue;
        const amount=type==='timer'?habit.desired/60:habit.desired;
        const name=`${habit.name} · ${Number(amount.toFixed(2))} ${type==='timer'?'мин':'раз'}`.slice(0,250);
        const task:DailyTask=previous?{...previous,name,habitName:habit.name}:{
            id,autoHabitId:key,carryOver:false,name,date,noteDate:date,deadline:'',priority:'',done:false,deleted:false,
            habitName:habit.name,subtasks:[],revision:0,status:'planned'
        };
        if(Number.isFinite(habit.value)&&habit.value>=habit.desired){
            task.done=true;task.status='completed';
            task.history=[...(task.history||[]),{id,date,plannedDate:date,name:task.name,subtasks:task.subtasks.map(s=>({...s}))}];
        }
        if(JSON.stringify(task)!==JSON.stringify(previous))updates.push(task);
    }
    return updates;
}
