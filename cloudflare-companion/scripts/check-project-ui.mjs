import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true});
try{
 for(const width of [360,1100]){
  let tasks=[{key:'1',scopeId:'s',scopeName:'Проект',name:'Подготовить прототип',status:'Backlog',priority:'high',endDate:'2026-09-09',startDate:'',habitName:'Habit-Read',timeSpentSec:120,timeEstimatedSec:600,subtasks:[{text:'Эскиз',checked:false}],revision:0}];
  const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>r.abort());
  await page.route('**/app/api/projects',async route=>{
   if(route.request().method()==='GET')return route.fulfill({json:{scopes:[{id:'s',name:'Проект',statuses:'Backlog, Doing, Done'}],tasks}});
   const b=route.request().postDataJSON();
   if(b.action==='create')tasks.push({...b.task,key:'2',revision:0,timeSpentSec:0,subtasks:b.task.subtasks||[]});
   if(b.action==='save')tasks=tasks.map(t=>t.key===b.key?{...t,...b.task,revision:t.revision+1}:t);
   if(b.action==='delete'){if(!b.confirm)throw new Error('No confirmation');tasks=tasks.filter(t=>t.key!==b.key)}
   return route.fulfill({json:{ok:true}});
  });
  await page.goto('http://127.0.0.1:8792/app');await page.getByRole('button',{name:'Проекты',exact:true}).click();
  await page.getByRole('button',{name:'Подготовить прототип',exact:true}).click();
  await page.getByLabel('Название',{exact:true}).fill('Обновлённый прототип');
  await page.locator('select[name=status]').selectOption('Doing');
  await page.getByLabel('Подзадача выполнена').check();
  await page.getByRole('button',{name:'Подзадача',exact:true}).click();
  await page.getByLabel('Название подзадачи').last().fill('Проверить результат');
  await page.screenshot({path:`artifacts/project-editor-${width}.png`});
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.getByRole('button',{name:'Обновлённый прототип',exact:true}).waitFor();
  if(tasks[0].subtasks.length!==2||!tasks[0].subtasks[0].checked)throw new Error('Subtasks not saved');
  await page.screenshot({path:`artifacts/project-board-${width}.png`});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Page overflow');
  await page.getByRole('button',{name:'Задача',exact:true}).click();await page.getByLabel('Название',{exact:true}).fill('Новая задача');await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.getByRole('button',{name:'Новая задача',exact:true}).click();await page.getByRole('button',{name:'Удалить задачу',exact:true}).click();
  if(tasks.length!==2)throw new Error('Deleted before confirmation');
  await page.getByRole('button',{name:'Удалить',exact:true}).click();await page.getByRole('button',{name:'Задача',exact:true}).waitFor();
  if(tasks.length!==1)throw new Error('Delete failed');if(errors.length)throw new Error(errors.join('\n'));await page.close();
 }
 console.log('Kanban, edit, subtasks, create and confirmed deletion passed at 360px and 1100px.');
}finally{await browser.close()}
