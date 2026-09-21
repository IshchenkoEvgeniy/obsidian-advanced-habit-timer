import {describe,it,expect} from 'vitest';
import {completeTask,nextOccurrence,taskMatches,occurrenceDates} from '../src/tasks/planning';
import {validTask,putTask,readTaskChecks,type DailyTask} from '../src/tasks/model';
const task:DailyTask={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'Task',date:'2026-01-31',deadline:'',priority:'',habitName:'',done:false,deleted:false,subtasks:[],revision:0};
describe('Task planning',()=>{
 it('projects an undated Friday series across months without creating tasks',()=>{
  const recurring={...task,date:'',noteDate:'2026-09-08',repeat:{kind:'weekdays' as const,weekdays:[5]}};
  expect(occurrenceDates(recurring,'2026-09-01','2026-09-30')).toEqual(['2026-09-11','2026-09-18','2026-09-25']);
  expect(occurrenceDates(recurring,'2026-10-01','2026-10-31')).toEqual(['2026-10-02','2026-10-09','2026-10-16','2026-10-23','2026-10-30']);
  expect(taskMatches(recurring,'today','2026-09-08')).toBe(false);
  expect(taskMatches(recurring,'today','2026-09-11')).toBe(true);
  expect(taskMatches(recurring,'inbox','2026-09-08')).toBe(false);
  expect(recurring.date).toBe('');
 });
 it('projects clamped monthly dates but does not guess completion-relative future dates',()=>{
  expect(occurrenceDates({...task,repeat:{kind:'monthly',day:31}},'2026-01-01','2026-04-30')).toEqual(['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
  expect(occurrenceDates({...task,repeat:{kind:'after',interval:3}},'2026-01-01','2026-04-30')).toEqual(['2026-01-31']);
 });
 it('validates minute-precision intervals and keeps them in notes and recurring history',()=>{
  const planned={...task,startTime:'13:00',endTime:'14:15',repeat:{kind:'daily' as const}};
  expect(validTask(planned)).toBe(true);expect(putTask('',planned)).toContain('Время: 13:00–14:15');
  expect(validTask({...planned,endTime:'12:59'})).toBe(false);
  expect(validTask({...planned,endTime:'13:00'})).toBe(false);
  expect(validTask({...planned,startTime:'',endTime:'14:15'})).toBe(false);
  expect(validTask({...planned,startTime:'25:00'})).toBe(false);
  expect(validTask({...planned,endTime:''})).toBe(true);
  const next=completeTask({...planned,done:true},task,'2026-09-08','one');
  expect(next).toMatchObject({startTime:'13:00',endTime:'14:15'});
  expect(next.history?.[0]).toMatchObject({startTime:'13:00',endTime:'14:15'});
 });
 it('supports inbox without treating it as overdue',()=>{const t={...task,date:''};expect(validTask(t)).toBe(true);expect(taskMatches(t,'inbox','2026-09-08')).toBe(true);expect(taskMatches(t,'overdue','2026-09-08')).toBe(false);});
 it('uses calendar days and clamps monthly dates',()=>{
  expect(nextOccurrence({...task,repeat:{kind:'monthly',day:31}},'2026-02-01')).toBe('2026-02-28');
  expect(nextOccurrence({...task,repeat:{kind:'weekdays',weekdays:[1]}},'2026-01-31')).toBe('2026-02-02');
  expect(nextOccurrence({...task,repeat:{kind:'after',interval:3}},'2026-09-08')).toBe('2026-09-11');
 });
 it('keeps completion history and resets the next occurrence',()=>{const result=completeTask({...task,done:true,repeat:{kind:'daily'}},task,'2026-09-08','one');expect(result.done).toBe(false);expect(result.date).toBe('2026-02-01');expect(result.history).toHaveLength(1);});
 it('does not log a locally completed task twice at the server',()=>{const local=completeTask({...task,done:true},task,'2026-09-08','local');const server=completeTask(local,task,'2026-09-08','remote');expect(server.history).toHaveLength(1);});
 it('preserves subtask dates through Markdown checkboxes',()=>{const t={...task,subtasks:[{text:'Step',checked:false,date:'2026-09-08'}]};expect(readTaskChecks(putTask('',t),t)).toEqual(t);});
});
