import {describe,it,expect} from 'vitest';
import {rebaseTask} from '../src/tasks/merge';
import type {DailyTask} from '../src/tasks/model';
const base:DailyTask={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'Task',date:'2026-09-07',deadline:'',priority:'',done:false,deleted:false,habitName:'',subtasks:[],revision:1};
describe('task sync rebasing',()=>{
 it('repairs a stale revision when fields did not conflict',()=>{
  expect(rebaseTask({...base,done:true},base,{...base,revision:8})).toEqual({...base,done:true,revision:8});
 });
 it('preserves a remote deadline while sending a local checkbox',()=>{
  expect(rebaseTask({...base,done:true},base,{...base,deadline:'2026-10-01',revision:2})).toEqual({...base,done:true,deadline:'2026-10-01',revision:2});
 });
 it('rebases successive offline edits on the accepted merged document',()=>{
  const local={...base,done:true};
  const accepted={...rebaseTask(local,base,{...base,deadline:'2026-10-01',revision:2}),revision:3};
  const next=rebaseTask({...local,name:'Renamed'},local,accepted);
  expect(next).toMatchObject({name:'Renamed',done:true,deadline:'2026-10-01',revision:3});
 });
 it('allows identical changes from both sides',()=>{
  expect(rebaseTask({...base,done:true},base,{...base,done:true,revision:4}).revision).toBe(4);
 });
 it('does not overwrite competing edits or resurrect deletions',()=>{
  expect(()=>rebaseTask({...base,name:'Local'},base,{...base,name:'Remote',revision:2})).toThrow();
  expect(()=>rebaseTask({...base,name:'Local'},base,{...base,deleted:true,revision:2})).toThrow();
  expect(()=>rebaseTask({...base,deleted:true},base,{...base,name:'Remote',revision:2})).toThrow();
 });
});
