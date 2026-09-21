import {describe,it,expect} from 'vitest';
import {generateHabitTasks,habitTaskId} from '../src/tasks/habit-tasks';
import {completeTask} from '../src/tasks/planning';
import {validTask} from '../src/tasks/model';

const habit={id:'english',name:'English',autoDailyTask:true,type:'timer',desired:3600,value:0};
const date='2026-09-09';
describe('Automatic habit tasks',()=>{
 it('is opt-in and skips weekly, zero-target and not-yet-started habits',async()=>{
  for(const change of [{autoDailyTask:false},{goalMode:'weekly'},{desired:0},{createdAt:'2026-10-01'},{type:'negative'}]){
   expect(await generateHabitTasks([{...habit,...change}],[],date)).toEqual([]);
  }
 });
 it('creates a stable task once per day, surviving habit renames',async()=>{
  const [task]=await generateHabitTasks([habit],[],date);
  expect(validTask(task!)).toBe(true);
  expect(task).toMatchObject({name:'English · 60 мин',date,done:false,habitName:'English',autoHabitId:'english'});
  expect(await generateHabitTasks([habit],[task!],date)).toEqual([]);
  const [renamed]=await generateHabitTasks([{...habit,name:'New English'}],[task!],date);
  expect(renamed?.id).toBe(task?.id);
  expect(await habitTaskId('english','2026-09-10')).not.toBe(task?.id);
 });
 it('completes only at the full target and does not log or add time twice',async()=>{
  const [task]=await generateHabitTasks([habit],[],date);
  expect(await generateHabitTasks([{...habit,value:3599}],[task!],date)).toEqual([]);
  const [done]=await generateHabitTasks([{...habit,value:3600}],[task!],date);
  expect(done).toMatchObject({done:true,status:'completed'});
  expect(done?.history).toHaveLength(1);
  expect(validTask(done!)).toBe(true);
  expect(completeTask(done!,task,date,'server-id').history).toHaveLength(1);
  expect(await generateHabitTasks([{...habit,value:3700}],[done!],date)).toEqual([]);
  expect(await generateHabitTasks([habit],[done!],date)).toEqual([]);
 });
 it('preserves deleted tasks, user fields and old history when disabled',async()=>{
  const [task]=await generateHabitTasks([habit],[],date);
  expect(await generateHabitTasks([habit],[{...task!,deleted:true}],date)).toEqual([]);
  expect(await generateHabitTasks([{...habit,autoDailyTask:false}],[task!],date)).toEqual([]);
  const [updated]=await generateHabitTasks([{...habit,value:3600}],[{...task!,description:'Keep',startTime:'13:00',endTime:'14:00'}],date);
  expect(updated).toMatchObject({description:'Keep',startTime:'13:00',endTime:'14:00'});
 });
 it('supports count goals without interpreting repetitions as minutes',async()=>{
  const [task]=await generateHabitTasks([{...habit,type:'count',desired:10,value:10}],[],date);
  expect(task).toMatchObject({name:'English · 10 раз',done:true});
 });
});
