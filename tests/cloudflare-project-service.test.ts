import { describe,it,expect,vi } from 'vitest';
import { TFile } from 'obsidian';
import { CloudflareProjectService } from '../src/services/cloudflare-project-service';
import type HabitTimerPlugin from '../src/main';
import type { BoardTask } from '../cloudflare-companion/src/project-board';
describe('Project changes applied to Obsidian',()=>{
 function setup(single:boolean){
  let content=single?'## Backlog\n- [ ] Task ^task-id\n  - [ ] Old\n  Notes to preserve\n- [ ] Other ^other-id\n  - [ ] Keep\n':'---\nstatus: Backlog\n---\nDescription\n- [ ] Old\nOther notes\n';
  const file=new TFile('Projects/Task.md');
  const task={id:'local',file,name:'Task',status:'Backlog',habitName:'Focus',timeSpentSec:0,cover:'cover.jpg',color:'red',tags:'one',subtasks:[{line:single?2:4,text:'Old',checked:false}],blockId:single?'task-id':undefined,sourceLine:single?1:undefined};
  const fm={time_spent:'00:00:05'};
  const save=vi.fn(async()=>{});
  const plugin={settings:{projectScopes:[{id:'s',name:'Scope',sourceType:single?'file':'folder',sourceValue:'Projects',statuses:'Backlog, Done'}]},
   formatTime:(seconds:number)=>[Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':'),saveSettings:vi.fn(async()=>{}),
   app:{vault:{getAbstractFileByPath:()=>null,read:async()=>content,process:async(_:unknown,fn:(s:string)=>string)=>{content=fn(content);}},
    fileManager:{processFrontMatter:async(_:unknown,fn:(v:typeof fm)=>void)=>fn(fm)}},
   projectEngine:{loadTasks:async()=>[task],invalidateCacheEntry:vi.fn(),saveTask:save}} as unknown as HabitTimerPlugin;
  const incoming={key:'k',id:'local',scopeId:'s',scopeName:'Scope',path:file.path,name:'Task',status:'Done',priority:'high',startDate:'',endDate:'',habitName:'Focus',timeSpentSec:0,timeEstimatedSec:600,subtasks:[{text:'New',checked:true}]} as BoardTask;
  return {service:new CloudflareProjectService(plugin),incoming,content:()=>content,save,fm};
 }
 it('changes only target subtasks in a shared task file and preserves unrelated notes',async()=>{
  const s=setup(true);await s.service.apply({action:'save',task:s.incoming});
  expect(s.content()).toContain('  - [x] New');expect(s.content()).toContain('Notes to preserve');expect(s.content()).toContain('- [ ] Other ^other-id\n  - [ ] Keep');
  expect(s.content()).not.toContain('- [ ] Old');expect(s.save.mock.calls[0]?.[1]).toMatchObject({cover:'cover.jpg',tags:'one',status:'Done'});
 });
 it('preserves file content when replacing subtasks in a separate task note',async()=>{
  const s=setup(false);await s.service.apply({action:'save',task:s.incoming});expect(s.content()).toContain('Description\n- [x] New\nOther notes');
 });
 it('accumulates consecutive timer events using the current property value',async()=>{
  const s=setup(false);await s.service.apply({task:s.incoming,seconds:10},true);await s.service.apply({task:s.incoming,seconds:20},true);expect(s.fm.time_spent).toBe('00:00:35');
 });
});
