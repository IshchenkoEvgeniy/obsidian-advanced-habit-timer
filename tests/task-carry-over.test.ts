import {it,expect} from 'vitest';
import {taskCarriesOver,taskMatches,occurrenceDates} from '../src/tasks/planning';
import {taskNotificationSummary} from '../src/tasks/notification-summary';
import {validTask,putTask,type DailyTask} from '../src/tasks/model';
import {rebaseTask} from '../src/tasks/merge';
const task:DailyTask={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'Class',date:'2026-09-10',deadline:'',done:false,deleted:false,habitName:'',priority:'',subtasks:[],revision:1};
it('keeps fixed-date tasks out of tomorrow and notifications without deleting them',()=>{
 const fixed={...task,carryOver:false};
 expect(taskMatches(fixed,'today','2026-09-10')).toBe(true);
 expect(taskMatches(fixed,'today','2026-09-11')).toBe(false);
 expect(taskMatches(fixed,'overdue','2026-09-11')).toBe(false);
 expect(taskMatches(fixed,'missed','2026-09-11')).toBe(true);
 expect(taskMatches(fixed,'all','2026-09-11')).toBe(true);
 expect(occurrenceDates(fixed,'2026-09-01','2026-09-30')).toEqual(['2026-09-10']);
 expect(taskNotificationSummary([fixed],'2026-09-11',false)).not.toContain('Class');
 expect(taskNotificationSummary([fixed],'2026-09-10',true)).toContain('Class');
 expect(putTask('',fixed)).toContain('Перенос: нет');
});
it('preserves legacy carry-over but defaults habits and timetable classes to fixed dates',()=>{
 expect(taskCarriesOver(task)).toBe(true);
 expect(taskMatches(task,'today','2026-09-11')).toBe(true);
 expect(taskMatches({...task,deadline:'2026-10-01'},'today','2026-09-11')).toBe(true);
 for(const special of [{autoHabitId:'english'},{description:'student-time-table.xls'},{tags:['Университет'],startTime:'09:00'},{repeat:{kind:'daily' as const}}]){
  expect(taskCarriesOver({...task,...special})).toBe(false);
  expect(taskCarriesOver({...task,...special,carryOver:true})).toBe(true);
 }
});
it('does not block future repetitions when the previous occurrence is missed',()=>{
 const repeating={...task,date:'2026-09-04',carryOver:false,repeat:{kind:'weekdays' as const,weekdays:[5]}};
 expect(taskMatches(repeating,'today','2026-09-11')).toBe(true);
 expect(taskMatches(repeating,'today','2026-09-12')).toBe(false);
 expect(occurrenceDates(repeating,'2026-09-01','2026-09-30')).toEqual(['2026-09-04','2026-09-11','2026-09-18','2026-09-25']);
});
it('validates and synchronizes the toggle independently of other edits',()=>{
 expect(validTask({...task,carryOver:false})).toBe(true);
 expect(validTask({...task,carryOver:'false' as unknown as boolean})).toBe(false);
 expect(rebaseTask({...task,carryOver:false},task,{...task,name:'Remote',revision:2})).toMatchObject({carryOver:false,name:'Remote',revision:2});
});
