import {it,expect,vi} from 'vitest';
const network=vi.hoisted(()=>vi.fn());
vi.mock('obsidian',async importOriginal=>({...await importOriginal<object>(),normalizePath:(p:string)=>p.replace(/\\/g,'/'),requestUrl:network}));
import {TasksService} from '../src/tasks/service';
import type HabitTimerPlugin from '../src/main';
import {putTask,type DailyTask} from '../src/tasks/model';
import {TFile} from 'obsidian';
// Mirror of the non-exported TaskState shape in src/tasks/service.ts
interface StoredState{tasks:DailyTask[],pending:{task:DailyTask,previous?:DailyTask,requestId:string,date:string}[]}

it('generates and completes a habit task in the registry and daily note without duplicates',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
 try{
  let stored=JSON.stringify({tasks:[],pending:[],storageVersion:2});
  const files=new Map<string,TFile>(),contents=new Map<string,string>();
  const create=async(path:string,content:string)=>{const f=Object.assign(new TFile(path),{parent:{path:'Daily'}});files.set(path,f);contents.set(path,content);return f;};
  const fm={'English':'00:59:59'};
  await create('Daily/2026-09-09.md','# Today\n');
  const plugin={manifest:{dir:'plugin'},settings:{dailyNotesFolder:'Daily',properties:[{id:'english',name:'English',goalMinutes:60,autoDailyTask:true}]},dailyNotes:{getNote:(date:string)=>files.get(`Daily/${date}.md`)||null,ensureNote:async(date:string)=>files.get(`Daily/${date}.md`)||create(`Daily/${date}.md`,'')},app:{metadataCache:{getFileCache:()=>({frontmatter:fm})},vault:{getAbstractFileByPath:(p:string)=>files.get(p)||null,getMarkdownFiles:()=>[...files.values()],create,read:async(f:TFile)=>contents.get(f.path)||'',process:async(f:TFile,fn:(s:string)=>string)=>contents.set(f.path,fn(contents.get(f.path)||'')),adapter:{exists:async()=>true,read:async()=>stored,write:async(_:string,s:string)=>{stored=s;}}}}} as unknown as HabitTimerPlugin;
  const service=new TasksService(plugin);
  expect((await service.list())[0]?.done).toBe(false);
  fm.English='01:00:00';
  expect((await service.list())[0]?.done).toBe(true);
  await service.list();
  expect((JSON.parse(stored) as StoredState).tasks).toHaveLength(1);
  expect((JSON.parse(stored) as StoredState).tasks[0]!.history).toHaveLength(1);
  expect((JSON.parse(stored) as StoredState).pending).toHaveLength(2);
  for(const path of ['Daily/2026-09-09.md','Daily/Задания.md']){
   expect(contents.get(path)?.match(/- \[x\] English/g)).toHaveLength(1);
  }
  expect(fm.English).toBe('01:00:00');
 }finally{vi.useRealTimers();}
});

it('drains sequential offline edits after a cloud-only change without losing either side',async()=>{
 const base:DailyTask={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'Task',date:'2026-09-07',deadline:'',priority:'',habitName:'',done:false,deleted:false,subtasks:[],revision:1};
 const first={...base,done:true},second={...first,name:'Renamed'};
 let stored=JSON.stringify({tasks:[second],pending:[{task:first,previous:base,requestId:crypto.randomUUID(),date:base.date},{task:second,previous:first,requestId:crypto.randomUUID(),date:base.date}]});
 let remote={...base,deadline:'2026-10-01',revision:4};let note='';
 network.mockImplementation(async(options:{body?:string})=>{
  if(!options.body)return {status:200,json:{tasks:[remote]}};
  const {task}=JSON.parse(options.body) as {task:DailyTask};
  if(task.revision!==remote.revision)return {status:409,json:{error:'task_conflict'}};
  remote={...task,revision:remote.revision+1};return {status:200,json:{ok:true,task:remote}};
 });
 const plugin={manifest:{dir:'test'},settings:{cloudflareWorkerUrl:'https://example.test',cloudflareApiToken:'test'},
  dailyNotes:{getNote:()=>null,ensureNote:async()=>({})},app:{vault:{getAbstractFileByPath:()=>new TFile('Задания.md'),getMarkdownFiles:()=>[],read:async()=>note,adapter:{exists:async()=>true,read:async()=>stored,write:async(_:string,s:string)=>{stored=s;}},process:async(_:unknown,fn:(s:string)=>string)=>{note=fn(note);}}}} as unknown as HabitTimerPlugin;
 await new TasksService(plugin).sync();
 expect((JSON.parse(stored) as StoredState).pending).toHaveLength(0);
 expect(remote).toMatchObject({name:'Renamed',done:true,deadline:'2026-10-01',revision:6});
 expect((JSON.parse(stored) as StoredState).tasks[0]).toEqual(remote);
 expect(note).toContain('- [x] Renamed');
});

it('moves undated series to the registry, preserves unrelated notes, and projects only the scheduled day',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-08T12:00:00Z'));
 try{
  const task:DailyTask={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'Friday class',date:'',noteDate:'2026-09-08',deadline:'',priority:'',habitName:'',done:false,deleted:false,subtasks:[],revision:1,repeat:{kind:'weekdays',weekdays:[5]}};
  let stored=JSON.stringify({tasks:[task],pending:[]});
  const files=new Map<string,TFile>(),contents=new Map<string,string>();
  const create=async(path:string,content:string)=>{const file=Object.assign(new TFile(path),{parent:{path:'Daily'}});files.set(path,file);contents.set(path,content);return file;};
  await create('Daily/2026-09-08.md',putTask('# Tuesday\n- [ ] Unrelated\n',task));
  const plugin={manifest:{dir:'plugin'},settings:{dailyNotesFolder:'Daily'},dailyNotes:{getNote:(date:string)=>files.get(`Daily/${date}.md`)||null,ensureNote:async(date:string)=>files.get(`Daily/${date}.md`)||create(`Daily/${date}.md`,'')},app:{vault:{getAbstractFileByPath:(p:string)=>files.get(p)||null,getMarkdownFiles:()=>[...files.values()],create,read:async(f:TFile)=>contents.get(f.path)||'',process:async(f:TFile,fn:(s:string)=>string)=>contents.set(f.path,fn(contents.get(f.path)||'')),adapter:{exists:async()=>true,read:async()=>stored,write:async(_:string,s:string)=>{stored=s;}}}}} as unknown as HabitTimerPlugin;
  const service=new TasksService(plugin);await service.list();
  expect(contents.get('Daily/Задания.md')).toContain('Friday class');
  expect(contents.get('Daily/2026-09-08.md')).not.toContain('Friday class');
  expect(contents.get('Daily/2026-09-08.md')).toContain('Unrelated');
  expect(files.has('Daily/2026-09-11.md')).toBe(false);
  vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));await service.list();
  expect(contents.get('Daily/2026-09-11.md')).toContain('Friday class');
  contents.set('Daily/2026-09-11.md',contents.get('Daily/2026-09-11.md')!.replace('- [ ] Friday class','- [x] Friday class'));
  await service.list();await service.list();
  expect((JSON.parse(stored) as StoredState).tasks[0]!.history).toHaveLength(1);
  expect((JSON.parse(stored) as StoredState).tasks[0]!.date).toBe('2026-09-18');
  expect((JSON.parse(stored) as StoredState).pending).toHaveLength(1);
 }finally{vi.useRealTimers();}
});
