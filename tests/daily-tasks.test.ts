import { describe,it,expect } from 'vitest';
import { putTask,readTaskChecks,taskLog,validTask,type DailyTask } from '../src/tasks/model';
const task:DailyTask={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'Call',date:'2026-09-07',deadline:'',priority:'',habitName:'',done:false,deleted:false,revision:0,subtasks:[{text:'Prepare',checked:false}]};
describe('Daily note tasks',()=>{
 it('upserts without duplicating and preserves other sections',()=>{
  const base='# Note\n\n## Other\nKeep me\n';const text=putTask(base,task);
  expect(putTask(text,task)).toBe(text);expect(text).toContain('Keep me');
  expect(putTask(text,task,true)).not.toContain('- [ ] Call');expect(putTask(text,task,true)).toContain('Keep me');
 });
 it('reads task and subtask checkboxes from Markdown',()=>{
  const text=putTask('',task).replace('- [ ] Call','- [x] Call').replace('- [ ] Prepare','- [x] Prepare');
  const read=readTaskChecks(text,task);expect(read.done).toBe(true);expect(read.subtasks).toEqual([{text:'Prepare',checked:true}]);
 });
 it('logs retries once and validates dates',()=>{
  const text=taskLog('','one','Created');expect(taskLog(text,'one','Created')).toBe(text);
  expect(validTask(task)).toBe(true);expect(validTask({...task,date:'2026-02-30'})).toBe(false);
 });
});
