import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const python = 'C:/Users/ghjcn/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const source = 'C:/Users/ghjcn/Downloads/student-time-table.xls';
const rows = JSON.parse(execFileSync(python, ['-c', `import sys,os,json
sys.path.insert(0,os.path.join(os.environ['TEMP'],'codex-xls-reader'))
import xlrd
w=xlrd.open_workbook(sys.argv[1],ignore_workbook_corruption=True,encoding_override='cp1251')
assert len(w.sheets())==1
s=w.sheet_by_index(0)
print(json.dumps([s.row_values(i) for i in range(s.nrows)]))`, source], {encoding:'utf8'}));
const iso = value => value.split('.').reverse().join('-');
const [from,to] = rows[1][0].split('-').map(iso);
const uuid = key => {
  const h=createHash('sha256').update('student-time-table:2026:'+key).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
};
const settings=JSON.parse(fs.readFileSync('data.json','utf8'));
const endpoint=settings.cloudflareWorkerUrl.replace(/\/$/,'')+'/api/tasks';
const headers={Authorization:'Bearer '+settings.cloudflareApiToken,'Content-Type':'application/json'};
async function getTasks(){const r=await fetch(endpoint,{headers});if(!r.ok)throw Error(`GET ${r.status}`);return (await r.json()).tasks;}
const existing=await getTasks();
const planned=[];
let dates=[],skippedUnity=0;
for(const row of rows.slice(3)){
  if(/^\d{2}\.\d{2}\.\d{4}$/.test(row[1])){dates=row.slice(1).map(iso);continue;}
  const time=String(row[0]).match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
  if(!time)continue;
  for(let c=1;c<row.length;c++){
    if(!row[c])continue;
    const date=dates[c-1];
    if(!date||date<from||date>to)throw Error('Unexpected date');
    const [name,...details]=row[c].split('\n');
    if(name.startsWith('\u0420\u0406 [')&&new Date(date+'T12:00:00Z').getUTCDay()===5){
      if(!existing.some(t=>!t.deleted&&t.name==='\u0420\u043e\u0437\u0440\u043e\u0431\u043a\u0430 \u0456\u0433\u043e\u0440 \u043d\u0430 Unity'&&t.startTime===time[1]&&t.endTime===time[2]&&t.repeat?.weekdays?.includes(5)))throw Error('Missing existing Unity task');
      skippedUnity++;continue;
    }
    const id=uuid([date,time[1],name].join('|'));
    planned.push({id,name,date,deadline:'',priority:'high',done:false,deleted:false,habitName:'',subtasks:[],revision:0,noteDate:'2026-09-08',status:'planned',startTime:time[1],endTime:time[2],tags:['\u0423\u043d\u0438\u0432\u0435\u0440\u0441\u0438\u0442\u0435\u0442','\u0437\u0430\u043d\u044f\u0442\u0438\u044f'],description:details.join('\n')+'\nstudent-time-table.xls ('+from+' - '+to+')'});
  }
}
if(new Set(planned.map(t=>t.id)).size!==planned.length)throw Error('Duplicate source slots');
const additions=planned.filter(t=>!existing.some(e=>e.id===t.id||!e.deleted&&e.name===t.name&&e.date===t.date&&e.startTime===t.startTime));
console.log(JSON.stringify({from,to,skippedUnity,total:planned.length,additions:additions.length,bySubject:Object.fromEntries([...new Set(planned.map(t=>t.name))].map(n=>[n,planned.filter(t=>t.name===n).length]))},null,2));
if(process.argv.includes('--apply')){
  for(const task of additions){
    const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({task,requestId:uuid('request|'+task.id)})});
    if(!r.ok)throw Error(`POST ${r.status} for ${task.id}`);
    console.log('Created',task.date,task.startTime,task.name);
  }
  const after=await getTasks();
  for(const task of planned){
    const found=after.find(t=>!t.deleted&&t.name===task.name&&t.date===task.date&&t.startTime===task.startTime&&t.endTime===task.endTime);
    if(!found)throw Error('Verification failed '+task.id);
  }
  for(const before of existing){if(JSON.stringify(after.find(t=>t.id===before.id))!==JSON.stringify(before))throw Error('Existing task changed '+before.id);}
  console.log('Verified all imported slots; existing tasks unchanged.');
}
