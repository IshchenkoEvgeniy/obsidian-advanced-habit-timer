import {it,expect} from 'vitest';
import {taskNotificationSummary} from '../src/tasks/notification-summary';
import type {DailyTask} from '../src/tasks/model';
const base:DailyTask={id:'a',name:'English',date:'2026-09-10',deadline:'',done:false,deleted:false,priority:'',habitName:'',subtasks:[],revision:0};
it('shows today and overdue tasks with time but excludes future and undated tasks',()=>{
 const text=taskNotificationSummary([{...base,startTime:'13:00',endTime:'14:00'},{...base,name:'Future',date:'2026-09-11'},{...base,name:'Inbox',date:''},{...base,name:'Overdue',date:'2026-09-09'}],'2026-09-10',false);
 expect(text).toContain('На сегодня и просроченные: 2');expect(text).toContain('13:00–14:00 English');
 expect(text).not.toContain('Future');expect(text).not.toContain('Inbox');
});
it('counts actual completion dates for ordinary and recurring tasks without duplicates',()=>{
 const entry={id:'one',date:'2026-09-10',plannedDate:'2026-09-09',name:'Finished',subtasks:[]};
 const text=taskNotificationSummary([{...base,done:true,history:[entry]},{...base,date:'2026-09-11',repeat:{kind:'daily'},history:[{...entry,id:'two',name:'Repeat'}, {...entry,id:'two',name:'Repeat'}]},{...base,deleted:true}], '2026-09-10',true);
 expect(text).toContain('Выполнено: 2');expect(text).toContain('[x] Finished');expect(text).toContain('[x] Repeat');expect(text).toContain('Осталось (включая просроченные): 0');
});
it('projects weekdays and keeps long reports within photo caption limits',()=>{
 const tasks=Array.from({length:30},(_,i)=>({...base,id:String(i),name:'Long task '.repeat(30),startTime:'10:30',endTime:'11:50',done:i<15}));
 const text=taskNotificationSummary(tasks,'2026-09-10',true);
 expect(text).toContain('Выполнено: 15');expect(text).toContain('Ещё 11');expect(text.length).toBeLessThan(950);
 const friday={...base,name:'Friday',date:'',repeat:{kind:'weekdays' as const,weekdays:[5]}};
 expect(taskNotificationSummary([friday],'2026-09-10',false)).not.toContain('Friday');
 expect(taskNotificationSummary([friday],'2026-09-11',false)).toContain('Friday');
});
