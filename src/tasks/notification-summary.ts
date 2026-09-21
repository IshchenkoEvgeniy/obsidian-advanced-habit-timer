import type { DailyTask } from './model';
import { occurrenceDates,taskIsOverdue } from './planning';

/** Kept below Telegram's photo-caption limit, including room for the report title. */
export function taskNotificationSummary(tasks:DailyTask[],date:string,evening:boolean,lang='ru'):string {
    const ru=lang==='ru',pending:Array<{name:string;startTime?:string;endTime?:string}>=[],done:typeof pending=[];
    for(const t of tasks){
        if(t.deleted)continue;
        const history=t.repeat?t.history||[]:t.done?t.history?.slice(-1)||[]:[];
        const seen=new Set<string>();
        for(const h of history){
            if(h.date!==date||seen.has(h.id))continue;
            seen.add(h.id);done.push(h);
        }
        if(t.done&&!history.length&&t.date===date)done.push(t);
        if(t.done||t.status==='cancelled')continue;
        if(occurrenceDates(t,date,date).length||t.deadline===date||taskIsOverdue(t,date))pending.push(t);
    }
    pending.sort((a,b)=>(a.startTime||'99:99').localeCompare(b.startTime||'99:99')||a.name.localeCompare(b.name));
    const lines=[ru?'Задания':'Tasks'];
    const section=(title:string,items:typeof pending,checked:boolean)=>{
        lines.push(`${title}: ${items.length}`);
        for(const t of items.slice(0,4)){
            const name=t.name.replace(/[\r\n]+/g,' ');
            lines.push(`${checked?'[x]':'[ ]'} ${t.startTime?t.startTime+(t.endTime?'–'+t.endTime:'')+' ':''}${name.length>58?name.slice(0,55)+'...':name}`);
        }
        if(items.length>4)lines.push(ru?`Ещё ${items.length-4}`:`${items.length-4} more`);
    };
    if(evening)section(ru?'Выполнено':'Completed',done,true);
    section(ru?(evening?'Осталось (включая просроченные)':'На сегодня и просроченные'):'Pending (including overdue)',pending,false);
    if(!evening&&done.length)lines.push(ru?`Уже выполнено: ${done.length}`:`Already completed: ${done.length}`);
    return lines.join('\n');
}
